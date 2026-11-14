import { obtenerPool } from '../../db';
import { desplazamiento } from '../../comun/paginacion';
import type { DatosTarea, FiltrosTarea } from './esquemas';

/**
 * Acceso a datos de tareas.
 *
 * Las fechas salen como texto `YYYY-MM-DD`: el frontend no construye un `Date`
 * a partir de una fecha local (correría el día según la zona horaria).
 */

export interface Tarea {
  id: string;
  titulo: string;
  descripcion: string | null;
  estado: string;
  prioridad: string;
  fecha_vencimiento: string | null;
  /** Días que faltan para el vencimiento; negativo si ya pasó. Solo en abiertas. */
  dias_restantes: number | null;
  causa_id: string | null;
  caratula: string | null;
  numero_expediente: string | null;
  plazo_id: string | null;
  plazo: string | null;
  asignada_a_id: string | null;
  /** Nombre de quien la tiene asignada. Se llama así por compatibilidad con la pestaña del expediente. */
  asignada_a: string | null;
  creada_por: string | null;
  completada_en: string | null;
  creado_en: string;
}

const COLUMNAS = `
  t.id,
  t.titulo,
  t.descripcion,
  t.estado,
  t.prioridad,
  to_char(t.fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
  CASE WHEN t.estado IN ('PENDIENTE', 'EN_CURSO') AND t.fecha_vencimiento IS NOT NULL
       THEN (t.fecha_vencimiento - CURRENT_DATE)
  END AS dias_restantes,
  t.causa_id,
  c.caratula,
  c.numero_expediente,
  t.plazo_id,
  p.descripcion AS plazo,
  t.asignada_a AS asignada_a_id,
  (ua.nombre || ' ' || ua.apellido) AS asignada_a,
  (uc.nombre || ' ' || uc.apellido) AS creada_por,
  t.completada_en,
  t.creado_en`;

const ORIGEN = `
  FROM tarea t
  LEFT JOIN causa   c  ON c.id  = t.causa_id
  LEFT JOIN plazo   p  ON p.id  = t.plazo_id
  LEFT JOIN usuario ua ON ua.id = t.asignada_a
  LEFT JOIN usuario uc ON uc.id = t.creada_por`;

function condiciones(filtros: FiltrosTarea): { sql: string; valores: unknown[] } {
  // Una tarea de un expediente dado de baja no se muestra: el expediente ya no
  // está en ningún listado y la tarea quedaría huérfana a la vista.
  const partes: string[] = ['(t.causa_id IS NULL OR c.eliminado_en IS NULL)'];
  const valores: unknown[] = [];

  const agregar = (sql: (n: number) => string, valor: unknown) => {
    valores.push(valor);
    partes.push(sql(valores.length));
  };

  if (filtros.estado) agregar((n) => `t.estado = $${n}`, filtros.estado);
  if (filtros.asignada) agregar((n) => `t.asignada_a = $${n}`, filtros.asignada);
  if (filtros.causa) agregar((n) => `t.causa_id = $${n}`, filtros.causa);
  if (filtros.prioridad) agregar((n) => `t.prioridad = $${n}`, filtros.prioridad);
  if (filtros.busqueda) {
    agregar(
      (n) => `(fn_sin_acentos(t.titulo) ILIKE '%' || fn_sin_acentos($${n}) || '%'
               OR fn_sin_acentos(coalesce(c.caratula, '')) ILIKE '%' || fn_sin_acentos($${n}) || '%')`,
      filtros.busqueda,
    );
  }

  if (filtros.vigencia === 'abiertas') partes.push(`t.estado IN ('PENDIENTE', 'EN_CURSO')`);
  if (filtros.vigencia === 'cerradas') partes.push(`t.estado IN ('COMPLETADA', 'CANCELADA')`);

  return { sql: partes.join('\n     AND '), valores };
}

export async function listar(filtros: FiltrosTarea): Promise<Tarea[]> {
  const { sql: donde, valores } = condiciones(filtros);
  valores.push(filtros.tamano, desplazamiento(filtros));

  const { rows } = await obtenerPool().query<Tarea>(
    `SELECT ${COLUMNAS}
     ${ORIGEN}
      WHERE ${donde}
      -- Lo abierto primero; dentro, lo que vence antes y lo más urgente.
      ORDER BY CASE WHEN t.estado IN ('PENDIENTE', 'EN_CURSO') THEN 0 ELSE 1 END,
               t.fecha_vencimiento ASC NULLS LAST,
               CASE t.prioridad WHEN 'ALTA' THEN 0 WHEN 'MEDIA' THEN 1 ELSE 2 END,
               t.creado_en DESC
      LIMIT $${valores.length - 1} OFFSET $${valores.length}`,
    valores,
  );
  return rows;
}

export async function contar(filtros: FiltrosTarea): Promise<number> {
  const { sql: donde, valores } = condiciones(filtros);
  const { rows } = await obtenerPool().query<{ total: string }>(
    `SELECT count(*) AS total ${ORIGEN} WHERE ${donde}`,
    valores,
  );
  return Number.parseInt(rows[0]?.total ?? '0', 10);
}

export async function buscarPorId(id: string): Promise<Tarea | undefined> {
  const { rows } = await obtenerPool().query<Tarea>(
    `SELECT ${COLUMNAS} ${ORIGEN} WHERE t.id = $1`,
    [id],
  );
  return rows[0];
}

export async function crear(datos: DatosTarea, creadaPor: string): Promise<string> {
  const { rows } = await obtenerPool().query<{ id: string }>(
    `INSERT INTO tarea (titulo, descripcion, causa_id, plazo_id, asignada_a, prioridad,
                        fecha_vencimiento, creada_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      datos.titulo,
      datos.descripcion ?? null,
      datos.causa_id ?? null,
      datos.plazo_id ?? null,
      datos.asignada_a ?? null,
      datos.prioridad,
      datos.fecha_vencimiento ?? null,
      creadaPor,
    ],
  );
  return rows[0]!.id;
}

export async function actualizar(id: string, datos: DatosTarea): Promise<void> {
  await obtenerPool().query(
    `UPDATE tarea
        SET titulo = $2, descripcion = $3, causa_id = $4, plazo_id = $5, asignada_a = $6,
            prioridad = $7, fecha_vencimiento = $8
      WHERE id = $1`,
    [
      id,
      datos.titulo,
      datos.descripcion ?? null,
      datos.causa_id ?? null,
      datos.plazo_id ?? null,
      datos.asignada_a ?? null,
      datos.prioridad,
      datos.fecha_vencimiento ?? null,
    ],
  );
}

/** El CHECK de la tabla exige completada_en si y solo si está COMPLETADA. */
export async function cambiarEstado(id: string, estado: string): Promise<void> {
  await obtenerPool().query(
    `UPDATE tarea
        SET estado = $2::varchar,
            completada_en = CASE WHEN $2::varchar = 'COMPLETADA' THEN now() ELSE NULL END
      WHERE id = $1`,
    [id, estado],
  );
}

export async function eliminar(id: string): Promise<void> {
  await obtenerPool().query('DELETE FROM tarea WHERE id = $1', [id]);
}

export async function causaVigente(causaId: string): Promise<boolean> {
  const { rows } = await obtenerPool().query(
    'SELECT 1 FROM causa WHERE id = $1 AND eliminado_en IS NULL',
    [causaId],
  );
  return rows.length > 0;
}

export async function causaDelPlazo(plazoId: string): Promise<string | undefined> {
  const { rows } = await obtenerPool().query<{ causa_id: string }>(
    'SELECT causa_id FROM plazo WHERE id = $1',
    [plazoId],
  );
  return rows[0]?.causa_id;
}

export async function integranteActivo(usuarioId: string): Promise<boolean> {
  const { rows } = await obtenerPool().query(
    'SELECT 1 FROM usuario WHERE id = $1 AND activo',
    [usuarioId],
  );
  return rows.length > 0;
}
