import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { crearApp } from '../src/app';
import { cerrarPool, obtenerPool } from '../src/db';
import { config } from '../src/config';
import { hoy } from '../src/comun/ruta';
import { sumarDias } from '../src/modulos/agenda/fechas';
import { encolar, procesarCola, MAXIMO_INTENTOS, tiempoRestante } from '../src/modulos/notificaciones/cola';
import {
  correosSimulados,
  crearProveedorSimulado,
  ErrorProveedorCorreo,
  usarProveedorDePrueba,
  vaciarCorreosSimulados,
  type ProveedorCorreo,
} from '../src/modulos/notificaciones/correo';
import { armarCorreo, PLANTILLAS, datosDeEjemplo } from '../src/modulos/notificaciones/plantillas';
import {
  asignarAExpediente,
  conSesion,
  crearUsuarioInactivo,
  iniciarSesion,
  limpiarDatosDePrueba,
  PREFIJO_PRUEBA,
  USUARIOS_DEMO,
  type SesionDePrueba,
} from './ayudas';

/**
 * Notificaciones: cola persistente, proveedor de correo (simulado), revalidación
 * antes de entregar, preferencias, bandeja y programador externo.
 *
 * Ningún caso usa un proveedor real ni un destinatario real: el proveedor se
 * reemplaza por uno simulado o por uno que falla a pedido.
 */

const app = crearApp();
const hayBase = Boolean(config.urlBaseDatos);

let admin: SesionDePrueba;
let jefe: SesionDePrueba;
let empleado: SesionDePrueba;

const dentroDe = (dias: number) => sumarDias(hoy(), dias);
const titulo = (texto: string) => `${PREFIJO_PRUEBA}${texto} ${Math.random().toString(36).slice(2, 7)}`;

beforeAll(async () => {
  if (!hayBase) return;
  [admin, jefe, empleado] = await Promise.all([
    iniciarSesion(app, USUARIOS_DEMO.admin),
    iniciarSesion(app, USUARIOS_DEMO.jefe),
    iniciarSesion(app, USUARIOS_DEMO.empleado),
  ]);
  // Lo que otras pruebas dejaron vencido no debe mezclarse con estas.
  await obtenerPool().query(`UPDATE envio_notificacion SET estado = 'CANCELADO', motivo_cancelacion = 'PRUEBAS'
                              WHERE estado IN ('PENDIENTE', 'PROCESANDO')`);
});

afterEach(() => {
  usarProveedorDePrueba(undefined);
  vaciarCorreosSimulados();
});

afterAll(async () => {
  if (hayBase) {
    await obtenerPool().query(
      `DELETE FROM preferencia_notificacion WHERE usuario_id IN (SELECT id FROM usuario WHERE email LIKE '%@estudiodemo.test')`,
    );
  }
  await limpiarDatosDePrueba();
  await cerrarPool();
});

async function crearEvento(sesion: SesionDePrueba, extra: Record<string, unknown> = {}) {
  const respuesta = await conSesion(request(app).post('/api/agenda/eventos'), sesion).send({
    titulo: titulo('Reunión confidencial Pérez'),
    tipo: 'REUNION',
    fecha_inicio: dentroDe(7),
    hora_inicio: '16:00',
    ...extra,
  });
  expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(201);
  return respuesta.body.evento as { id: string; titulo: string };
}

async function envio(eventoId: string, tipo: string, canal: string, usuarioId: string) {
  const { rows } = await obtenerPool().query<{
    id: string;
    estado: string;
    intentos: number;
    motivo_cancelacion: string | null;
    ultimo_error: string | null;
    id_externo: string | null;
    proximo_intento: Date;
  }>(
    `SELECT id, estado, intentos, motivo_cancelacion, ultimo_error, id_externo, proximo_intento
       FROM envio_notificacion WHERE evento_id = $1 AND tipo = $2 AND canal = $3 AND usuario_id = $4`,
    [eventoId, tipo, canal, usuarioId],
  );
  return rows[0]!;
}

/** Proveedor que cuenta llamadas y falla según se le pida. */
function proveedorControlado(falla?: 'transitoria' | 'definitiva'): ProveedorCorreo & { llamadas: number } {
  const simulado = crearProveedorSimulado();
  const proveedor = {
    nombre: 'controlado',
    llamadas: 0,
    async enviar(mensaje: Parameters<ProveedorCorreo['enviar']>[0]) {
      proveedor.llamadas += 1;
      if (falla === 'transitoria') throw new ErrorProveedorCorreo('El proveedor respondió 503 (servicio caído).', true);
      if (falla === 'definitiva') throw new ErrorProveedorCorreo('El proveedor respondió 422 (validation_error).', false);
      return simulado.enviar(mensaje);
    },
  };
  return proveedor;
}

describe('plantillas y utilidades', () => {
  it('cada plantilla tiene HTML y texto, sin datos sensibles de ejemplo', () => {
    for (const plantilla of PLANTILLAS) {
      const correo = armarCorreo(plantilla, datosDeEjemplo(plantilla, 'https://app.example'));
      expect(correo.asunto.length).toBeGreaterThan(5);
      expect(correo.html).toContain('SistemaLegal');
      expect(correo.html).toContain('https://app.example');
      expect(correo.texto).toContain('no certifica ningún vencimiento');
    }
  });

  it('escapa el contenido dinámico', () => {
    const correo = armarCorreo('PRUEBA', { destinatario: '<script>x</script>', enlace: 'https://app.example' });
    expect(correo.html).not.toContain('<script>x');
    expect(correo.html).toContain('&lt;script&gt;');
  });

  it('expresa el tiempo restante', () => {
    const ahora = new Date('2026-12-01T12:00:00Z');
    expect(tiempoRestante(ahora, new Date('2026-12-02T12:00:00Z'))).toBe('en 24 horas');
    expect(tiempoRestante(ahora, new Date('2026-12-01T13:00:00Z'))).toBe('en 1 hora');
    expect(tiempoRestante(ahora, new Date('2026-12-04T12:00:00Z'))).toBe('en 3 días');
  });

  it('"hoy" es la fecha del estudio, no la del servidor en UTC', () => {
    // 01:30 UTC del 27 son las 22:30 del 26 en Argentina.
    expect(hoy(new Date('2026-11-27T01:30:00Z'))).toBe('2026-11-26');
    expect(hoy(new Date('2026-11-27T03:30:00Z'))).toBe('2026-11-27');
  });
});

describe.skipIf(!hayBase)('cola de entregas', () => {
  it('entrega el aviso interno y el correo, y la campana cuenta solo lo interno', async () => {
    usarProveedorDePrueba(crearProveedorSimulado());
    const evento = await crearEvento(admin, { participantes: [jefe.usuario.id], visibilidad: 'PARTICIPANTES' });

    const antes = await conSesion(request(app).get('/api/notificaciones'), jefe);
    const noLeidasAntes = antes.body.no_leidas as number;
    // Al abrir la bandeja se entregó el aviso interno de la asignación.
    expect(antes.body.datos.some((n: { evento_id: string }) => n.evento_id === evento.id)).toBe(true);

    const resultado = await procesarCola({ usuarioId: jefe.usuario.id, soloCanal: 'EMAIL' });
    expect(resultado.aceptados).toBeGreaterThanOrEqual(1);
    const correo = await envio(evento.id, 'EVENTO_ASIGNADO', 'EMAIL', jefe.usuario.id);
    expect(correo.estado).toBe('ACEPTADO');
    expect(correo.id_externo).toMatch(/^simulado-/);

    // El correo no lleva el título del evento (puede nombrar a un cliente).
    const enviado = correosSimulados().find((c) => c.claveIdempotencia.includes(evento.id));
    expect(enviado).toBeTruthy();
    expect(enviado!.html).not.toContain('Pérez');
    expect(enviado!.texto).not.toContain('Pérez');

    const despues = await conSesion(request(app).get('/api/notificaciones'), jefe);
    expect(despues.body.no_leidas).toBe(noLeidasAntes);
    expect(despues.body.datos.every((n: { titulo: string }) => !n.titulo.startsWith('Te sumaron a una reunión:'))).toBe(true);

    // Marcar todo como leído no toca los registros de correo.
    await conSesion(request(app).post('/api/notificaciones/leer-todas'), jefe);
    const { rows } = await obtenerPool().query<{ leidas: number }>(
      `SELECT count(*)::int AS leidas FROM notificacion WHERE usuario_id = $1 AND canal = 'EMAIL' AND leida_en IS NOT NULL`,
      [jefe.usuario.id],
    );
    expect(rows[0]!.leidas).toBe(0);
  });

  it('respeta las preferencias de correo, pero no apaga el aviso interno', async () => {
    usarProveedorDePrueba(crearProveedorSimulado());
    const guardado = await conSesion(request(app).put('/api/cuenta/notificaciones'), jefe).send({
      correo_habilitado: true,
      recordatorio_audiencia: true,
      recordatorio_mediacion: true,
      recordatorio_reunion: true,
      recordatorio_otros: true,
      aviso_plazos: true,
      aviso_asignaciones: false,
      aviso_reprogramaciones: true,
      aviso_cancelaciones: true,
    });
    expect(guardado.status).toBe(200);
    expect((await conSesion(request(app).get('/api/cuenta/notificaciones'), jefe)).body.preferencias.aviso_asignaciones).toBe(false);

    const evento = await crearEvento(admin, { participantes: [jefe.usuario.id] });
    await procesarCola({ usuarioId: jefe.usuario.id });
    expect((await envio(evento.id, 'EVENTO_ASIGNADO', 'EMAIL', jefe.usuario.id))).toMatchObject({
      estado: 'CANCELADO',
      motivo_cancelacion: 'PREFERENCIA',
    });
    expect((await envio(evento.id, 'EVENTO_ASIGNADO', 'IN_APP', jefe.usuario.id)).estado).toBe('ACEPTADO');
    await obtenerPool().query('DELETE FROM preferencia_notificacion WHERE usuario_id = $1', [jefe.usuario.id]);
  });

  it('con el correo deshabilitado, cancela sin enviar', async () => {
    usarProveedorDePrueba(null);
    const evento = await crearEvento(admin, { participantes: [empleado.usuario.id] });
    await procesarCola({ usuarioId: empleado.usuario.id });
    expect(await envio(evento.id, 'EVENTO_ASIGNADO', 'EMAIL', empleado.usuario.id)).toMatchObject({
      estado: 'CANCELADO',
      motivo_cancelacion: 'CORREO_DESHABILITADO',
    });
    expect((await envio(evento.id, 'EVENTO_ASIGNADO', 'IN_APP', empleado.usuario.id)).estado).toBe('ACEPTADO');
  });

  it('reintenta las fallas transitorias y se rinde al agotar los intentos', async () => {
    const proveedor = proveedorControlado('transitoria');
    usarProveedorDePrueba(proveedor);
    const evento = await crearEvento(admin, { participantes: [empleado.usuario.id] });

    await procesarCola({ usuarioId: empleado.usuario.id, soloCanal: 'EMAIL' });
    let fila = await envio(evento.id, 'EVENTO_ASIGNADO', 'EMAIL', empleado.usuario.id);
    expect(fila).toMatchObject({ estado: 'PENDIENTE', intentos: 1 });
    expect(fila.ultimo_error).toMatch(/503/);
    expect(fila.proximo_intento.getTime()).toBeGreaterThan(Date.now());

    for (let i = 1; i < MAXIMO_INTENTOS; i += 1) {
      await obtenerPool().query('UPDATE envio_notificacion SET proximo_intento = now() WHERE id = $1', [fila.id]);
      await procesarCola({ ids: [fila.id] });
    }
    fila = await envio(evento.id, 'EVENTO_ASIGNADO', 'EMAIL', empleado.usuario.id);
    expect(fila).toMatchObject({ estado: 'FALLIDO', intentos: MAXIMO_INTENTOS });
    expect(proveedor.llamadas).toBe(MAXIMO_INTENTOS);
  });

  it('una falla definitiva no se reintenta', async () => {
    usarProveedorDePrueba(proveedorControlado('definitiva'));
    const evento = await crearEvento(admin, { participantes: [empleado.usuario.id] });
    await procesarCola({ usuarioId: empleado.usuario.id, soloCanal: 'EMAIL' });
    expect(await envio(evento.id, 'EVENTO_ASIGNADO', 'EMAIL', empleado.usuario.id)).toMatchObject({
      estado: 'FALLIDO',
      intentos: 1,
    });
  });

  it('dos procesos a la vez no entregan dos veces lo mismo', async () => {
    const proveedor = proveedorControlado();
    usarProveedorDePrueba(proveedor);
    const participantes = [jefe.usuario.id, empleado.usuario.id];
    await Promise.all([1, 2, 3].map(() => crearEvento(admin, { participantes })));
    const { rows } = await obtenerPool().query<{ total: number }>(
      `SELECT count(*)::int AS total FROM envio_notificacion
        WHERE estado = 'PENDIENTE' AND proximo_intento <= now() AND canal = 'EMAIL'`,
    );
    const [a, b] = await Promise.all([procesarCola({ soloCanal: 'EMAIL' }), procesarCola({ soloCanal: 'EMAIL' })]);
    expect(a.procesados + b.procesados).toBe(rows[0]!.total);
    expect(proveedor.llamadas).toBe(a.aceptados + b.aceptados);
  });

  it('retoma una entrega abandonada sin duplicar el correo', async () => {
    const proveedor = proveedorControlado();
    usarProveedorDePrueba(proveedor);
    const evento = await crearEvento(admin, { participantes: [jefe.usuario.id] });
    const fila = await envio(evento.id, 'EVENTO_ASIGNADO', 'EMAIL', jefe.usuario.id);

    // Simula un proceso que tomó la entrega, el proveedor la aceptó y el
    // proceso murió antes de registrarla.
    await proveedor.enviar({ para: 'x@estudiodemo.test', asunto: 'x', html: 'x', texto: 'x', claveIdempotencia: `EVENTO_ASIGNADO:${evento.id}:v1:${jefe.usuario.id}:EMAIL` });
    await obtenerPool().query(
      `UPDATE envio_notificacion SET estado = 'PROCESANDO', intentos = 1, bloqueado_hasta = now() - interval '1 minute'
        WHERE id = $1`,
      [fila.id],
    );
    const antes = correosSimulados().length;
    await procesarCola({ ids: [fila.id] });
    expect((await envio(evento.id, 'EVENTO_ASIGNADO', 'EMAIL', jefe.usuario.id)).estado).toBe('ACEPTADO');
    // La clave de idempotencia evitó un segundo mensaje.
    expect(correosSimulados().length).toBe(antes);
  });

  it('no entrega a quien perdió el acceso al expediente antes del envío', async () => {
    usarProveedorDePrueba(crearProveedorSimulado());
    const catalogos = await conSesion(request(app).get('/api/catalogos'), admin);
    const causa = await conSesion(request(app).post('/api/causas'), admin).send({
      caratula: `${PREFIJO_PRUEBA}NOTIF ${Date.now()}`,
      fuero_id: catalogos.body.fueros[0].id,
      estado_causa_id: catalogos.body.estados[0].id,
      fecha_inicio: '2026-02-01',
    });
    const causaId = causa.body.causa.id as string;
    await asignarAExpediente(app, admin, causaId, empleado.usuario.id);
    const evento = await crearEvento(admin, { causa_id: causaId, participantes: [empleado.usuario.id] });

    await obtenerPool().query(
      'UPDATE profesional_causa SET fecha_baja = CURRENT_DATE WHERE causa_id = $1 AND usuario_id = $2',
      [causaId, empleado.usuario.id],
    );
    await procesarCola({ usuarioId: empleado.usuario.id });
    for (const canal of ['IN_APP', 'EMAIL']) {
      expect(await envio(evento.id, 'EVENTO_ASIGNADO', canal, empleado.usuario.id)).toMatchObject({
        estado: 'CANCELADO',
        motivo_cancelacion: 'SIN_ACCESO',
      });
    }
  });

  it('no entrega a un usuario dado de baja', async () => {
    usarProveedorDePrueba(crearProveedorSimulado());
    const inactivo = await crearUsuarioInactivo();
    await encolar(obtenerPool(), [
      { usuarioId: inactivo, canal: 'EMAIL', tipo: 'PRUEBA', clave: `PRUEBA:${inactivo}` },
    ]);
    await procesarCola({ usuarioId: inactivo });
    const { rows } = await obtenerPool().query(
      'SELECT estado, motivo_cancelacion FROM envio_notificacion WHERE usuario_id = $1',
      [inactivo],
    );
    expect(rows[0]).toMatchObject({ estado: 'CANCELADO', motivo_cancelacion: 'USUARIO_INACTIVO' });
  });

  it('no recuerda un evento que ya empezó (recuperación tras una caída)', async () => {
    usarProveedorDePrueba(crearProveedorSimulado());
    const evento = await crearEvento(admin, { tipo: 'AUDIENCIA' });
    // El evento "ya pasó" y su recordatorio quedó pendiente.
    await obtenerPool().query(
      `UPDATE evento_calendario SET fecha_inicio = now() - interval '2 hours', fecha_fin = now() - interval '1 hour' WHERE id = $1`,
      [evento.id],
    );
    await obtenerPool().query(
      `UPDATE envio_notificacion SET proximo_intento = now() WHERE evento_id = $1 AND tipo = 'RECORDATORIO_EVENTO'`,
      [evento.id],
    );
    await procesarCola({ usuarioId: admin.usuario.id });
    const { rows } = await obtenerPool().query<{ estado: string; motivo_cancelacion: string }>(
      `SELECT estado, motivo_cancelacion FROM envio_notificacion WHERE evento_id = $1 AND tipo = 'RECORDATORIO_EVENTO'`,
      [evento.id],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.estado === 'CANCELADO' && r.motivo_cancelacion === 'EVENTO_INICIADO')).toBe(true);
  });

  it('una clave repetida no duplica la entrega', async () => {
    const clave = `PRUEBA:duplicado:${Date.now()}`;
    const envio = { usuarioId: admin.usuario.id, canal: 'EMAIL' as const, tipo: 'PRUEBA' as const, clave };
    expect(await encolar(obtenerPool(), [envio])).toBe(1);
    expect(await encolar(obtenerPool(), [envio])).toBe(0);
    await obtenerPool().query('DELETE FROM envio_notificacion WHERE clave_idempotencia = $1', [clave]);
  });
});

describe.skipIf(!hayBase)('programador y administración', () => {
  it('sin CRON_SECRET el endpoint no existe abierto', async () => {
    const original = config.secretoProgramador;
    (config as { secretoProgramador?: string }).secretoProgramador = undefined;
    const respuesta = await request(app).post('/api/interno/programador');
    expect(respuesta.status).toBe(503);
    (config as { secretoProgramador?: string }).secretoProgramador = original;
  });

  it('rechaza un secreto incorrecto y acepta el correcto', async () => {
    const original = config.secretoProgramador;
    const secreto = 'secreto-de-prueba-'.padEnd(48, 'x');
    (config as { secretoProgramador?: string }).secretoProgramador = secreto;
    try {
      expect((await request(app).post('/api/interno/programador')).status).toBe(401);
      expect((await request(app).post('/api/interno/programador').set('Authorization', 'Bearer otro')).status).toBe(401);
      // Un token de usuario no sirve como secreto del programador.
      expect(
        (await request(app).post('/api/interno/programador').set('Authorization', `Bearer ${admin.accessToken}`)).status,
      ).toBe(401);
      usarProveedorDePrueba(crearProveedorSimulado());
      const ok = await request(app).post('/api/interno/programador').set('Authorization', `Bearer ${secreto}`);
      expect(ok.status).toBe(200);
      expect(Object.keys(ok.body).sort()).toEqual(
        ['aceptados', 'alertas_creadas', 'cancelados', 'fallidos', 'pendientes', 'procesados', 'reintentos'].sort(),
      );
      const { rows } = await obtenerPool().query(
        `SELECT origen, finalizado_en FROM ejecucion_programador ORDER BY iniciado_en DESC LIMIT 1`,
      );
      expect(rows[0]).toMatchObject({ origen: 'PROGRAMADOR' });
      expect(rows[0].finalizado_en).toBeTruthy();
    } finally {
      (config as { secretoProgramador?: string }).secretoProgramador = original;
    }
  });

  it('la administración es solo del Administrador y no muestra secretos', async () => {
    expect((await conSesion(request(app).get('/api/notificaciones/administracion'), jefe)).status).toBe(403);
    expect((await conSesion(request(app).get('/api/notificaciones/administracion'), empleado)).status).toBe(403);

    const estado = await conSesion(request(app).get('/api/notificaciones/administracion'), admin);
    expect(estado.status).toBe(200);
    expect(estado.body.correo).toHaveProperty('modo');
    const texto = JSON.stringify(estado.body);
    if (process.env.RESEND_API_KEY) expect(texto).not.toContain(process.env.RESEND_API_KEY);
    if (process.env.CRON_SECRET) expect(texto).not.toContain(process.env.CRON_SECRET);

    const vista = await conSesion(request(app).get('/api/notificaciones/administracion/plantillas/RECORDATORIO_AUDIENCIA'), admin);
    expect(vista.status).toBe(200);
    expect(vista.body.html).toContain('Recordatorio');
    expect((await conSesion(request(app).get('/api/notificaciones/administracion/plantillas/OTRA'), admin)).status).toBe(400);
  });

  it('el correo de prueba va solo a quien lo pide', async () => {
    usarProveedorDePrueba(null);
    const deshabilitado = await conSesion(request(app).post('/api/notificaciones/administracion/prueba'), admin);
    expect(deshabilitado.status).toBe(409);

    usarProveedorDePrueba(crearProveedorSimulado());
    const prueba = await conSesion(request(app).post('/api/notificaciones/administracion/prueba'), admin);
    expect(prueba.status).toBe(200);
    expect(prueba.body.estado).toBe('ACEPTADO');
    expect(correosSimulados().at(-1)?.para).toBe(USUARIOS_DEMO.admin.email);
  });

  it('reintentar solo aplica a envíos fallidos', async () => {
    const { rows } = await obtenerPool().query<{ id: string }>(
      `INSERT INTO envio_notificacion (usuario_id, canal, tipo, programado_para, proximo_intento, estado, intentos,
                                       clave_idempotencia, ultimo_error)
       VALUES ($1, 'EMAIL', 'PRUEBA', now(), now(), 'FALLIDO', 5, $2, 'El proveedor respondió 503.')
       RETURNING id`,
      [admin.usuario.id, `PRUEBA:fallido:${Date.now()}`],
    );
    const id = rows[0]!.id;
    const ok = await conSesion(request(app).post(`/api/notificaciones/administracion/envios/${id}/reintentar`), admin);
    expect(ok.status).toBe(200);
    const otra = await conSesion(request(app).post(`/api/notificaciones/administracion/envios/${id}/reintentar`), admin);
    expect(otra.status).toBe(409);
    await obtenerPool().query('DELETE FROM envio_notificacion WHERE id = $1', [id]);
  });
});

describe.skipIf(!hayBase)('alertas de plazos por correo', () => {
  it('una alerta nueva programa un correo y evaluar de nuevo no lo duplica', async () => {
    const catalogos = await conSesion(request(app).get('/api/catalogos'), admin);
    const causa = await conSesion(request(app).post('/api/causas'), admin).send({
      caratula: `${PREFIJO_PRUEBA}ALERTA ${Date.now()}`,
      fuero_id: catalogos.body.fueros[0].id,
      estado_causa_id: catalogos.body.estados[0].id,
      fecha_inicio: '2026-02-01',
    });
    const plazo = await conSesion(request(app).post(`/api/causas/${causa.body.causa.id}/plazos`), admin).send({
      descripcion: 'Contestar traslado',
      fecha_notificacion: hoy(),
      cantidad_dias: 1,
      computo: 'HABIL',
      responsable_id: admin.usuario.id,
    });
    expect(plazo.status).toBe(201);

    await conSesion(request(app).post('/api/alertas/evaluar'), admin);
    await conSesion(request(app).post('/api/alertas/evaluar'), admin);
    const { rows } = await obtenerPool().query<{ total: number }>(
      `SELECT count(*)::int AS total FROM envio_notificacion WHERE plazo_id = $1 AND tipo = 'PLAZO_ALERTA'`,
      [plazo.body.plazo.id],
    );
    expect(rows[0]!.total).toBe(1);
  });
});
