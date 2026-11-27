import type { Pool, PoolClient } from 'pg';
import { config } from '../../config';
import { enTransaccion, obtenerPool } from '../../db';
import { rolConAlcanceGeneral, sqlCausaEnAlcance, sqlEventoVisible } from '../../comun/alcance';
import { ErrorProveedorCorreo, proveedorActual } from './correo';
import { armarCorreo, nombreTipo, type DatosCorreo, type TipoPlantilla } from './plantillas';
import { preferenciasDe, type Preferencias } from './preferencias';

/**
 * Cola persistente de entregas (tabla envio_notificacion, migración 014).
 *
 * Patrón outbox: el cambio de negocio (crear o reprogramar un evento) y la
 * programación de sus avisos se escriben en la MISMA transacción. Después, un
 * proceso independiente recorre la cola y entrega. Si el servidor se reinicia
 * en el medio, nada se pierde: la cola vive en PostgreSQL.
 *
 * Toma de trabajos: un único UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP
 * LOCKED) marca el lote como PROCESANDO con un vencimiento (bloqueado_hasta).
 * Dos procesos concurrentes nunca toman la misma fila, y la transacción dura
 * lo que ese UPDATE: la llamada de red al proveedor ocurre fuera de toda
 * transacción. Si el proceso muere con filas tomadas, al vencer el bloqueo
 * otro las retoma; la Idempotency-Key evita el doble envío.
 *
 * Antes de cada entrega se revalida todo: que el usuario siga activo, que siga
 * viendo el evento o el expediente, que el evento siga en la versión y el
 * estado para los que se programó el aviso, y sus preferencias.
 */

type Consultable = Pool | PoolClient;

export type Canal = 'IN_APP' | 'EMAIL';
export type TipoEnvio =
  | 'RECORDATORIO_EVENTO'
  | 'EVENTO_ASIGNADO'
  | 'EVENTO_REPROGRAMADO'
  | 'EVENTO_CANCELADO'
  | 'PLAZO_ALERTA'
  | 'PRUEBA';

export interface NuevoEnvio {
  usuarioId: string;
  canal: Canal;
  tipo: TipoEnvio;
  eventoId?: string;
  alertaId?: string;
  plazoId?: string;
  versionOrigen?: number;
  minutosAntes?: number;
  datos?: Record<string, unknown>;
  /**
   * Instante de entrega. Sin informar = ya: lo decide el reloj de la base, no
   * el del servidor, para que un desfase entre los dos no deje un aviso
   * inmediato esperando unos segundos.
   */
  programadoPara?: Date;
  clave: string;
}

/** Reintentos: 1 min, 5 min, 30 min, 2 h. Al quinto intento fallido, FALLIDO. */
const ESPERAS_MINUTOS = [1, 5, 30, 120];
export const MAXIMO_INTENTOS = 5;
const MINUTOS_BLOQUEO = 5;
/**
 * Un aviso inmediato (asignación, reprogramación, cancelación, plazo) que no
 * se pudo entregar en 24 horas ya no informa nada útil: se cancela en lugar de
 * llegar tarde. Es también lo que evita una avalancha de correos viejos si el
 * programador estuvo caído varios días.
 */
const HORAS_VIGENCIA_AVISO = 24;

/** Programa entregas. Lo repetido (misma clave de idempotencia) se ignora. */
export async function encolar(cliente: Consultable, envios: NuevoEnvio[]): Promise<number> {
  let creados = 0;
  for (const envio of envios) {
    const { rowCount } = await cliente.query(
      `INSERT INTO envio_notificacion
         (usuario_id, canal, tipo, evento_id, alerta_id, plazo_id, version_origen, minutos_antes,
          datos, programado_para, proximo_intento, clave_idempotencia)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               COALESCE($10::timestamptz, now()), COALESCE($10::timestamptz, now()), $11)
       ON CONFLICT (clave_idempotencia) DO NOTHING`,
      [
        envio.usuarioId,
        envio.canal,
        envio.tipo,
        envio.eventoId ?? null,
        envio.alertaId ?? null,
        envio.plazoId ?? null,
        envio.versionOrigen ?? null,
        envio.minutosAntes ?? null,
        JSON.stringify(envio.datos ?? {}),
        envio.programadoPara ?? null,
        envio.clave,
      ],
    );
    creados += rowCount ?? 0;
  }
  return creados;
}

/** Una entrega por canal: el aviso interno siempre, el correo según preferencias al enviarlo. */
export function porAmbosCanales(base: Omit<NuevoEnvio, 'canal' | 'clave'>, clave: string): NuevoEnvio[] {
  return (['IN_APP', 'EMAIL'] as const).map((canal) => ({ ...base, canal, clave: `${clave}:${canal}` }));
}

/** Cancela lo pendiente de un evento (todo, o solo ciertos tipos). */
export async function cancelarPendientesDeEvento(
  cliente: Consultable,
  eventoId: string,
  motivo: string,
  tipos?: TipoEnvio[],
): Promise<number> {
  const { rowCount } = await cliente.query(
    `UPDATE envio_notificacion
        SET estado = 'CANCELADO', motivo_cancelacion = $2, procesado_en = now(), bloqueado_hasta = NULL
      WHERE evento_id = $1
        AND estado = 'PENDIENTE'
        AND ($3::text[] IS NULL OR tipo = ANY($3::text[]))`,
    [eventoId, motivo, tipos ?? null],
  );
  return rowCount ?? 0;
}

/* --- Procesamiento --------------------------------------------------------------- */

interface FilaEnvio {
  id: string;
  usuario_id: string;
  canal: Canal;
  tipo: TipoEnvio;
  evento_id: string | null;
  alerta_id: string | null;
  plazo_id: string | null;
  version_origen: number | null;
  minutos_antes: number | null;
  datos: Record<string, unknown>;
  programado_para: Date;
  intentos: number;
  clave_idempotencia: string;
}

export interface OpcionesProceso {
  limite?: number;
  /** Solo las entregas de este usuario (la bandeja procesa las suyas al abrirse). */
  usuarioId?: string;
  soloCanal?: Canal;
  ids?: string[];
  /** Corta el lote al superar este tiempo, para no exceder el timeout del programador. */
  tiempoMaximoMs?: number;
}

export interface ResultadoProceso {
  procesados: number;
  aceptados: number;
  fallidos: number;
  cancelados: number;
  reintentos: number;
}

async function tomarLote(opciones: OpcionesProceso): Promise<FilaEnvio[]> {
  const { rows } = await obtenerPool().query<FilaEnvio>(
    `UPDATE envio_notificacion e
        SET estado = 'PROCESANDO',
            intentos = e.intentos + 1,
            bloqueado_hasta = now() + make_interval(mins => $5),
            procesado_en = now()
      WHERE e.id IN (
              SELECT id FROM envio_notificacion
               WHERE ((estado = 'PENDIENTE' AND proximo_intento <= now())
                   OR (estado = 'PROCESANDO' AND bloqueado_hasta < now()))
                 AND ($2::uuid IS NULL OR usuario_id = $2::uuid)
                 AND ($3::text IS NULL OR canal = $3::text)
                 AND ($4::uuid[] IS NULL OR id = ANY($4::uuid[]))
               ORDER BY proximo_intento
               LIMIT $1
               FOR UPDATE SKIP LOCKED)
      RETURNING e.id, e.usuario_id, e.canal, e.tipo, e.evento_id, e.alerta_id, e.plazo_id,
                e.version_origen, e.minutos_antes, e.datos, e.programado_para, e.intentos,
                e.clave_idempotencia`,
    [opciones.limite ?? 50, opciones.usuarioId ?? null, opciones.soloCanal ?? null, opciones.ids ?? null, MINUTOS_BLOQUEO],
  );
  return rows;
}

async function finalizar(
  id: string,
  estado: 'CANCELADO' | 'FALLIDO',
  detalle: { motivo?: string; error?: string },
): Promise<void> {
  await obtenerPool().query(
    `UPDATE envio_notificacion
        SET estado = $2, motivo_cancelacion = $3, ultimo_error = COALESCE($4, ultimo_error),
            bloqueado_hasta = NULL, procesado_en = now()
      WHERE id = $1 AND estado = 'PROCESANDO'`,
    [id, estado, detalle.motivo ?? null, detalle.error?.slice(0, 300) ?? null],
  );
}

async function reprogramarReintento(fila: FilaEnvio, error: string): Promise<'reintento' | 'fallido'> {
  if (fila.intentos >= MAXIMO_INTENTOS) {
    await finalizar(fila.id, 'FALLIDO', { error: `${error} Se agotaron los ${MAXIMO_INTENTOS} intentos.` });
    return 'fallido';
  }
  const espera = ESPERAS_MINUTOS[Math.min(fila.intentos - 1, ESPERAS_MINUTOS.length - 1)]!;
  await obtenerPool().query(
    `UPDATE envio_notificacion
        SET estado = 'PENDIENTE', proximo_intento = now() + make_interval(mins => $2),
            ultimo_error = $3, bloqueado_hasta = NULL
      WHERE id = $1 AND estado = 'PROCESANDO'`,
    [fila.id, espera, error.slice(0, 300)],
  );
  return 'reintento';
}

interface Destinatario {
  id: string;
  email: string;
  nombre: string;
  activo: boolean;
  rol: string;
}

interface EventoParaAviso {
  id: string;
  titulo: string;
  tipo: string;
  estado: string;
  version: number;
  todo_el_dia: boolean;
  fecha_inicio: Date;
  fecha: string;
  hora: string;
  causa_id: string | null;
  visible: boolean;
}

interface PlazoParaAviso {
  id: string;
  causa_id: string;
  estado: string;
  fecha_vencimiento: string;
  accesible: boolean;
}

/** Lo que hace falta para decidir y armar una entrega. */
type Decision =
  | { tipo: 'cancelar'; motivo: string }
  | { tipo: 'entregar'; titulo: string; mensaje: string; plantilla: TipoPlantilla; datos: DatosCorreo; eventoId?: string; alertaId?: string };

function urlBase(): string {
  return config.urlAplicacion ?? 'http://localhost:5173';
}

/** "en 24 horas", "en 55 minutos", "en 3 días". */
export function tiempoRestante(desde: Date, hasta: Date): string {
  const minutos = Math.round((hasta.getTime() - desde.getTime()) / 60_000);
  if (minutos <= 1) return 'en este momento';
  if (minutos < 90) return minutos >= 55 && minutos <= 65 ? 'en 1 hora' : `en ${minutos} minutos`;
  const horas = Math.round(minutos / 60);
  if (horas < 36) return `en ${horas} horas`;
  return `en ${Math.round(horas / 24)} días`;
}

/** Instante al que se refieren los recordatorios: la hora del evento, o las 8 del día si es de día completo. */
export function anclaDeRecordatorio(fechaInicio: Date, todoElDia: boolean): Date {
  return todoElDia ? new Date(fechaInicio.getTime() + 8 * 3_600_000) : fechaInicio;
}

const PLANTILLA_RECORDATORIO: Record<string, TipoPlantilla> = {
  AUDIENCIA: 'RECORDATORIO_AUDIENCIA',
  MEDIACION: 'RECORDATORIO_MEDIACION',
  REUNION: 'RECORDATORIO_REUNION',
};

export function correoPermitido(tipo: TipoEnvio, tipoEvento: string | undefined, p: Preferencias): boolean {
  if (!p.correo_habilitado) return false;
  switch (tipo) {
    case 'RECORDATORIO_EVENTO':
      if (tipoEvento === 'AUDIENCIA') return p.recordatorio_audiencia;
      if (tipoEvento === 'MEDIACION') return p.recordatorio_mediacion;
      if (tipoEvento === 'REUNION') return p.recordatorio_reunion;
      return p.recordatorio_otros;
    case 'EVENTO_ASIGNADO':
      return p.aviso_asignaciones;
    case 'EVENTO_REPROGRAMADO':
      return p.aviso_reprogramaciones;
    case 'EVENTO_CANCELADO':
      return p.aviso_cancelaciones;
    case 'PLAZO_ALERTA':
      return p.aviso_plazos;
    case 'PRUEBA':
      return true;
  }
}

async function decidir(fila: FilaEnvio, usuario: Destinatario, ahora: Date): Promise<Decision> {
  const pool = obtenerPool();
  const alcance = rolConAlcanceGeneral(usuario.rol) ? null : usuario.id;
  const nombre = usuario.nombre;

  if (fila.tipo === 'PRUEBA') {
    return {
      tipo: 'entregar',
      titulo: 'Correo de prueba',
      mensaje: 'Correo de prueba enviado desde la administración de notificaciones.',
      plantilla: 'PRUEBA',
      datos: { destinatario: nombre, enlace: urlBase() },
    };
  }

  if (fila.tipo === 'PLAZO_ALERTA') {
    const { rows } = await pool.query<PlazoParaAviso>(
      `SELECT p.id, p.causa_id, p.estado, to_char(p.fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
              (p.responsable_id = $2::uuid OR ${sqlCausaEnAlcance('p.causa_id', '$3')}) AS accesible
         FROM plazo p
         JOIN causa c ON c.id = p.causa_id AND c.eliminado_en IS NULL
        WHERE p.id = $1`,
      [fila.plazo_id, usuario.id, alcance],
    );
    const plazo = rows[0];
    if (!plazo) return { tipo: 'cancelar', motivo: 'ORIGEN_INEXISTENTE' };
    if (!plazo.accesible) return { tipo: 'cancelar', motivo: 'SIN_ACCESO' };
    if (plazo.estado !== 'PENDIENTE') return { tipo: 'cancelar', motivo: 'PLAZO_CERRADO' };
    if (fila.datos.fecha_vencimiento && fila.datos.fecha_vencimiento !== plazo.fecha_vencimiento) {
      return { tipo: 'cancelar', motivo: 'OBSOLETO' };
    }
    const habiles = Number(fila.datos.habiles ?? NaN);
    const restante = Number.isNaN(habiles) ? undefined : `${habiles} ${habiles === 1 ? 'día hábil' : 'días hábiles'}`;
    return {
      tipo: 'entregar',
      titulo: String(fila.datos.titulo ?? 'Vencimiento próximo'),
      mensaje: String(fila.datos.mensaje ?? 'Un plazo a tu cargo vence pronto.'),
      plantilla: fila.datos.nivel === 'CRITICA' ? 'PLAZO_CRITICO' : 'PLAZO_PROXIMO',
      datos: {
        destinatario: nombre,
        fecha: plazo.fecha_vencimiento,
        restante,
        enlace: `${urlBase()}/expedientes/${plazo.causa_id}`,
      },
      alertaId: fila.alerta_id ?? undefined,
    };
  }

  // Avisos de eventos.
  const { rows } = await pool.query<EventoParaAviso>(
    `SELECT e.id, e.titulo, e.tipo, e.estado, e.version, e.todo_el_dia, e.fecha_inicio, e.causa_id,
            to_char(e.fecha_inicio AT TIME ZONE $3, 'YYYY-MM-DD') AS fecha,
            to_char(e.fecha_inicio AT TIME ZONE $3, 'HH24:MI') AS hora,
            ${sqlEventoVisible('e', '$2', '$4')} AS visible
       FROM evento_calendario e
       LEFT JOIN causa c ON c.id = e.causa_id
      WHERE e.id = $1 AND (e.causa_id IS NULL OR c.eliminado_en IS NULL)`,
    [fila.evento_id, usuario.id, config.zonaHoraria, alcance],
  );
  const evento = rows[0];
  if (!evento) return { tipo: 'cancelar', motivo: 'ORIGEN_INEXISTENTE' };
  if (!evento.visible) return { tipo: 'cancelar', motivo: 'SIN_ACCESO' };

  const hora = evento.todo_el_dia ? null : evento.hora;
  const enlace = `${urlBase()}/agenda?evento=${evento.id}`;
  const cuando = hora ? `${evento.fecha.split('-').reverse().join('/')} a las ${hora}` : evento.fecha.split('-').reverse().join('/');
  const tipoTexto = nombreTipo(evento.tipo);
  const base: DatosCorreo = { destinatario: nombre, tipoEvento: evento.tipo, fecha: evento.fecha, hora, enlace };

  switch (fila.tipo) {
    case 'RECORDATORIO_EVENTO': {
      if (evento.estado !== 'PENDIENTE' && evento.estado !== 'CONFIRMADO') return { tipo: 'cancelar', motivo: 'EVENTO_CERRADO' };
      if (evento.version !== fila.version_origen) return { tipo: 'cancelar', motivo: 'OBSOLETO' };
      const ancla = anclaDeRecordatorio(evento.fecha_inicio, evento.todo_el_dia);
      // Tras una caída larga no se avisa de algo que ya empezó.
      if (ancla.getTime() <= ahora.getTime()) return { tipo: 'cancelar', motivo: 'EVENTO_INICIADO' };
      const restante = tiempoRestante(ahora, ancla);
      return {
        tipo: 'entregar',
        titulo: `Recordatorio: ${evento.titulo}`.slice(0, 200),
        mensaje: `${tipoTexto.charAt(0).toUpperCase()}${tipoTexto.slice(1)} el ${cuando} (${restante}).`,
        plantilla: PLANTILLA_RECORDATORIO[evento.tipo] ?? 'RECORDATORIO_OTRO',
        datos: { ...base, restante },
        eventoId: evento.id,
      };
    }
    case 'EVENTO_ASIGNADO':
      if (evento.estado === 'CANCELADO' || evento.estado === 'COMPLETADO') return { tipo: 'cancelar', motivo: 'EVENTO_CERRADO' };
      if (evento.version !== fila.version_origen) return { tipo: 'cancelar', motivo: 'OBSOLETO' };
      return {
        tipo: 'entregar',
        titulo: 'Te sumaron a un evento',
        mensaje: `${evento.titulo} — ${cuando}.`.slice(0, 500),
        plantilla: 'EVENTO_ASIGNADO',
        datos: base,
        eventoId: evento.id,
      };
    case 'EVENTO_REPROGRAMADO': {
      if (evento.estado === 'CANCELADO' || evento.estado === 'COMPLETADO') return { tipo: 'cancelar', motivo: 'EVENTO_CERRADO' };
      if (evento.version !== fila.version_origen) return { tipo: 'cancelar', motivo: 'OBSOLETO' };
      const fechaAnterior = typeof fila.datos.fecha_anterior === 'string' ? fila.datos.fecha_anterior : undefined;
      const horaAnterior = typeof fila.datos.hora_anterior === 'string' ? fila.datos.hora_anterior : null;
      return {
        tipo: 'entregar',
        titulo: 'Evento reprogramado',
        mensaje: `${evento.titulo}: ahora el ${cuando}.`.slice(0, 500),
        plantilla: 'EVENTO_REPROGRAMADO',
        datos: { ...base, fechaAnterior, horaAnterior },
        eventoId: evento.id,
      };
    }
    case 'EVENTO_CANCELADO':
      if (evento.estado !== 'CANCELADO') return { tipo: 'cancelar', motivo: 'OBSOLETO' };
      return {
        tipo: 'entregar',
        titulo: 'Evento cancelado',
        mensaje: `${evento.titulo} (${cuando}) se canceló.`.slice(0, 500),
        plantilla: 'EVENTO_CANCELADO',
        datos: base,
        eventoId: evento.id,
      };
    default:
      return { tipo: 'cancelar', motivo: 'TIPO_DESCONOCIDO' };
  }
}

async function cargarDestinatario(usuarioId: string): Promise<Destinatario | undefined> {
  const { rows } = await obtenerPool().query<Destinatario>(
    `SELECT u.id, u.email, u.nombre, u.activo, r.codigo AS rol
       FROM usuario u JOIN rol r ON r.id = u.rol_id
      WHERE u.id = $1`,
    [usuarioId],
  );
  return rows[0];
}

async function procesarUno(fila: FilaEnvio, ahora: Date): Promise<'aceptado' | 'cancelado' | 'fallido' | 'reintento'> {
  if (fila.intentos > MAXIMO_INTENTOS) {
    await finalizar(fila.id, 'FALLIDO', { error: 'Se agotaron los intentos (el proceso anterior no terminó).' });
    return 'fallido';
  }

  const usuario = await cargarDestinatario(fila.usuario_id);
  if (!usuario || !usuario.activo) {
    await finalizar(fila.id, 'CANCELADO', { motivo: 'USUARIO_INACTIVO' });
    return 'cancelado';
  }

  // Avisos inmediatos que llegan demasiado tarde: se descartan.
  if (
    fila.tipo !== 'RECORDATORIO_EVENTO' &&
    fila.tipo !== 'PRUEBA' &&
    ahora.getTime() - fila.programado_para.getTime() > HORAS_VIGENCIA_AVISO * 3_600_000
  ) {
    await finalizar(fila.id, 'CANCELADO', { motivo: 'DESACTUALIZADO' });
    return 'cancelado';
  }

  let proveedor = null as ReturnType<typeof proveedorActual>;
  if (fila.canal === 'EMAIL') {
    proveedor = proveedorActual();
    if (!proveedor) {
      await finalizar(fila.id, 'CANCELADO', { motivo: 'CORREO_DESHABILITADO' });
      return 'cancelado';
    }
  }

  const decision = await decidir(fila, usuario, ahora);
  if (decision.tipo === 'cancelar') {
    await finalizar(fila.id, 'CANCELADO', { motivo: decision.motivo });
    return 'cancelado';
  }

  if (fila.canal === 'IN_APP') {
    // Inserción del aviso y cierre de la entrega en una transacción: no puede
    // quedar un aviso duplicado si el proceso se corta entre los dos pasos.
    await enTransaccion(async (cliente) => {
      const { rows } = await cliente.query<{ id: string }>(
        `INSERT INTO notificacion (usuario_id, alerta_id, evento_id, titulo, mensaje, canal, enviada_en)
         VALUES ($1, $2, $3, $4, $5, 'IN_APP', now())
         RETURNING id`,
        [usuario.id, decision.alertaId ?? null, decision.eventoId ?? null, decision.titulo, decision.mensaje],
      );
      await cliente.query(
        `UPDATE envio_notificacion
            SET estado = 'ACEPTADO', aceptado_en = now(), notificacion_id = $2, bloqueado_hasta = NULL
          WHERE id = $1`,
        [fila.id, rows[0]!.id],
      );
    });
    return 'aceptado';
  }

  // Correo: preferencias del destinatario, revalidadas ahora.
  const preferencias = await preferenciasDe(usuario.id);
  if (!correoPermitido(fila.tipo, decision.datos.tipoEvento, preferencias)) {
    await finalizar(fila.id, 'CANCELADO', { motivo: 'PREFERENCIA' });
    return 'cancelado';
  }

  const correo = armarCorreo(decision.plantilla, decision.datos);
  let idExterno: string;
  try {
    ({ idExterno } = await proveedor!.enviar({
      para: usuario.email,
      asunto: correo.asunto,
      html: correo.html,
      texto: correo.texto,
      claveIdempotencia: fila.clave_idempotencia,
    }));
  } catch (error) {
    if (error instanceof ErrorProveedorCorreo && !error.transitorio) {
      await finalizar(fila.id, 'FALLIDO', { error: error.message });
      return 'fallido';
    }
    const mensaje = error instanceof ErrorProveedorCorreo ? error.message : 'Error inesperado al enviar.';
    if (!(error instanceof ErrorProveedorCorreo)) console.error('[cola] error inesperado al enviar', fila.id, error);
    return reprogramarReintento(fila, mensaje);
  }

  // Aceptado por el proveedor: queda registrado como entrega EMAIL. No cuenta
  // en la campana (que solo muestra IN_APP).
  await enTransaccion(async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO notificacion (usuario_id, alerta_id, evento_id, titulo, mensaje, canal, enviada_en)
       VALUES ($1, $2, $3, $4, $5, 'EMAIL', now())
       RETURNING id`,
      [usuario.id, decision.alertaId ?? null, decision.eventoId ?? null, correo.asunto.slice(0, 200), decision.mensaje],
    );
    await cliente.query(
      `UPDATE envio_notificacion
          SET estado = 'ACEPTADO', aceptado_en = now(), id_externo = $2, notificacion_id = $3,
              bloqueado_hasta = NULL, ultimo_error = NULL
        WHERE id = $1`,
      [fila.id, idExterno.slice(0, 200), rows[0]!.id],
    );
  });
  return 'aceptado';
}

/** Recorre la cola y entrega lo que corresponde. Devuelve los contadores. */
export async function procesarCola(opciones: OpcionesProceso = {}): Promise<ResultadoProceso> {
  const resultado: ResultadoProceso = { procesados: 0, aceptados: 0, fallidos: 0, cancelados: 0, reintentos: 0 };
  const inicio = Date.now();
  const limiteTotal = opciones.limite ?? 200;

  while (resultado.procesados < limiteTotal) {
    if (opciones.tiempoMaximoMs && Date.now() - inicio > opciones.tiempoMaximoMs) break;
    const lote = await tomarLote({ ...opciones, limite: Math.min(25, limiteTotal - resultado.procesados) });
    if (lote.length === 0) break;

    for (const fila of lote) {
      resultado.procesados += 1;
      let salida: Awaited<ReturnType<typeof procesarUno>>;
      try {
        salida = await procesarUno(fila, new Date());
      } catch (error) {
        console.error('[cola] no se pudo procesar la entrega', fila.id, error);
        salida = await reprogramarReintento(fila, 'Error interno al procesar.').catch(() => 'reintento' as const);
      }
      if (salida === 'aceptado') resultado.aceptados += 1;
      else if (salida === 'cancelado') resultado.cancelados += 1;
      else if (salida === 'fallido') resultado.fallidos += 1;
      else resultado.reintentos += 1;
    }
    if (opciones.ids) break;
  }
  return resultado;
}
