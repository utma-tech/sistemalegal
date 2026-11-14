import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { crearApp } from '../src/app';
import { cerrarPool, obtenerPool } from '../src/db';
import { config } from '../src/config';
import {
  conSesion,
  iniciarSesion,
  limpiarDatosDePrueba,
  PREFIJO_PRUEBA,
  USUARIOS_DEMO,
  type SesionDePrueba,
} from './ayudas';

/**
 * Tareas, calendario de inhábiles, costas y cobros, alertas, usuarios,
 * documentos y auditoría, sobre la base real.
 */

const app = crearApp();
const hayBase = Boolean(config.urlBaseDatos);
/** Año que ningún dato real usa: las pruebas del calendario escriben ahí y lo borran. */
const ANIO_PRUEBA = 2099;

let admin: SesionDePrueba;
let empleado: SesionDePrueba;
let causaId: string;

beforeAll(async () => {
  if (!hayBase) return;
  admin = await iniciarSesion(app, USUARIOS_DEMO.admin);
  empleado = await iniciarSesion(app, USUARIOS_DEMO.empleado);

  const catalogos = await conSesion(request(app).get('/api/catalogos'), admin);
  const creada = await conSesion(request(app).post('/api/causas'), admin).send({
    caratula: `${PREFIJO_PRUEBA}OPERACION ${Date.now()}`,
    fuero_id: catalogos.body.fueros[0].id,
    estado_causa_id: catalogos.body.estados[0].id,
    fecha_inicio: '2026-02-01',
  });
  expect(creada.status).toBe(201);
  causaId = creada.body.causa.id;
});

afterAll(async () => {
  if (hayBase) {
    const pool = obtenerPool();
    await pool.query(`DELETE FROM tarea WHERE titulo LIKE $1`, [`${PREFIJO_PRUEBA}%`]);
    await pool.query(`DELETE FROM dia_inhabil WHERE EXTRACT(YEAR FROM fecha) IN ($1, $2)`, [ANIO_PRUEBA, ANIO_PRUEBA - 1]);
    await limpiarDatosDePrueba();
  }
  await cerrarPool();
});

describe.skipIf(!hayBase)('tareas', () => {
  it('crea, completa, reabre y elimina, releyendo de la base', async () => {
    const creada = await conSesion(request(app).post('/api/tareas'), admin).send({
      titulo: `${PREFIJO_PRUEBA}Preparar alegato`,
      causa_id: causaId,
      asignada_a: empleado.usuario.id,
      prioridad: 'ALTA',
      fecha_vencimiento: '2026-12-01',
    });
    expect(creada.status).toBe(201);
    const id = creada.body.tarea.id as string;

    const completada = await conSesion(request(app).post(`/api/tareas/${id}/estado`), empleado).send({
      estado: 'COMPLETADA',
    });
    expect(completada.status).toBe(200);

    const { rows } = await obtenerPool().query('SELECT estado, completada_en FROM tarea WHERE id = $1', [id]);
    expect(rows[0].estado).toBe('COMPLETADA');
    expect(rows[0].completada_en).not.toBeNull();

    const reabierta = await conSesion(request(app).post(`/api/tareas/${id}/estado`), admin).send({ estado: 'PENDIENTE' });
    expect(reabierta.body.tarea.completada_en).toBeNull();

    // El empleado no elimina.
    expect((await conSesion(request(app).delete(`/api/tareas/${id}`), empleado)).status).toBe(403);
    expect((await conSesion(request(app).delete(`/api/tareas/${id}`), admin)).status).toBe(200);
  });

  it('rechaza asignar a alguien que no existe, con el error en el campo', async () => {
    const respuesta = await conSesion(request(app).post('/api/tareas'), admin).send({
      titulo: `${PREFIJO_PRUEBA}Huérfana`,
      asignada_a: '00000000-0000-4000-8000-000000000000',
    });
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.detalles.asignada_a).toBeDefined();
  });

  it('filtra las abiertas de una persona', async () => {
    await conSesion(request(app).post('/api/tareas'), admin).send({
      titulo: `${PREFIJO_PRUEBA}Llamar al cliente`,
      asignada_a: empleado.usuario.id,
    });
    const lista = await conSesion(
      request(app).get(`/api/tareas?asignada=${empleado.usuario.id}&vigencia=abiertas`),
      admin,
    );
    expect(lista.status).toBe(200);
    expect(lista.body.datos.every((t: { asignada_a_id: string }) => t.asignada_a_id === empleado.usuario.id)).toBe(true);
  });
});

describe.skipIf(!hayBase)('calendario de días inhábiles', () => {
  it('carga un rango de una vez y no duplica lo que ya existe', async () => {
    const alta = await conSesion(request(app).post('/api/calendario/inhabiles'), admin).send({
      fecha_desde: `${ANIO_PRUEBA}-01-02`,
      fecha_hasta: `${ANIO_PRUEBA}-01-10`,
      tipo: 'FERIA_JUDICIAL',
      motivo: 'Feria de prueba',
    });
    expect(alta.status).toBe(201);
    expect(alta.body.creados).toHaveLength(9);

    const repetida = await conSesion(request(app).post('/api/calendario/inhabiles'), admin).send({
      fecha_desde: `${ANIO_PRUEBA}-01-05`,
      tipo: 'ASUETO',
      motivo: 'Repetido',
    });
    expect(repetida.body.creados).toHaveLength(0);
    expect(repetida.body.omitidos).toBe(1);

    const lista = await conSesion(request(app).get(`/api/calendario/inhabiles?anio=${ANIO_PRUEBA}`), admin);
    expect(lista.body.datos).toHaveLength(9);
  });

  it('copia los feriados de fecha fija a otro año', async () => {
    await conSesion(request(app).post('/api/calendario/inhabiles'), admin).send({
      fecha_desde: `${ANIO_PRUEBA - 1}-05-25`,
      tipo: 'FERIADO_NACIONAL',
      motivo: 'Revolución de Mayo',
    });
    const copia = await conSesion(request(app).post('/api/calendario/inhabiles/copiar'), admin).send({
      anio_origen: ANIO_PRUEBA - 1,
      anio_destino: ANIO_PRUEBA,
      tipos: ['FERIADO_NACIONAL'],
    });
    expect(copia.status).toBe(201);
    expect(copia.body.creados.map((d: { fecha: string }) => d.fecha)).toContain(`${ANIO_PRUEBA}-05-25`);
  });

  it('el empleado ve el calendario pero no lo borra', async () => {
    const lista = await conSesion(request(app).get(`/api/calendario/inhabiles?anio=${ANIO_PRUEBA}`), empleado);
    expect(lista.status).toBe(200);
    const borrar = await conSesion(request(app).delete(`/api/calendario/inhabiles/${lista.body.datos[0].id}`), empleado);
    expect(borrar.status).toBe(403);
  });
});

describe.skipIf(!hayBase)('costas y cobros', () => {
  it('registra cobros parciales, mantiene el estado y rechaza cobrar de más', async () => {
    const catalogos = await conSesion(request(app).get('/api/catalogos'), admin);
    const alta = await conSesion(request(app).post(`/api/causas/${causaId}/costas`), admin).send({
      concepto_costa_id: catalogos.body.conceptosCosta[0].id,
      monto: '1.000,50',
      fecha_devengamiento: '2026-10-01',
      a_cargo_de: 'CLIENTE',
    });
    expect(alta.status).toBe(201);
    expect(alta.body.costa.monto).toBe('1000.50');
    const id = alta.body.costa.costa_id as string;

    const parcial = await conSesion(request(app).post(`/api/costas/${id}/cobros`), admin).send({
      monto: '400',
      fecha: '2026-10-05',
      medio_pago: 'TRANSFERENCIA',
    });
    expect(parcial.status).toBe(201);
    expect(parcial.body.costa.estado_cobro).toBe('PARCIAL');
    expect(parcial.body.costa.saldo_pendiente).toBe('600.50');

    const deMas = await conSesion(request(app).post(`/api/costas/${id}/cobros`), admin).send({
      monto: '700',
      fecha: '2026-10-06',
      medio_pago: 'EFECTIVO',
    });
    expect(deMas.status).toBe(400);

    const resto = await conSesion(request(app).post(`/api/costas/${id}/cobros`), admin).send({
      monto: '600.50',
      fecha: '2026-10-06',
      medio_pago: 'EFECTIVO',
    });
    expect(resto.body.costa.estado_cobro).toBe('COBRADO');

    const { rows } = await obtenerPool().query('SELECT estado_cobro FROM costa WHERE id = $1', [id]);
    expect(rows[0].estado_cobro).toBe('COBRADO');
  });

  it('exporta un CSV que Excel abre, sin fórmulas inyectables', async () => {
    const csv = await conSesion(request(app).get(`/api/costas/exportar?causa=${causaId}`), admin);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.startsWith('﻿"Expediente"')).toBe(true);
  });
});

describe.skipIf(!hayBase)('alertas y notificaciones', () => {
  it('un plazo que vence mañana genera alerta crítica y una sola notificación', async () => {
    const hoy = new Date();
    const manana = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1)).toISOString().slice(0, 10);
    const plazo = await conSesion(request(app).post(`/api/causas/${causaId}/plazos`), admin).send({
      descripcion: 'Expresar agravios',
      fecha_notificacion: manana,
      fecha_inicio_computo: manana,
      cantidad_dias: 1,
      computo: 'CORRIDO',
      responsable_id: admin.usuario.id,
    });
    expect(plazo.status).toBe(201);

    const alertas = await conSesion(request(app).get('/api/alertas?alcance=mias'), admin);
    expect(alertas.status).toBe(200);
    const propia = alertas.body.datos.find((a: { plazo_id: string }) => a.plazo_id === plazo.body.plazo.id);
    expect(propia?.nivel).toBe('CRITICA');

    await conSesion(request(app).post('/api/alertas/evaluar'), admin);
    await conSesion(request(app).post('/api/alertas/evaluar'), admin);

    const { rows } = await obtenerPool().query(
      `SELECT count(*)::int AS total FROM notificacion n JOIN alerta a ON a.id = n.alerta_id WHERE a.plazo_id = $1`,
      [plazo.body.plazo.id],
    );
    expect(rows[0].total).toBe(1);

    const bandeja = await conSesion(request(app).get('/api/notificaciones'), admin);
    expect(bandeja.body.no_leidas).toBeGreaterThan(0);
  });
});

describe.skipIf(!hayBase)('usuarios', () => {
  it('el admin da de alta a alguien que después puede entrar y cambiar su contraseña', async () => {
    const email = `prueba-${Date.now()}@estudiodemo.test`;
    const alta = await conSesion(request(app).post('/api/usuarios'), admin).send({
      email,
      nombre: 'Nueva',
      apellido: `${PREFIJO_PRUEBA}Integrante`,
      rol: 'EMPLEADO',
      password: 'Inicial123',
    });
    expect(alta.status).toBe(201);

    const sesion = await iniciarSesion(app, { email, password: 'Inicial123' });
    const cambio = await conSesion(request(app).post('/api/cuenta/password'), sesion).send({
      actual: 'Inicial123',
      nueva: 'Cambiada456',
    });
    expect(cambio.status).toBe(200);
    await iniciarSesion(app, { email, password: 'Cambiada456' });
  });

  it('el empleado no administra usuarios', async () => {
    expect((await conSesion(request(app).get('/api/usuarios'), empleado)).status).toBe(403);
  });

  it('nadie puede quitarse a sí mismo el rol de administrador', async () => {
    const respuesta = await conSesion(request(app).put(`/api/usuarios/${admin.usuario.id}`), admin).send({
      nombre: 'Admin',
      apellido: 'Demo',
      rol: 'EMPLEADO',
      activo: true,
    });
    expect(respuesta.status).toBe(409);
  });
});

describe.skipIf(!hayBase)('documentos', () => {
  it('guarda un PDF, rechaza el mismo archivo dos veces y lo devuelve intacto', async () => {
    const pdf = Buffer.from(`%PDF-1.4\n% prueba ${Date.now()} ${Math.random()}\n%%EOF\n`);
    const subida = await conSesion(
      request(app).post(`/api/causas/${causaId}/documentos?nombre=${encodeURIComponent('cédula.pdf')}`),
      admin,
    )
      .set('Content-Type', 'application/octet-stream')
      .send(pdf);
    expect(subida.status).toBe(201);
    expect(subida.body.documento.mime_type).toBe('application/pdf');

    const repetida = await conSesion(request(app).post(`/api/causas/${causaId}/documentos?nombre=otra.pdf`), admin)
      .set('Content-Type', 'application/pdf')
      .send(pdf);
    expect(repetida.status).toBe(409);

    const bajada = await conSesion(request(app).get(`/api/documentos/${subida.body.documento.id}/archivo`), admin)
      .buffer(true)
      .parse((res, callback) => {
        const partes: Buffer[] = [];
        res.on('data', (parte: Buffer) => partes.push(parte));
        res.on('end', () => callback(null, Buffer.concat(partes)));
      });
    expect(bajada.status).toBe(200);
    expect(Buffer.compare(bajada.body as Buffer, pdf)).toBe(0);
    expect(bajada.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rechaza un archivo que no es lo que dice ser', async () => {
    const respuesta = await conSesion(request(app).post(`/api/causas/${causaId}/documentos?nombre=demanda.pdf`), admin)
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]));
    expect(respuesta.status).toBe(400);
  });
});

describe.skipIf(!hayBase)('auditoría', () => {
  it('el admin la consulta y el empleado no', async () => {
    const lista = await conSesion(request(app).get('/api/auditoria?entidad=tarea'), admin);
    expect(lista.status).toBe(200);
    expect(lista.body.datos.length).toBeGreaterThan(0);
    expect((await conSesion(request(app).get('/api/auditoria'), empleado)).status).toBe(403);
  });
});
