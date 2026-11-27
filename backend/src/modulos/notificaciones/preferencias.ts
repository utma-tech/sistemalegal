import { z } from 'zod';
import { obtenerPool } from '../../db';

/**
 * Preferencias de notificación de cada integrante (tabla preferencia_notificacion).
 *
 * Gobiernan SOLO el correo. Los avisos dentro del sistema se entregan siempre:
 * apagar el correo no puede esconder un vencimiento crítico. Sin fila guardada
 * valen los valores por defecto (todo activado), así que un usuario nuevo
 * recibe avisos sin tener que configurar nada.
 */

export interface Preferencias {
  correo_habilitado: boolean;
  recordatorio_audiencia: boolean;
  recordatorio_mediacion: boolean;
  recordatorio_reunion: boolean;
  recordatorio_otros: boolean;
  aviso_plazos: boolean;
  aviso_asignaciones: boolean;
  aviso_reprogramaciones: boolean;
  aviso_cancelaciones: boolean;
}

export const PREFERENCIAS_POR_DEFECTO: Preferencias = {
  correo_habilitado: true,
  recordatorio_audiencia: true,
  recordatorio_mediacion: true,
  recordatorio_reunion: true,
  recordatorio_otros: true,
  aviso_plazos: true,
  aviso_asignaciones: true,
  aviso_reprogramaciones: true,
  aviso_cancelaciones: true,
};

const CAMPOS = Object.keys(PREFERENCIAS_POR_DEFECTO) as (keyof Preferencias)[];

export const esquemaPreferencias = z.object(
  Object.fromEntries(CAMPOS.map((campo) => [campo, z.boolean()])) as Record<keyof Preferencias, z.ZodBoolean>,
);

export async function preferenciasDe(usuarioId: string): Promise<Preferencias> {
  const { rows } = await obtenerPool().query<Preferencias>(
    `SELECT ${CAMPOS.join(', ')} FROM preferencia_notificacion WHERE usuario_id = $1`,
    [usuarioId],
  );
  return rows[0] ?? { ...PREFERENCIAS_POR_DEFECTO };
}

export async function guardarPreferencias(usuarioId: string, datos: Preferencias): Promise<Preferencias> {
  const valores = CAMPOS.map((campo) => datos[campo]);
  const columnas = CAMPOS.join(', ');
  const marcadores = CAMPOS.map((_, i) => `$${i + 2}`).join(', ');
  const actualizacion = CAMPOS.map((campo) => `${campo} = EXCLUDED.${campo}`).join(', ');
  const { rows } = await obtenerPool().query<Preferencias>(
    `INSERT INTO preferencia_notificacion (usuario_id, ${columnas})
     VALUES ($1, ${marcadores})
     ON CONFLICT (usuario_id) DO UPDATE SET ${actualizacion}
     RETURNING ${columnas}`,
    [usuarioId, ...valores],
  );
  return rows[0]!;
}
