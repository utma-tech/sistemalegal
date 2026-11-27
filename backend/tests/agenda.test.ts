import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { crearApp } from '../src/app';
import { cerrarPool, obtenerPool } from '../src/db';
import { config } from '../src/config';
import { sumarDias } from '../src/modulos/agenda/fechas';
import { hoy } from '../src/comun/ruta';
import {
  asignarAExpediente,
  conSesion,
  iniciarSesion,
  limpiarDatosDePrueba,
  PREFIJO_PRUEBA,
  USUARIOS_DEMO,
  type SesionDePrueba,
} from './ayudas';

/**
 * Agenda jurídica (src/modulos/agenda): eventos, vista unificada, visibilidad,
 * alcance por expediente y programación de recordatorios.
 */

const app = crearApp();
const hayBase = Boolean(config.urlBaseDatos);

let admin: SesionDePrueba;
let jefe: SesionDePrueba;
let empleado: SesionDePrueba;
let empleado2: SesionDePrueba;

const dentroDe = (dias: number) => sumarDias(hoy(), dias);
const titulo = (texto: string) => `${PREFIJO_PRUEBA}${texto} ${Math.random().toString(36).slice(2, 7)}`;

beforeAll(async () => {
  if (!hayBase) return;
  [admin, jefe, empleado, empleado2] = await Promise.all([
    iniciarSesion(app, USUARIOS_DEMO.admin),
    iniciarSesion(app, USUARIOS_DEMO.jefe),
    iniciarSesion(app, USUARIOS_DEMO.empleado),
    iniciarSesion(app, USUARIOS_DEMO.empleado2),
  ]);
});

afterAll(async () => {
  await limpiarDatosDePrueba();
  await cerrarPool();
});

async function crearExpediente(sesion: SesionDePrueba): Promise<string> {
  const catalogos = await conSesion(request(app).get('/api/catalogos'), sesion);
  const creada = await conSesion(request(app).post('/api/causas'), sesion).send({
    caratula: `${PREFIJO_PRUEBA}AGENDA ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fuero_id: catalogos.body.fueros[0].id,
    estado_causa_id: catalogos.body.estados[0].id,
    fecha_inicio: '2026-02-01',
  });
  expect(creada.status).toBe(201);
  return creada.body.causa.id as string;
}

function evento(extra: Record<string, unknown> = {}) {
  return {
    titulo: titulo('Audiencia'),
    tipo: 'AUDIENCIA',
    fecha_inicio: dentroDe(10),
    hora_inicio: '09:30',
    hora_fin: '11:00',
    ...extra,
  };
}

async function crearEvento(sesion: SesionDePrueba, extra: Record<string, unknown> = {}) {
  const respuesta = await conSesion(request(app).post('/api/agenda/eventos'), sesion).send(evento(extra));
  expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(201);
  return respuesta.body.evento as { id: string; version: number; [k: string]: unknown };
}

async function envios(eventoId: string) {
  const { rows } = await obtenerPool().query<{
    tipo: string;
    canal: string;
    estado: string;
    usuario_id: string;
    version_origen: number;
    minutos_antes: number | null;
    motivo_cancelacion: string | null;
  }>(
    `SELECT tipo, canal, estado, usuario_id, version_origen, minutos_antes, motivo_cancelacion
       FROM envio_notificacion WHERE evento_id = $1`,
    [eventoId],
  );
  return rows;
}

describe.skipIf(!hayBase)('eventos de agenda', () => {
  it('crea una audiencia con hora y la devuelve en hora del estudio', async () => {
    const creado = await crearEvento(admin, { lugar: 'Tribunales II', enlace_virtual: 'https://meet.example/abc' });
    expect(creado).toMatchObject({
      tipo: 'AUDIENCIA',
      estado: 'PENDIENTE',
      fecha_inicio: dentroDe(10),
      hora_inicio: '09:30',
      hora_fin: '11:00',
      todo_el_dia: false,
      version: 1,
      puede_editar: true,
    });
    // Recordatorios por defecto de una audiencia: 24 h y 1 h antes.
    expect(creado.recordatorios).toEqual([1440, 60]);

    const historial = await conSesion(request(app).get(`/api/agenda/eventos/${creado.id}/historial`), admin);
    expect(historial.status).toBe(200);
    expect(historial.body.datos.map((h: { accion: string }) => h.accion)).toEqual(['CREADO']);

    // Responsable implícito: quien lo crea. 2 anticipaciones × 2 canales.
    const programados = (await envios(creado.id)).filter((e) => e.tipo === 'RECORDATORIO_EVENTO');
    expect(programados).toHaveLength(4);
    expect(new Set(programados.map((e) => e.canal))).toEqual(new Set(['IN_APP', 'EMAIL']));
  });

  it('rechaza datos incoherentes', async () => {
    const casos = [
      { hora_inicio: '', todo_el_dia: false },
      { fecha_fin: dentroDe(5) },
      { hora_fin: '08:00' },
      { enlace_virtual: 'http://inseguro.example' },
      { enlace_virtual: 'javascript:alert(1)' },
      { visibilidad: 'PERSONAL', participantes: [empleado.usuario.id] },
      { tipo: 'FERIADO' },
    ];
    for (const caso of casos) {
      const respuesta = await conSesion(request(app).post('/api/agenda/eventos'), admin).send(evento(caso));
      expect(respuesta.status, JSON.stringify(caso)).toBe(400);
    }
  });

  it('un evento de varios días completos aparece en todo su rango', async () => {
    const creado = await crearEvento(admin, {
      tipo: 'OTRO',
      todo_el_dia: true,
      hora_inicio: '',
      hora_fin: '',
      fecha_inicio: dentroDe(20),
      fecha_fin: dentroDe(22),
    });
    expect(creado).toMatchObject({ fecha_inicio: dentroDe(20), fecha_fin: dentroDe(22), todo_el_dia: true });

    const agenda = await conSesion(
      request(app).get(`/api/agenda?desde=${dentroDe(21)}&hasta=${dentroDe(21)}`),
      admin,
    );
    expect(agenda.status).toBe(200);
    const item = agenda.body.datos.find((i: { id: string }) => i.id === creado.id);
    expect(item).toMatchObject({ origen: 'EVENTO', inicio: dentroDe(20), fin: dentroDe(22), todo_el_dia: true });
  });

  it('un evento cerca de medianoche no cambia de día', async () => {
    const creado = await crearEvento(admin, { hora_inicio: '23:30', hora_fin: '' });
    expect(creado).toMatchObject({ fecha_inicio: dentroDe(10), hora_inicio: '23:30', fecha_fin: dentroDe(11), hora_fin: '00:30' });
  });

  it('reprogramar invalida los recordatorios viejos y avisa a los participantes', async () => {
    const creado = await crearEvento(admin, { participantes: [jefe.usuario.id], visibilidad: 'PARTICIPANTES' });
    const antes = await envios(creado.id);
    expect(antes.filter((e) => e.tipo === 'EVENTO_ASIGNADO' && e.usuario_id === jefe.usuario.id)).toHaveLength(2);

    const editado = await conSesion(request(app).put(`/api/agenda/eventos/${creado.id}`), admin).send(
      evento({
        titulo: creado.titulo,
        participantes: [jefe.usuario.id],
        visibilidad: 'PARTICIPANTES',
        fecha_inicio: dentroDe(12),
        hora_inicio: '10:00',
        hora_fin: '11:00',
      }),
    );
    expect(editado.status, JSON.stringify(editado.body)).toBe(200);
    expect(editado.body.evento).toMatchObject({ version: 2, fecha_inicio: dentroDe(12), hora_inicio: '10:00' });

    const despues = await envios(creado.id);
    const viejos = despues.filter((e) => e.tipo === 'RECORDATORIO_EVENTO' && e.version_origen === 1);
    const nuevos = despues.filter((e) => e.tipo === 'RECORDATORIO_EVENTO' && e.version_origen === 2);
    expect(viejos.every((e) => e.estado === 'CANCELADO' && e.motivo_cancelacion === 'OBSOLETO')).toBe(true);
    expect(nuevos.length).toBe(8); // 2 destinatarios × 2 anticipaciones × 2 canales
    expect(nuevos.every((e) => e.estado === 'PENDIENTE')).toBe(true);
    // Aviso de reprogramación al participante; al que editó no.
    const reprogramacion = despues.filter((e) => e.tipo === 'EVENTO_REPROGRAMADO');
    expect(reprogramacion.map((e) => e.usuario_id)).toEqual([jefe.usuario.id, jefe.usuario.id]);

    const historial = await conSesion(request(app).get(`/api/agenda/eventos/${creado.id}/historial`), jefe);
    expect(historial.body.datos[0]).toMatchObject({ accion: 'REPROGRAMADO' });
    expect(historial.body.datos[0].detalle.antes.inicio).toBe(`${dentroDe(10)} 09:30`);
  });

  it('cancelar exige motivo, corta los recordatorios y avisa', async () => {
    const creado = await crearEvento(admin, { participantes: [jefe.usuario.id] });

    const sinMotivo = await conSesion(request(app).patch(`/api/agenda/eventos/${creado.id}/estado`), admin).send({
      estado: 'CANCELADO',
    });
    expect(sinMotivo.status).toBe(400);

    const cancelado = await conSesion(request(app).patch(`/api/agenda/eventos/${creado.id}/estado`), admin).send({
      estado: 'CANCELADO',
      motivo: 'El juzgado suspendió la audiencia',
    });
    expect(cancelado.status).toBe(200);
    expect(cancelado.body.evento).toMatchObject({ estado: 'CANCELADO', motivo_cancelacion: 'El juzgado suspendió la audiencia' });

    const lista = await envios(creado.id);
    expect(lista.filter((e) => e.tipo === 'RECORDATORIO_EVENTO').every((e) => e.estado === 'CANCELADO')).toBe(true);
    expect(lista.filter((e) => e.tipo === 'EVENTO_CANCELADO' && e.estado === 'PENDIENTE')).toHaveLength(2);

    // Por defecto la agenda no muestra cancelados; con el filtro, sí.
    const rango = `desde=${dentroDe(10)}&hasta=${dentroDe(10)}`;
    const sinCancelados = await conSesion(request(app).get(`/api/agenda?${rango}`), admin);
    expect(sinCancelados.body.datos.some((i: { id: string }) => i.id === creado.id)).toBe(false);
    const conCancelados = await conSesion(request(app).get(`/api/agenda?${rango}&cancelados=true`), admin);
    expect(conCancelados.body.datos.some((i: { id: string }) => i.id === creado.id)).toBe(true);

    // Cerrado no se edita: hay que reabrir.
    const edicion = await conSesion(request(app).put(`/api/agenda/eventos/${creado.id}`), admin).send(
      evento({ titulo: creado.titulo }),
    );
    expect(edicion.status).toBe(409);

    const reabierto = await conSesion(request(app).patch(`/api/agenda/eventos/${creado.id}/estado`), admin).send({
      estado: 'PENDIENTE',
    });
    expect(reabierto.status).toBe(200);
    const reprogramados = (await envios(creado.id)).filter(
      (e) => e.tipo === 'RECORDATORIO_EVENTO' && e.estado === 'PENDIENTE',
    );
    expect(reprogramados.length).toBe(8);
  });

  it('completar un evento cancela sus recordatorios pendientes', async () => {
    const creado = await crearEvento(admin);
    const completado = await conSesion(request(app).patch(`/api/agenda/eventos/${creado.id}/estado`), admin).send({
      estado: 'COMPLETADO',
    });
    expect(completado.status).toBe(200);
    expect(completado.body.evento.completado_en).toBeTruthy();
    expect((await envios(creado.id)).every((e) => e.estado === 'CANCELADO')).toBe(true);
  });

  it('advierte superposiciones sin impedir el alta', async () => {
    const primero = await crearEvento(admin, { fecha_inicio: dentroDe(30), hora_inicio: '15:00', hora_fin: '16:00' });
    const segundo = await conSesion(request(app).post('/api/agenda/eventos'), admin).send(
      evento({ fecha_inicio: dentroDe(30), hora_inicio: '15:30', hora_fin: '16:30' }),
    );
    expect(segundo.status).toBe(201);
    expect(segundo.body.conflictos.map((c: { id: string }) => c.id)).toContain(primero.id);

    const consulta = await conSesion(
      request(app).get(`/api/agenda/conflictos?fecha_inicio=${dentroDe(30)}&hora_inicio=15:45&hora_fin=16:15`),
      admin,
    );
    expect(consulta.status).toBe(200);
    expect(consulta.body.conflictos.length).toBeGreaterThanOrEqual(2);
  });
});

describe.skipIf(!hayBase)('visibilidad y alcance', () => {
  it('un evento personal no lo ve nadie más, ni la dirección', async () => {
    const personal = await crearEvento(empleado, { visibilidad: 'PERSONAL', tipo: 'REUNION' });
    for (const otro of [admin, jefe, empleado2]) {
      const detalle = await conSesion(request(app).get(`/api/agenda/eventos/${personal.id}`), otro);
      expect(detalle.status).toBe(404);
      const agenda = await conSesion(request(app).get(`/api/agenda?desde=${dentroDe(10)}&hasta=${dentroDe(10)}`), otro);
      expect(agenda.body.datos.some((i: { id: string }) => i.id === personal.id)).toBe(false);
      const estado = await conSesion(request(app).patch(`/api/agenda/eventos/${personal.id}/estado`), otro).send({
        estado: 'CANCELADO',
        motivo: 'intento ajeno',
      });
      expect(estado.status).toBe(404);
    }
    const propio = await conSesion(request(app).get(`/api/agenda/eventos/${personal.id}`), empleado);
    expect(propio.status).toBe(200);
  });

  it('un evento para participantes lo ven los convocados y no el resto', async () => {
    const compartido = await crearEvento(jefe, { visibilidad: 'PARTICIPANTES', participantes: [empleado.usuario.id] });
    expect((await conSesion(request(app).get(`/api/agenda/eventos/${compartido.id}`), empleado)).status).toBe(200);
    expect((await conSesion(request(app).get(`/api/agenda/eventos/${compartido.id}`), empleado2)).status).toBe(404);
    // Ver no es editar: el participante no lo modifica.
    const edicion = await conSesion(request(app).put(`/api/agenda/eventos/${compartido.id}`), empleado).send(
      evento({ titulo: compartido.titulo, visibilidad: 'PARTICIPANTES', participantes: [empleado.usuario.id] }),
    );
    expect(edicion.status).toBe(403);
  });

  it('un evento del estudio vinculado a una causa solo lo ve quien ve la causa', async () => {
    const causa = await crearExpediente(admin);
    const delEstudio = await crearEvento(admin, { causa_id: causa });
    expect((await conSesion(request(app).get(`/api/agenda/eventos/${delEstudio.id}`), jefe)).status).toBe(200);
    expect((await conSesion(request(app).get(`/api/agenda/eventos/${delEstudio.id}`), empleado)).status).toBe(404);

    await asignarAExpediente(app, admin, causa, empleado.usuario.id);
    expect((await conSesion(request(app).get(`/api/agenda/eventos/${delEstudio.id}`), empleado)).status).toBe(200);
  });

  it('no se vincula una causa ajena ni se convoca a quien no la ve', async () => {
    const causa = await crearExpediente(admin);

    const ajena = await conSesion(request(app).post('/api/agenda/eventos'), empleado).send(evento({ causa_id: causa }));
    expect(ajena.status).toBe(400);
    expect(ajena.body.detalles?.causa_id).toBeTruthy();

    const convocatoria = await conSesion(request(app).post('/api/agenda/eventos'), admin).send(
      evento({ causa_id: causa, participantes: [empleado2.usuario.id] }),
    );
    expect(convocatoria.status).toBe(400);
    expect(convocatoria.body.detalles?.participantes?.[0]).toMatch(/no tiene asignado/);

    // Cambiar la vinculación de un evento propio hacia una causa ajena tampoco.
    const propio = await crearEvento(empleado);
    const cambio = await conSesion(request(app).put(`/api/agenda/eventos/${propio.id}`), empleado).send(
      evento({ titulo: propio.titulo, causa_id: causa }),
    );
    expect(cambio.status).toBe(400);
  });

  it('el empleado no modifica eventos del estudio que no son suyos', async () => {
    const delJefe = await crearEvento(jefe);
    const intento = await conSesion(request(app).patch(`/api/agenda/eventos/${delJefe.id}/estado`), empleado).send({
      estado: 'COMPLETADO',
    });
    expect(intento.status).toBe(403);
    // El jefe sí puede sobre el de otro, porque tiene alcance general.
    const delEmpleado = await crearEvento(empleado);
    const confirmado = await conSesion(request(app).patch(`/api/agenda/eventos/${delEmpleado.id}/estado`), jefe).send({
      estado: 'CONFIRMADO',
    });
    expect(confirmado.status).toBe(200);
  });

  it('un identificador inválido responde 400 y uno ajeno 404', async () => {
    expect((await conSesion(request(app).get('/api/agenda/eventos/no-es-uuid'), admin)).status).toBe(400);
    expect(
      (await conSesion(request(app).get('/api/agenda/eventos/00000000-0000-4000-8000-000000000000'), admin)).status,
    ).toBe(404);
  });
});

describe.skipIf(!hayBase)('vista unificada', () => {
  it('integra plazos y tareas sin duplicarlos ni volverlos editables', async () => {
    const causa = await crearExpediente(admin);
    const plazo = await conSesion(request(app).post(`/api/causas/${causa}/plazos`), admin).send({
      descripcion: 'Contestar demanda',
      fecha_notificacion: dentroDe(1),
      cantidad_dias: 5,
      computo: 'HABIL',
      responsable_id: admin.usuario.id,
    });
    expect(plazo.status, JSON.stringify(plazo.body)).toBe(201);
    const vencimiento = plazo.body.plazo.fecha_vencimiento as string;

    const tarea = await conSesion(request(app).post('/api/tareas'), admin).send({
      titulo: `${PREFIJO_PRUEBA}Preparar escrito`,
      causa_id: causa,
      prioridad: 'ALTA',
      fecha_vencimiento: vencimiento,
    });
    expect(tarea.status).toBe(201);

    const agenda = await conSesion(request(app).get(`/api/agenda?desde=${vencimiento}&hasta=${vencimiento}&causa=${causa}`), admin);
    expect(agenda.status).toBe(200);
    const claves = agenda.body.datos.map((i: { clave: string }) => i.clave);
    expect(new Set(claves).size).toBe(claves.length);
    const delPlazo = agenda.body.datos.filter((i: { origen: string }) => i.origen === 'PLAZO');
    const deTarea = agenda.body.datos.filter((i: { origen: string }) => i.origen === 'TAREA');
    expect(delPlazo).toHaveLength(1);
    expect(deTarea).toHaveLength(1);
    expect(delPlazo[0]).toMatchObject({ editable: false, todo_el_dia: true, inicio: vencimiento });
    expect(deTarea[0]).toMatchObject({ editable: false, prioridad: 'ALTA' });

    // El plazo no se copia a evento_calendario.
    const copias = await obtenerPool().query('SELECT 1 FROM evento_calendario WHERE plazo_id = $1', [plazo.body.plazo.id]);
    expect(copias.rowCount).toBe(0);

    // Filtrar por tipo deja solo lo pedido.
    const soloTareas = await conSesion(
      request(app).get(`/api/agenda?desde=${vencimiento}&hasta=${vencimiento}&causa=${causa}&tipos=TAREA`),
      admin,
    );
    expect(soloTareas.body.datos.every((i: { tipo: string }) => i.tipo === 'TAREA')).toBe(true);
  });

  it('muestra los días inhábiles del estudio como contexto', async () => {
    const { rows } = await obtenerPool().query<{ fecha: string }>(
      `SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha FROM dia_inhabil
        WHERE jurisdiccion_id = (SELECT jurisdiccion_id FROM estudio LIMIT 1) ORDER BY fecha LIMIT 1`,
    );
    if (!rows[0]) return;
    const agenda = await conSesion(request(app).get(`/api/agenda?desde=${rows[0].fecha}&hasta=${rows[0].fecha}`), admin);
    const inhabil = agenda.body.datos.find((i: { origen: string }) => i.origen === 'DIA_INHABIL');
    expect(inhabil).toMatchObject({ tipo: 'INHABIL', editable: false, ruta: '/calendario' });
  });

  it('"mis eventos" deja solo aquellos en los que participo', async () => {
    const ajeno = await crearEvento(jefe, { fecha_inicio: dentroDe(40) });
    const propio = await crearEvento(admin, { fecha_inicio: dentroDe(40) });
    const agenda = await conSesion(
      request(app).get(`/api/agenda?desde=${dentroDe(40)}&hasta=${dentroDe(40)}&alcance=mios`),
      admin,
    );
    const ids = agenda.body.datos.map((i: { id: string }) => i.id);
    expect(ids).toContain(propio.id);
    expect(ids).not.toContain(ajeno.id);
  });

  it('limita el rango consultado', async () => {
    const respuesta = await conSesion(request(app).get(`/api/agenda?desde=${dentroDe(0)}&hasta=${dentroDe(150)}`), admin);
    expect(respuesta.status).toBe(400);
    const invertido = await conSesion(request(app).get(`/api/agenda?desde=${dentroDe(5)}&hasta=${dentroDe(0)}`), admin);
    expect(invertido.status).toBe(400);
  });

  it('el calendario judicial sigue intacto', async () => {
    const antes = await obtenerPool().query<{ total: number }>('SELECT count(*)::int AS total FROM dia_inhabil');
    await crearEvento(admin, { tipo: 'VENCIMIENTO', todo_el_dia: true, hora_inicio: '', hora_fin: '' });
    const despues = await obtenerPool().query<{ total: number }>('SELECT count(*)::int AS total FROM dia_inhabil');
    expect(despues.rows[0]!.total).toBe(antes.rows[0]!.total);
    const calendario = await conSesion(request(app).get(`/api/calendario/inhabiles?anio=2026`), admin);
    expect(calendario.status).toBe(200);
  });
});
