import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { crearApp } from '../src/app';
import { cerrarPool } from '../src/db';
import { config } from '../src/config';
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
 * Alcance por expediente (src/comun/alcance.ts).
 *
 * El Empleado opera solo sobre las causas en las que está asignado; el
 * Administrador y el Jefe de Estudio ven todo. Lo que está fuera del alcance
 * responde como si no existiera (404), para no confirmar identificadores.
 */

const app = crearApp();
const hayBase = Boolean(config.urlBaseDatos);

afterAll(async () => {
  await limpiarDatosDePrueba();
  await cerrarPool();
});

async function crearExpediente(sesion: SesionDePrueba): Promise<string> {
  const catalogos = await conSesion(request(app).get('/api/catalogos'), sesion);
  const creada = await conSesion(request(app).post('/api/causas'), sesion).send({
    caratula: `${PREFIJO_PRUEBA}ALCANCE ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fuero_id: catalogos.body.fueros[0].id,
    estado_causa_id: catalogos.body.estados[0].id,
    fecha_inicio: '2026-02-01',
  });
  expect(creada.status).toBe(201);
  return creada.body.causa.id as string;
}

async function crearPlazo(sesion: SesionDePrueba, causaId: string) {
  return conSesion(request(app).post(`/api/causas/${causaId}/plazos`), sesion).send({
    descripcion: 'Contestar demanda',
    fecha_notificacion: '2026-03-10',
    cantidad_dias: 5,
    computo: 'HABIL',
  });
}

/** Busca la causa en el listado filtrando por su carátula exacta. */
async function apareceEnListado(sesion: SesionDePrueba, causaId: string): Promise<boolean> {
  const listado = await conSesion(request(app).get('/api/causas?tamano=100&vigencia=todas'), sesion);
  expect(listado.status).toBe(200);
  return listado.body.datos.some((c: { id: string }) => c.id === causaId);
}

describe.skipIf(!hayBase)('alcance del Empleado', () => {
  it('no ve ni edita un expediente en el que no está asignado', async () => {
    const admin = await iniciarSesion(app);
    const causaId = await crearExpediente(admin);
    const empleado = await iniciarSesion(app, USUARIOS_DEMO.empleado);

    expect(await apareceEnListado(empleado, causaId)).toBe(false);
    expect((await conSesion(request(app).get(`/api/causas/${causaId}`), empleado)).status).toBe(404);
    expect((await conSesion(request(app).get(`/api/causas/${causaId}/movimientos`), empleado)).status).toBe(404);
    expect((await crearPlazo(empleado, causaId)).status).toBe(404);
    expect(
      (await conSesion(request(app).post(`/api/causas/${causaId}/documentos?nombre=a.txt`), empleado)
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from('hola'))).status,
    ).toBe(404);
  });

  it('lo ve en cuanto lo asignan, y deja de verlo cuando lo quitan', async () => {
    const admin = await iniciarSesion(app);
    const causaId = await crearExpediente(admin);
    const empleado = await iniciarSesion(app, USUARIOS_DEMO.empleado);

    await asignarAExpediente(app, admin, causaId, empleado.usuario.id);
    expect(await apareceEnListado(empleado, causaId)).toBe(true);
    expect((await conSesion(request(app).get(`/api/causas/${causaId}`), empleado)).status).toBe(200);

    const detalle = await conSesion(request(app).get(`/api/causas/${causaId}`), admin);
    const vinculo = detalle.body.profesionales.find(
      (p: { usuario_id: string }) => p.usuario_id === empleado.usuario.id,
    );
    const quitado = await conSesion(
      request(app).delete(`/api/causas/${causaId}/profesionales/${vinculo.id}`),
      admin,
    );
    expect(quitado.status).toBe(200);
    expect((await conSesion(request(app).get(`/api/causas/${causaId}`), empleado)).status).toBe(404);
  });

  it('no accede por id a un plazo de un expediente ajeno, ni lo ve en la agenda', async () => {
    const admin = await iniciarSesion(app);
    const causaId = await crearExpediente(admin);
    const plazo = await crearPlazo(admin, causaId);
    expect(plazo.status).toBe(201);
    const plazoId = plazo.body.plazo.id as string;

    const empleado = await iniciarSesion(app, USUARIOS_DEMO.empleado);
    expect((await conSesion(request(app).get(`/api/plazos/${plazoId}`), empleado)).status).toBe(404);

    const agenda = await conSesion(request(app).get(`/api/plazos?causa=${causaId}&vigencia=todos`), empleado);
    expect(agenda.status).toBe(200);
    expect(agenda.body.datos).toHaveLength(0);
  });

  it('no puede colgar una tarea de un expediente ajeno', async () => {
    const admin = await iniciarSesion(app);
    const causaId = await crearExpediente(admin);
    const empleado = await iniciarSesion(app, USUARIOS_DEMO.empleado);

    const tarea = await conSesion(request(app).post('/api/tareas'), empleado).send({
      titulo: `${PREFIJO_PRUEBA}tarea ajena`,
      causa_id: causaId,
    });
    expect(tarea.status).toBe(400);
    expect(tarea.body.detalles?.causa_id).toBeDefined();
  });

  it('el panel cuenta solo sus expedientes', async () => {
    const admin = await iniciarSesion(app);
    await crearExpediente(admin);
    const empleado = await iniciarSesion(app, USUARIOS_DEMO.empleado);

    const [delAdmin, delEmpleado] = await Promise.all([
      conSesion(request(app).get('/api/panel'), admin),
      conSesion(request(app).get('/api/panel'), empleado),
    ]);
    expect(delEmpleado.status).toBe(200);
    expect(delEmpleado.body.indicadores.causas_activas).toBeLessThan(delAdmin.body.indicadores.causas_activas);
  });

  it('el Jefe de Estudio ve todo el estudio', async () => {
    const admin = await iniciarSesion(app);
    const causaId = await crearExpediente(admin);
    const jefe = await iniciarSesion(app, USUARIOS_DEMO.jefe);

    expect(await apareceEnListado(jefe, causaId)).toBe(true);
    expect((await conSesion(request(app).get(`/api/causas/${causaId}`), jefe)).status).toBe(200);
  });
});
