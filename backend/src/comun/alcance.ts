import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { obtenerPool } from '../db';
import { ErrorAutenticacion, ErrorNoEncontrado } from './errores';
import type { SesionUsuario } from '../modulos/auth/tipos';

/**
 * Alcance de los datos por expediente.
 *
 * Los permisos (`causa.ver`, `plazo.editar`…) dicen QUÉ puede hacer un rol; el
 * alcance dice SOBRE QUÉ expedientes. Administrador y Jefe de Estudio ven todo
 * el estudio. Cualquier otro rol —hoy el Empleado, mañana uno nuevo que nadie
 * se acordó de configurar— opera solo sobre las causas en las que figura como
 * profesional asignado (profesional_causa con fecha_baja nula).
 *
 * La regla es "cerrada por defecto": un rol nuevo queda restringido hasta que
 * se lo agregue explícitamente a ROLES_SIN_RESTRICCION.
 *
 * Un expediente fuera del alcance responde 404, no 403: así no se puede usar la
 * API para averiguar qué identificadores existen.
 */

const ROLES_SIN_RESTRICCION = new Set(['ADMIN', 'JEFE_ESTUDIO']);

export function tieneAlcanceRestringido(sesion: SesionUsuario): boolean {
  return !ROLES_SIN_RESTRICCION.has(sesion.rol);
}

/**
 * Lo mismo a partir del código de rol, para decidir sobre un usuario que no es
 * el de la sesión (el destinatario de un aviso, el participante de un evento).
 */
export function rolConAlcanceGeneral(codigoRol: string): boolean {
  return ROLES_SIN_RESTRICCION.has(codigoRol);
}

/**
 * Id del usuario cuyo alcance hay que aplicar, o `null` si ve todo.
 *
 * Es el valor que reciben los filtros SQL de abajo como parámetro: `null`
 * desactiva el filtro sin armar consultas distintas para cada rol.
 */
export function usuarioAcotado(req: Request): string | null {
  const sesion = req.sesion;
  if (!sesion) throw new ErrorAutenticacion();
  return tieneAlcanceRestringido(sesion) ? sesion.id : null;
}

/**
 * Condición SQL: la causa `columna` está dentro del alcance del usuario que va
 * en el parámetro `parametro` (p. ej. `$3`). Con el parámetro en NULL siempre
 * se cumple.
 *
 * `columna` y `parametro` los escribe el código, nunca el usuario.
 */
export function sqlCausaEnAlcance(columna: string, parametro: string): string {
  return `(${parametro}::uuid IS NULL OR EXISTS (
            SELECT 1 FROM profesional_causa pc_alcance
             WHERE pc_alcance.causa_id = ${columna}
               AND pc_alcance.usuario_id = ${parametro}::uuid
               AND pc_alcance.fecha_baja IS NULL))`;
}

/**
 * Igual que sqlCausaEnAlcance, para registros cuya causa es optativa (tareas y
 * eventos de agenda): los que no cuelgan de ningún expediente son del estudio
 * y no se acotan.
 */
export function sqlCausaOpcionalEnAlcance(columna: string, parametro: string): string {
  return `(${columna} IS NULL OR ${sqlCausaEnAlcance(columna, parametro)})`;
}

/**
 * Condición SQL: el evento de agenda `alias` es visible para el usuario del
 * parámetro `usuario`, con el alcance del parámetro `alcance`.
 *
 * Dos controles, los dos obligatorios:
 *  1. Visibilidad propia del evento. ESTUDIO lo ve cualquiera; PERSONAL, solo
 *     quien lo creó y su responsable; PARTICIPANTES, además los convocados. Un
 *     evento sin expediente NO es público por no tener expediente.
 *  2. Alcance por expediente: si cuelga de una causa, hay que poder verla. Ser
 *     responsable o participante de un evento no abre un expediente ajeno.
 *
 * Ni Administrador ni Jefe de Estudio ven los eventos personales de otros: el
 * alcance general es sobre expedientes, no sobre la agenda privada de cada uno.
 */
export function sqlEventoVisible(alias: string, usuario: string, alcance: string): string {
  return `((${alias}.visibilidad = 'ESTUDIO'
            OR ${alias}.creado_por = ${usuario}::uuid
            OR ${alias}.responsable_id = ${usuario}::uuid
            OR (${alias}.visibilidad = 'PARTICIPANTES' AND EXISTS (
                  SELECT 1 FROM evento_participante ep_vis
                   WHERE ep_vis.evento_id = ${alias}.id
                     AND ep_vis.usuario_id = ${usuario}::uuid)))
           AND ${sqlCausaOpcionalEnAlcance(`${alias}.causa_id`, alcance)})`;
}

export async function puedeAccederACausa(req: Request, causaId: string): Promise<boolean> {
  const usuario = usuarioAcotado(req);
  if (!usuario) return true;
  const { rows } = await obtenerPool().query(
    `SELECT 1 FROM profesional_causa
      WHERE causa_id = $1 AND usuario_id = $2 AND fecha_baja IS NULL
      LIMIT 1`,
    [causaId, usuario],
  );
  return rows.length > 0;
}

/** Causas en las que el usuario está asignado hoy. Para filtrar en memoria lo que ya viene calculado. */
export async function causasAsignadas(usuarioId: string): Promise<Set<string>> {
  const { rows } = await obtenerPool().query<{ causa_id: string }>(
    'SELECT causa_id FROM profesional_causa WHERE usuario_id = $1 AND fecha_baja IS NULL',
    [usuarioId],
  );
  return new Set(rows.map((fila) => fila.causa_id));
}

/** Corta con 404 si la causa está fuera del alcance de quien pide. */
export async function exigirAccesoACausa(
  req: Request,
  causaId: string | null | undefined,
  mensaje = 'No encontramos ese expediente.',
): Promise<void> {
  if (!causaId) return;
  if (!(await puedeAccederACausa(req, causaId))) throw new ErrorNoEncontrado(mensaje);
}

const esquemaUuid = z.uuid();

/**
 * Para los routers que operan sobre un registro concreto (`/api/plazos/:id`,
 * `/api/costas/:id`…): se registra con `router.param('id', …)` y corre antes de
 * cualquier ruta del router que tenga `:id`, así que una ruta nueva hereda el
 * control sin tener que acordarse.
 *
 * `sqlCausa` devuelve la causa del registro a partir de su id (`$1`) y recibe
 * el usuario acotado en `$2` (puede ignorarlo con `$2::uuid IS NOT NULL`, pero
 * tiene que nombrarlo: PostgreSQL rechaza parámetros que la consulta no usa).
 * Devolver `causa_id` NULL deja pasar. Si el registro no existe se deja seguir:
 * la ruta responde su propio 404.
 */
export function alcancePorRegistro(sqlCausa: string, mensaje: string) {
  return async (req: Request, _res: Response, next: NextFunction, valor: unknown): Promise<void> => {
    try {
      const usuario = usuarioAcotado(req);
      if (usuario && esquemaUuid.safeParse(valor).success) {
        const { rows } = await obtenerPool().query<{ causa_id: string | null }>(sqlCausa, [valor, usuario]);
        if (rows[0]) await exigirAccesoACausa(req, rows[0].causa_id, mensaje);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware para todo lo que cuelga de `/api/causas/:id`.
 *
 * Se monta una sola vez en app.ts, delante de las rutas de causas y de los
 * plazos, costas y documentos de una causa: así ningún endpoint anidado nuevo
 * puede olvidarse de aplicar el alcance. Un id que no es UUID se deja pasar
 * para que la ruta responda su 400 de siempre.
 */
export async function alcanceCausaDeRuta(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const id = (req.params as Record<string, string | undefined>).id;
    if (esquemaUuid.safeParse(id).success) await exigirAccesoACausa(req, id);
    next();
  } catch (error) {
    next(error);
  }
}
