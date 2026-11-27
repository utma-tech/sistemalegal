import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../../config';
import { obtenerPool } from '../../db';
import { requierePermiso } from '../../middlewares/autenticacion';
import { validarCuerpo } from '../../middlewares/validacion';
import { idDeRuta } from '../../comun/ruta';
import { ErrorConflicto, ErrorNoEncontrado, ErrorSolicitud } from '../../comun/errores';
import { registrar } from '../auditoria/servicio';
import { encolar, procesarCola } from './cola';
import { ocultarDireccion, proveedorActual } from './correo';
import { PLANTILLAS, armarCorreo, datosDeEjemplo, type TipoPlantilla } from './plantillas';
import { esquemaPreferencias, guardarPreferencias, preferenciasDe, type Preferencias } from './preferencias';
import * as programador from './programador';

/* =============================================================================
 * Programador externo: POST /api/interno/programador
 *
 * Se monta ANTES de la verificación de sesión: quien llama es un servicio, no
 * una persona. Lo protege un secreto propio (CRON_SECRET) que viaja en la
 * cabecera Authorization, nunca en la URL (las URL quedan en logs de proxies).
 * Sin secreto configurado responde 503: el endpoint no existe "abierto".
 * ============================================================================= */

export const rutasProgramador = Router();

const limiteProgramador = rateLimit({
  windowMs: 60_000,
  limit: 6,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiadas ejecuciones seguidas.', codigo: 'DEMASIADAS_EJECUCIONES' },
});

rutasProgramador.post('/programador', limiteProgramador, async (req: Request, res: Response) => {
  if (!config.secretoProgramador) {
    res.status(503).json({ error: 'El programador no está configurado.', codigo: 'PROGRAMADOR_NO_CONFIGURADO' });
    return;
  }
  const cabecera = req.get('authorization') ?? '';
  const secreto = cabecera.startsWith('Bearer ') ? cabecera.slice('Bearer '.length).trim() : undefined;
  if (!programador.secretoValido(secreto)) {
    res.status(401).json({ error: 'No autorizado.', codigo: 'NO_AUTORIZADO' });
    return;
  }
  const resumen = await programador.ejecutar('PROGRAMADOR');
  // Solo contadores: ni destinatarios, ni contenidos, ni errores detallados.
  res.json({
    procesados: resumen.procesados,
    aceptados: resumen.aceptados,
    fallidos: resumen.fallidos,
    cancelados: resumen.cancelados,
    reintentos: resumen.reintentos,
    pendientes: resumen.pendientes,
    alertas_creadas: resumen.alertas_creadas,
  });
});

/* =============================================================================
 * Preferencias propias: /api/cuenta/notificaciones
 * ============================================================================= */

export const rutasPreferencias = Router();

rutasPreferencias.get('/', async (req: Request, res: Response) => {
  res.json({
    preferencias: await preferenciasDe(req.sesion!.id),
    // Para que la pantalla explique por qué no llegan correos aunque estén activados.
    correo_del_estudio: proveedorActual() ? 'activo' : 'inactivo',
  });
});

rutasPreferencias.put('/', validarCuerpo(esquemaPreferencias), async (req: Request, res: Response) => {
  const antes = await preferenciasDe(req.sesion!.id);
  const despues = await guardarPreferencias(req.sesion!.id, req.body as Preferencias);
  await registrar(req, {
    entidad: 'preferencia_notificacion',
    entidadId: req.sesion!.id,
    accion: 'ACTUALIZAR',
    datosAntes: antes,
    datosDespues: despues,
  });
  res.json({ preferencias: despues });
});

/* =============================================================================
 * Administración: /api/notificaciones/administracion
 *
 * Solo con configuracion.notificaciones (Administrador). Muestra el estado sin
 * exponer secretos: la clave del proveedor nunca sale del servidor; del
 * remitente y de APP_URL solo se informa si están configurados.
 * ============================================================================= */

export const rutasAdministracionNotificaciones = Router();
rutasAdministracionNotificaciones.use(requierePermiso('configuracion.notificaciones'));

/** Si la última corrida exitosa es más vieja que esto, el programador está atrasado. */
const MINUTOS_ATRASO = 30;

rutasAdministracionNotificaciones.get('/', async (_req: Request, res: Response) => {
  const pool = obtenerPool();
  const [ultima, ultimaExitosa, cola, recientes, fallidos] = await Promise.all([
    pool.query(
      `SELECT iniciado_en, finalizado_en, origen, procesados, aceptados, fallidos, cancelados, error
         FROM ejecucion_programador ORDER BY iniciado_en DESC LIMIT 1`,
    ),
    pool.query<{ iniciado_en: Date }>(
      `SELECT iniciado_en, origen, procesados, aceptados FROM ejecucion_programador
        WHERE finalizado_en IS NOT NULL AND error IS NULL
        ORDER BY iniciado_en DESC LIMIT 1`,
    ),
    pool.query<{ estado: string; canal: string; total: number }>(
      `SELECT estado, canal, count(*)::int AS total FROM envio_notificacion
        WHERE estado IN ('PENDIENTE', 'PROCESANDO')
           OR creado_en > now() - interval '7 days'
        GROUP BY estado, canal`,
    ),
    pool.query<{ vencidos: number }>(
      `SELECT count(*)::int AS vencidos FROM envio_notificacion
        WHERE estado IN ('PENDIENTE', 'PROCESANDO') AND proximo_intento <= now()`,
    ),
    pool.query(
      `SELECT e.id, e.tipo, e.canal, e.intentos, e.ultimo_error, e.creado_en, e.procesado_en,
              (u.nombre || ' ' || u.apellido) AS destinatario
         FROM envio_notificacion e
         JOIN usuario u ON u.id = e.usuario_id
        WHERE e.estado = 'FALLIDO'
        ORDER BY e.procesado_en DESC NULLS LAST
        LIMIT 20`,
    ),
  ]);

  const exitosa = ultimaExitosa.rows[0];
  const atrasado =
    !exitosa || Date.now() - new Date(exitosa.iniciado_en).getTime() > MINUTOS_ATRASO * 60_000;

  res.json({
    correo: {
      modo: config.correo.modo,
      modo_pedido: config.correo.modoPedido,
      proveedor: config.correo.modo === 'real' ? config.correo.proveedor : config.correo.modo,
      remitente_configurado: Boolean(process.env.CORREO_REMITENTE?.trim()),
      app_url_configurada: Boolean(config.urlAplicacion),
      faltantes: config.correo.faltantes,
    },
    programador: {
      configurado: Boolean(config.secretoProgramador),
      ultima_ejecucion: ultima.rows[0] ?? null,
      ultima_exitosa: exitosa ?? null,
      atrasado,
      minutos_atraso: MINUTOS_ATRASO,
    },
    cola: {
      por_estado: cola.rows,
      vencidos_sin_procesar: recientes.rows[0]?.vencidos ?? 0,
    },
    fallidos: fallidos.rows,
    zona_horaria: config.zonaHoraria,
  });
});

rutasAdministracionNotificaciones.post('/procesar', async (req: Request, res: Response) => {
  const resumen = await programador.ejecutar('MANUAL');
  await registrar(req, { entidad: 'ejecucion_programador', entidadId: resumen.id, accion: 'CREAR' });
  res.json({ resumen });
});

rutasAdministracionNotificaciones.post('/envios/:id/reintentar', async (req: Request, res: Response) => {
  const id = idDeRuta(req, 'envío');
  const { rows } = await obtenerPool().query<{ id: string }>(
    `UPDATE envio_notificacion
        SET estado = 'PENDIENTE', proximo_intento = now(), intentos = 0, bloqueado_hasta = NULL,
            programado_para = now()
      WHERE id = $1 AND estado = 'FALLIDO'
      RETURNING id`,
    [id],
  );
  if (!rows[0]) {
    const existe = await obtenerPool().query('SELECT 1 FROM envio_notificacion WHERE id = $1', [id]);
    if (existe.rowCount) throw new ErrorConflicto('Solo se puede reintentar un envío fallido.');
    throw new ErrorNoEncontrado('No encontramos ese envío.');
  }
  await registrar(req, { entidad: 'envio_notificacion', entidadId: id, accion: 'ACTUALIZAR', datosDespues: { estado: 'PENDIENTE' } });
  res.json({ reintentado: true });
});

/**
 * Correo de prueba. Solo a la dirección de quien lo pide: no se puede usar
 * para mandar correo a terceros. Tres por hora por administrador.
 */
const limitePrueba = rateLimit({
  windowMs: 60 * 60_000,
  limit: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `prueba-correo:${req.sesion!.id}`,
  message: { error: 'Ya se enviaron varios correos de prueba. Esperá un rato.', codigo: 'DEMASIADAS_PRUEBAS' },
});

rutasAdministracionNotificaciones.post('/prueba', limitePrueba, async (req: Request, res: Response) => {
  if (!proveedorActual()) {
    throw new ErrorConflicto('El correo del estudio está deshabilitado. Configuralo antes de enviar una prueba.');
  }
  const pool = obtenerPool();
  const clave = `PRUEBA:${req.sesion!.id}:${Date.now()}`;
  await encolar(pool, [
    { usuarioId: req.sesion!.id, canal: 'EMAIL', tipo: 'PRUEBA', clave },
  ]);
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM envio_notificacion WHERE clave_idempotencia = $1',
    [clave],
  );
  await procesarCola({ ids: [rows[0]!.id], limite: 1 });
  const { rows: final } = await pool.query<{ estado: string; ultimo_error: string | null }>(
    'SELECT estado, ultimo_error FROM envio_notificacion WHERE id = $1',
    [rows[0]!.id],
  );
  const { rows: usuario } = await pool.query<{ email: string }>('SELECT email FROM usuario WHERE id = $1', [
    req.sesion!.id,
  ]);
  await registrar(req, { entidad: 'envio_notificacion', entidadId: rows[0]!.id, accion: 'CREAR', datosDespues: { tipo: 'PRUEBA' } });
  res.json({
    estado: final[0]?.estado,
    error: final[0]?.ultimo_error ?? null,
    destinatario: ocultarDireccion(usuario[0]?.email ?? ''),
  });
});

/** Vista previa de una plantilla con datos de ejemplo (nada real). */
rutasAdministracionNotificaciones.get('/plantillas/:plantilla', async (req: Request, res: Response) => {
  const plantilla = String(req.params.plantilla ?? '') as TipoPlantilla;
  if (!PLANTILLAS.includes(plantilla)) throw new ErrorSolicitud('Esa plantilla no existe.');
  const base = config.urlAplicacion ?? 'https://sistemalegal.example';
  res.json({ plantilla, ...armarCorreo(plantilla, datosDeEjemplo(plantilla, base)) });
});

rutasAdministracionNotificaciones.get('/plantillas', async (_req: Request, res: Response) => {
  res.json({ plantillas: PLANTILLAS });
});
