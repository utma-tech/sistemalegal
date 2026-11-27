import type { Pool, PoolClient } from 'pg';
import { config } from '../../config';
import { obtenerPool } from '../../db';
import { sqlCausaEnAlcance, sqlCausaOpcionalEnAlcance, sqlEventoVisible } from '../../comun/alcance';
import type { DatosEvento, EstadoEvento, TipoEvento } from './esquemas';
import type { IntervaloLocal } from './fechas';

/**
 * Acceso a datos de la agenda.
 *
 * Toda lectura de un evento pasa por sqlEventoVisible: no hay consulta de
 * eventos que no aplique visibilidad y alcance. Las horas salen ya convertidas
 * a hora de pared del estudio (`AT TIME ZONE` con ZONA_HORARIA), así el
 * navegador nunca reinterpreta un instante con su propia zona.
 */

type Consultable = Pool | PoolClient;

/** Quién consulta: su id y su alcance (null = ve todo el estudio). */
export interface Lector {
  usuarioId: string;
  alcance: string | null;
}

export interface FilaEvento {
  id: string;
  titulo: string;
  tipo: TipoEvento;
  descripcion: string | null;
  prioridad: 'ALTA' | 'MEDIA' | 'BAJA';
  estado: EstadoEvento;
  visibilidad: 'PERSONAL' | 'PARTICIPANTES' | 'ESTUDIO';
  todo_el_dia: boolean;
  fecha_inicio: string;
  hora_inicio: string;
  fecha_fin: string;
  hora_fin: string;
  instante_inicio: Date;
  lugar: string | null;
  enlace_virtual: string | null;
  observaciones: string | null;
  causa_id: string | null;
  caratula: string | null;
  numero_expediente: string | null;
  persona_id: string | null;
  persona: string | null;
  responsable_id: string | null;
  responsable: string | null;
  creado_por_id: string | null;
  creado_por: string | null;
  creado_en: string;
  actualizado_en: string;
  actualizado_por: string | null;
  cancelado_en: string | null;
  motivo_cancelacion: string | null;
  completado_en: string | null;
  version: number;
}

const COLUMNAS_EVENTO = `
  e.id, e.titulo, e.tipo, e.descripcion, e.prioridad, e.estado, e.visibilidad, e.todo_el_dia,
  to_char(e.fecha_inicio AT TIME ZONE $2, 'YYYY-MM-DD') AS fecha_inicio,
  to_char(e.fecha_inicio AT TIME ZONE $2, 'HH24:MI')    AS hora_inicio,
  to_char(e.fecha_fin    AT TIME ZONE $2, 'YYYY-MM-DD') AS fecha_fin,
  to_char(e.fecha_fin    AT TIME ZONE $2, 'HH24:MI')    AS hora_fin,
  e.fecha_inicio AS instante_inicio,
  e.lugar, e.enlace_virtual, e.observaciones,
  e.causa_id, c.caratula, c.numero_expediente,
  e.persona_id, COALESCE(pe.razon_social, pe.apellido || ', ' || pe.nombre) AS persona,
  e.responsable_id, (ur.nombre || ' ' || ur.apellido) AS responsable,
  e.creado_por AS creado_por_id, (uc.nombre || ' ' || uc.apellido) AS creado_por,
  e.creado_en, e.actualizado_en, (ua.nombre || ' ' || ua.apellido) AS actualizado_por,
  e.cancelado_en, e.motivo_cancelacion, e.completado_en, e.version`;

const DESDE_EVENTO = `
  FROM evento_calendario e
  LEFT JOIN causa   c  ON c.id  = e.causa_id
  LEFT JOIN persona pe ON pe.id = e.persona_id
  LEFT JOIN usuario ur ON ur.id = e.responsable_id
  LEFT JOIN usuario uc ON uc.id = e.creado_por
  LEFT JOIN usuario ua ON ua.id = e.actualizado_por`;

/** Un evento visible para el lector, o undefined (no existe o no lo puede ver: es lo mismo). */
export async function buscar(
  cliente: Consultable,
  id: string,
  lector: Lector,
  bloquear = false,
): Promise<FilaEvento | undefined> {
  const { rows } = await cliente.query<FilaEvento>(
    `SELECT ${COLUMNAS_EVENTO}
     ${DESDE_EVENTO}
      WHERE e.id = $1
        AND (e.causa_id IS NULL OR c.eliminado_en IS NULL)
        AND ${sqlEventoVisible('e', '$3', '$4')}
     ${bloquear ? 'FOR UPDATE OF e' : ''}`,
    [id, config.zonaHoraria, lector.usuarioId, lector.alcance],
  );
  return rows[0];
}

export async function participantesDe(
  cliente: Consultable,
  eventoIds: string[],
): Promise<Map<string, { id: string; nombre: string }[]>> {
  const mapa = new Map<string, { id: string; nombre: string }[]>();
  if (eventoIds.length === 0) return mapa;
  const { rows } = await cliente.query<{ evento_id: string; id: string; nombre: string }>(
    `SELECT ep.evento_id, u.id, (u.nombre || ' ' || u.apellido) AS nombre
       FROM evento_participante ep JOIN usuario u ON u.id = ep.usuario_id
      WHERE ep.evento_id = ANY($1::uuid[])
      ORDER BY u.apellido, u.nombre`,
    [eventoIds],
  );
  for (const fila of rows) {
    const lista = mapa.get(fila.evento_id) ?? [];
    lista.push({ id: fila.id, nombre: fila.nombre });
    mapa.set(fila.evento_id, lista);
  }
  return mapa;
}

export async function recordatoriosDe(cliente: Consultable, eventoId: string): Promise<number[]> {
  const { rows } = await cliente.query<{ minutos_antes: number }>(
    'SELECT minutos_antes FROM evento_recordatorio WHERE evento_id = $1 ORDER BY minutos_antes DESC',
    [eventoId],
  );
  return rows.map((fila) => fila.minutos_antes);
}

/** Anticipaciones por defecto del estudio para un tipo de evento. */
export async function reglasRecordatorio(cliente: Consultable, tipo: string): Promise<number[]> {
  const { rows } = await cliente.query<{ minutos_antes: number }>(
    `SELECT minutos_antes FROM regla_recordatorio
      WHERE tipo_evento = $1 AND activa ORDER BY minutos_antes DESC`,
    [tipo],
  );
  return rows.map((fila) => fila.minutos_antes);
}

export async function reglasPorTipo(): Promise<Record<string, number[]>> {
  const { rows } = await obtenerPool().query<{ tipo_evento: string; minutos: number[] }>(
    `SELECT tipo_evento, array_agg(minutos_antes ORDER BY minutos_antes DESC) AS minutos
       FROM regla_recordatorio WHERE activa GROUP BY tipo_evento`,
  );
  return Object.fromEntries(rows.map((fila) => [fila.tipo_evento, fila.minutos]));
}

interface FilaGuardada {
  id: string;
  version: number;
  fecha_inicio: Date;
  todo_el_dia: boolean;
}

export async function insertar(
  cliente: PoolClient,
  d: DatosEvento,
  intervalo: IntervaloLocal,
  creadoPor: string,
): Promise<FilaGuardada> {
  const { rows } = await cliente.query<FilaGuardada>(
    `INSERT INTO evento_calendario
       (titulo, tipo, descripcion, prioridad, todo_el_dia, fecha_inicio, fecha_fin, causa_id, persona_id,
        responsable_id, lugar, enlace_virtual, observaciones, visibilidad, creado_por, actualizado_por)
     VALUES ($1, $2, $3, $4, $5, ($6::timestamp AT TIME ZONE $16), ($7::timestamp AT TIME ZONE $16),
             $8, $9, $10, $11, $12, $13, $14, $15, $15)
     RETURNING id, version, fecha_inicio, todo_el_dia`,
    [
      d.titulo,
      d.tipo,
      d.descripcion ?? null,
      d.prioridad,
      d.todo_el_dia,
      intervalo.inicio,
      intervalo.fin,
      d.causa_id ?? null,
      d.persona_id ?? null,
      d.responsable_id ?? null,
      d.lugar ?? null,
      d.enlace_virtual ?? null,
      d.observaciones ?? null,
      d.visibilidad,
      creadoPor,
      config.zonaHoraria,
    ],
  );
  return rows[0]!;
}

export async function actualizar(
  cliente: PoolClient,
  id: string,
  d: DatosEvento,
  intervalo: IntervaloLocal,
  actualizadoPor: string,
  version: number,
): Promise<FilaGuardada> {
  const { rows } = await cliente.query<FilaGuardada>(
    `UPDATE evento_calendario
        SET titulo = $2, tipo = $3, descripcion = $4, prioridad = $5, todo_el_dia = $6,
            fecha_inicio = ($7::timestamp AT TIME ZONE $17), fecha_fin = ($8::timestamp AT TIME ZONE $17),
            causa_id = $9, persona_id = $10, responsable_id = $11, lugar = $12, enlace_virtual = $13,
            observaciones = $14, visibilidad = $15, actualizado_por = $16, version = $18
      WHERE id = $1
      RETURNING id, version, fecha_inicio, todo_el_dia`,
    [
      id,
      d.titulo,
      d.tipo,
      d.descripcion ?? null,
      d.prioridad,
      d.todo_el_dia,
      intervalo.inicio,
      intervalo.fin,
      d.causa_id ?? null,
      d.persona_id ?? null,
      d.responsable_id ?? null,
      d.lugar ?? null,
      d.enlace_virtual ?? null,
      d.observaciones ?? null,
      d.visibilidad,
      actualizadoPor,
      config.zonaHoraria,
      version,
    ],
  );
  return rows[0]!;
}

export async function cambiarEstado(
  cliente: PoolClient,
  id: string,
  estado: EstadoEvento,
  motivo: string | undefined,
  usuarioId: string,
  version: number,
): Promise<FilaGuardada> {
  const { rows } = await cliente.query<FilaGuardada>(
    `UPDATE evento_calendario
        SET estado = $2::text,
            cancelado_en = CASE WHEN $2::text = 'CANCELADO' THEN now() ELSE NULL END,
            motivo_cancelacion = CASE WHEN $2::text = 'CANCELADO' THEN $3::text ELSE NULL END,
            completado_en = CASE WHEN $2::text = 'COMPLETADO' THEN now() ELSE NULL END,
            actualizado_por = $4, version = $5
      WHERE id = $1
      RETURNING id, version, fecha_inicio, todo_el_dia`,
    [id, estado, motivo ?? null, usuarioId, version],
  );
  return rows[0]!;
}

export async function reemplazarParticipantes(cliente: PoolClient, eventoId: string, usuarios: string[]): Promise<void> {
  await cliente.query('DELETE FROM evento_participante WHERE evento_id = $1', [eventoId]);
  if (usuarios.length === 0) return;
  await cliente.query(
    `INSERT INTO evento_participante (evento_id, usuario_id)
     SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
    [eventoId, usuarios],
  );
}

export async function reemplazarRecordatorios(cliente: PoolClient, eventoId: string, minutos: number[]): Promise<void> {
  await cliente.query('DELETE FROM evento_recordatorio WHERE evento_id = $1', [eventoId]);
  if (minutos.length === 0) return;
  await cliente.query(
    `INSERT INTO evento_recordatorio (evento_id, minutos_antes)
     SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`,
    [eventoId, minutos],
  );
}

export type AccionHistorial =
  | 'CREADO'
  | 'EDITADO'
  | 'REPROGRAMADO'
  | 'CONFIRMADO'
  | 'COMPLETADO'
  | 'CANCELADO'
  | 'REABIERTO';

export async function registrarHistorial(
  cliente: PoolClient,
  eventoId: string,
  usuarioId: string,
  accion: AccionHistorial,
  detalle: Record<string, unknown> = {},
  motivo?: string,
): Promise<void> {
  await cliente.query(
    `INSERT INTO evento_historial (evento_id, usuario_id, accion, detalle, motivo)
     VALUES ($1, $2, $3, $4, $5)`,
    [eventoId, usuarioId, accion, JSON.stringify(detalle), motivo ?? null],
  );
}

export interface EntradaHistorial {
  id: string;
  accion: AccionHistorial;
  detalle: Record<string, unknown>;
  motivo: string | null;
  usuario: string | null;
  creado_en: string;
}

export async function historial(eventoId: string): Promise<EntradaHistorial[]> {
  const { rows } = await obtenerPool().query<EntradaHistorial>(
    `SELECT h.id, h.accion, h.detalle, h.motivo, (u.nombre || ' ' || u.apellido) AS usuario, h.creado_en
       FROM evento_historial h LEFT JOIN usuario u ON u.id = h.usuario_id
      WHERE h.evento_id = $1
      ORDER BY h.creado_en DESC
      LIMIT 100`,
    [eventoId],
  );
  return rows;
}

/* --- Validaciones de vínculos -------------------------------------------------- */

export interface UsuarioVinculable {
  id: string;
  activo: boolean;
  rol: string;
  asignado: boolean;
  nombre: string;
}

/** Usuarios a vincular y si están asignados a la causa (si la hay). */
export async function usuariosVinculables(ids: string[], causaId: string | undefined): Promise<UsuarioVinculable[]> {
  if (ids.length === 0) return [];
  const { rows } = await obtenerPool().query<UsuarioVinculable>(
    `SELECT u.id, u.activo, r.codigo AS rol, (u.nombre || ' ' || u.apellido) AS nombre,
            ($2::uuid IS NOT NULL AND EXISTS (
              SELECT 1 FROM profesional_causa pc
               WHERE pc.causa_id = $2::uuid AND pc.usuario_id = u.id AND pc.fecha_baja IS NULL)) AS asignado
       FROM usuario u JOIN rol r ON r.id = u.rol_id
      WHERE u.id = ANY($1::uuid[])`,
    [ids, causaId ?? null],
  );
  return rows;
}

export async function personaVinculable(
  personaId: string,
  causaId: string | undefined,
): Promise<{ existe: boolean; esParte: boolean }> {
  const { rows } = await obtenerPool().query<{ existe: boolean; es_parte: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM persona WHERE id = $1 AND eliminado_en IS NULL) AS existe,
            ($2::uuid IS NULL OR EXISTS (
              SELECT 1 FROM parte_causa WHERE persona_id = $1 AND causa_id = $2::uuid)) AS es_parte`,
    [personaId, causaId ?? null],
  );
  return { existe: rows[0]?.existe ?? false, esParte: rows[0]?.es_parte ?? false };
}

/* --- Agenda unificada ----------------------------------------------------------- */

export interface ParametrosRango {
  desde: string;
  hasta: string;
  lector: Lector;
  responsable?: string;
  causa?: string;
  prioridad?: string;
  soloMios: boolean;
}

export interface FilaEventoAgenda {
  id: string;
  titulo: string;
  tipo: TipoEvento;
  estado: EstadoEvento;
  prioridad: string;
  todo_el_dia: boolean;
  lugar: string | null;
  inicio: string;
  fin: string;
  fecha_inicio: string;
  fecha_fin: string;
  responsable_id: string | null;
  responsable: string | null;
  causa_id: string | null;
  caratula: string | null;
  numero_expediente: string | null;
  creado_por: string | null;
}

const TOPE_AGENDA = 1000;

export async function eventosEnRango(
  p: ParametrosRango,
  tipos: string[],
  estados: string[],
): Promise<FilaEventoAgenda[]> {
  if (tipos.length === 0 || estados.length === 0) return [];
  const { rows } = await obtenerPool().query<FilaEventoAgenda>(
    `SELECT e.id, e.titulo, e.tipo, e.estado, e.prioridad, e.todo_el_dia, e.lugar,
            to_char(e.fecha_inicio AT TIME ZONE $3, 'YYYY-MM-DD"T"HH24:MI') AS inicio,
            to_char(e.fecha_fin    AT TIME ZONE $3, 'YYYY-MM-DD"T"HH24:MI') AS fin,
            to_char(e.fecha_inicio AT TIME ZONE $3, 'YYYY-MM-DD') AS fecha_inicio,
            to_char(e.fecha_fin    AT TIME ZONE $3, 'YYYY-MM-DD') AS fecha_fin,
            e.responsable_id, (ur.nombre || ' ' || ur.apellido) AS responsable,
            e.causa_id, c.caratula, c.numero_expediente, e.creado_por
       FROM evento_calendario e
       LEFT JOIN causa   c  ON c.id  = e.causa_id
       LEFT JOIN usuario ur ON ur.id = e.responsable_id
      WHERE e.fecha_inicio < (($2::date + 1)::timestamp AT TIME ZONE $3)
        AND e.fecha_fin   >= ($1::date::timestamp AT TIME ZONE $3)
        AND (e.causa_id IS NULL OR c.eliminado_en IS NULL)
        AND ${sqlEventoVisible('e', '$4', '$5')}
        AND e.tipo = ANY($6::text[])
        AND e.estado = ANY($7::text[])
        AND ($8::uuid IS NULL OR e.responsable_id = $8::uuid OR EXISTS (
              SELECT 1 FROM evento_participante epr WHERE epr.evento_id = e.id AND epr.usuario_id = $8::uuid))
        AND ($9::uuid IS NULL OR e.causa_id = $9::uuid)
        AND ($10::text IS NULL OR e.prioridad = $10::text)
        AND (NOT $11::boolean OR e.responsable_id = $4::uuid OR e.creado_por = $4::uuid OR EXISTS (
              SELECT 1 FROM evento_participante epm WHERE epm.evento_id = e.id AND epm.usuario_id = $4::uuid))
      ORDER BY e.fecha_inicio, e.titulo
      LIMIT ${TOPE_AGENDA}`,
    [
      p.desde,
      p.hasta,
      config.zonaHoraria,
      p.lector.usuarioId,
      p.lector.alcance,
      tipos,
      estados,
      p.responsable ?? null,
      p.causa ?? null,
      p.prioridad ?? null,
      p.soloMios,
    ],
  );
  return rows;
}

export interface FilaFechaAgenda {
  id: string;
  titulo: string;
  estado: string;
  prioridad: string | null;
  fecha: string;
  responsable_id: string | null;
  responsable: string | null;
  causa_id: string | null;
  caratula: string | null;
  numero_expediente: string | null;
}

/** Plazos procesales del rango, con el mismo alcance que el módulo de plazos. */
export async function plazosEnRango(p: ParametrosRango, estados: string[]): Promise<FilaFechaAgenda[]> {
  if (estados.length === 0) return [];
  const { rows } = await obtenerPool().query<FilaFechaAgenda>(
    `SELECT p.id, p.descripcion AS titulo, p.estado, NULL::text AS prioridad,
            to_char(p.fecha_vencimiento, 'YYYY-MM-DD') AS fecha,
            p.responsable_id, (u.nombre || ' ' || u.apellido) AS responsable,
            p.causa_id, c.caratula, c.numero_expediente
       FROM plazo p
       JOIN causa c ON c.id = p.causa_id AND c.eliminado_en IS NULL
       LEFT JOIN usuario u ON u.id = p.responsable_id
      WHERE p.fecha_vencimiento BETWEEN $1::date AND $2::date
        AND p.estado = ANY($3::text[])
        AND (p.responsable_id = $4::uuid OR ${sqlCausaEnAlcance('p.causa_id', '$4')})
        AND ($5::uuid IS NULL OR p.responsable_id = $5::uuid)
        AND ($6::uuid IS NULL OR p.causa_id = $6::uuid)
        AND (NOT $7::boolean OR p.responsable_id = $8::uuid)
      ORDER BY p.fecha_vencimiento, p.descripcion
      LIMIT ${TOPE_AGENDA}`,
    [p.desde, p.hasta, estados, p.lector.alcance, p.responsable ?? null, p.causa ?? null, p.soloMios, p.lector.usuarioId],
  );
  return rows;
}

/** Tareas con fecha del rango, con el mismo alcance que el módulo de tareas. */
export async function tareasEnRango(p: ParametrosRango, estados: string[]): Promise<FilaFechaAgenda[]> {
  if (estados.length === 0) return [];
  const { rows } = await obtenerPool().query<FilaFechaAgenda>(
    `SELECT t.id, t.titulo, t.estado, t.prioridad,
            to_char(t.fecha_vencimiento, 'YYYY-MM-DD') AS fecha,
            t.asignada_a AS responsable_id, (u.nombre || ' ' || u.apellido) AS responsable,
            t.causa_id, c.caratula, c.numero_expediente
       FROM tarea t
       LEFT JOIN causa c ON c.id = t.causa_id
       LEFT JOIN usuario u ON u.id = t.asignada_a
      WHERE t.fecha_vencimiento BETWEEN $1::date AND $2::date
        AND (t.causa_id IS NULL OR c.eliminado_en IS NULL)
        AND t.estado = ANY($3::text[])
        AND (t.asignada_a = $4::uuid OR ${sqlCausaOpcionalEnAlcance('t.causa_id', '$4')})
        AND ($5::uuid IS NULL OR t.asignada_a = $5::uuid)
        AND ($6::uuid IS NULL OR t.causa_id = $6::uuid)
        AND ($7::text IS NULL OR t.prioridad = $7::text)
        AND (NOT $8::boolean OR t.asignada_a = $9::uuid)
      ORDER BY t.fecha_vencimiento, t.titulo
      LIMIT ${TOPE_AGENDA}`,
    [
      p.desde,
      p.hasta,
      estados,
      p.lector.alcance,
      p.responsable ?? null,
      p.causa ?? null,
      p.prioridad ?? null,
      p.soloMios,
      p.lector.usuarioId,
    ],
  );
  return rows;
}

/** Días inhábiles de la jurisdicción del estudio: contexto, no compromisos. */
export async function inhabilesEnRango(
  desde: string,
  hasta: string,
): Promise<{ id: string; fecha: string; tipo: string; motivo: string }[]> {
  const { rows } = await obtenerPool().query<{ id: string; fecha: string; tipo: string; motivo: string }>(
    `SELECT d.id, to_char(d.fecha, 'YYYY-MM-DD') AS fecha, d.tipo, d.motivo
       FROM dia_inhabil d
      WHERE d.fecha BETWEEN $1::date AND $2::date
        AND d.jurisdiccion_id = (SELECT jurisdiccion_id FROM estudio LIMIT 1)
      ORDER BY d.fecha`,
    [desde, hasta],
  );
  return rows;
}

export interface Conflicto {
  id: string;
  titulo: string;
  inicio: string;
  fin: string;
  visible: boolean;
}

/** Eventos con hora que se superponen para alguno de los usuarios indicados. */
export async function conflictos(
  intervalo: IntervaloLocal,
  usuarios: string[],
  excluir: string | undefined,
  lector: Lector,
): Promise<Conflicto[]> {
  if (usuarios.length === 0) return [];
  const { rows } = await obtenerPool().query<Conflicto>(
    `SELECT e.id, e.titulo,
            to_char(e.fecha_inicio AT TIME ZONE $3, 'YYYY-MM-DD"T"HH24:MI') AS inicio,
            to_char(e.fecha_fin    AT TIME ZONE $3, 'YYYY-MM-DD"T"HH24:MI') AS fin,
            ${sqlEventoVisible('e', '$6', '$7')} AS visible
       FROM evento_calendario e
      WHERE e.estado IN ('PENDIENTE', 'CONFIRMADO')
        AND NOT e.todo_el_dia
        AND e.fecha_inicio < ($2::timestamp AT TIME ZONE $3)
        AND e.fecha_fin    > ($1::timestamp AT TIME ZONE $3)
        AND ($5::uuid IS NULL OR e.id <> $5::uuid)
        AND (COALESCE(e.responsable_id, e.creado_por) = ANY($4::uuid[]) OR EXISTS (
              SELECT 1 FROM evento_participante ep
               WHERE ep.evento_id = e.id AND ep.usuario_id = ANY($4::uuid[])))
      ORDER BY e.fecha_inicio
      LIMIT 20`,
    [intervalo.inicio, intervalo.fin, config.zonaHoraria, usuarios, excluir ?? null, lector.usuarioId, lector.alcance],
  );
  return rows;
}
