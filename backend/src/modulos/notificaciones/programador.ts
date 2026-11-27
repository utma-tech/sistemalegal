import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../../config';
import { obtenerPool } from '../../db';
import { evaluarYRegistrar, invalidarEvaluacion } from '../alertas/servicio';
import { procesarCola, type ResultadoProceso } from './cola';

/**
 * Corrida del proceso de avisos.
 *
 * La dispara un programador EXTERNO (Supabase Cron, Render Cron Job o similar)
 * contra POST /api/interno/programador, o un administrador a mano. No hay un
 * setInterval dentro del servidor: en Render gratis el servicio se duerme a
 * los 15 minutos sin tráfico y un temporizador interno dejaría de correr justo
 * cuando nadie usa la aplicación, que es cuando más importan los avisos.
 *
 * Cada corrida: (1) evalúa las alertas de plazos por días hábiles (la misma
 * función de siempre) y (2) entrega lo que venció en la cola. Todo lo que se
 * atrasó por una corrida perdida se recupera en la siguiente, porque la cola
 * toma todo lo que tenga proximo_intento <= now().
 */

export type OrigenEjecucion = 'PROGRAMADOR' | 'MANUAL';

export interface ResumenEjecucion extends ResultadoProceso {
  id: string;
  alertas_creadas: number;
  pendientes: number;
  duracion_ms: number;
}

/** Tope por corrida: deja margen al timeout típico de un programador HTTP (30 s). */
const TIEMPO_MAXIMO_MS = 20_000;

export async function ejecutar(origen: OrigenEjecucion): Promise<ResumenEjecucion> {
  const pool = obtenerPool();
  const inicio = Date.now();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO ejecucion_programador (origen) VALUES ($1) RETURNING id`,
    [origen],
  );
  const id = rows[0]!.id;

  try {
    invalidarEvaluacion();
    const alertas = await evaluarYRegistrar();
    const resultado = await procesarCola({ limite: 500, tiempoMaximoMs: TIEMPO_MAXIMO_MS });
    await pool.query(
      `UPDATE ejecucion_programador
          SET finalizado_en = now(), alertas_creadas = $2, procesados = $3, aceptados = $4,
              fallidos = $5, cancelados = $6, reintentos = $7
        WHERE id = $1`,
      [id, alertas, resultado.procesados, resultado.aceptados, resultado.fallidos, resultado.cancelados, resultado.reintentos],
    );
    const pendientes = await contarPendientes();
    return { id, alertas_creadas: alertas, ...resultado, pendientes, duracion_ms: Date.now() - inicio };
  } catch (error) {
    console.error('[programador] la corrida falló', error);
    await pool
      .query(`UPDATE ejecucion_programador SET finalizado_en = now(), error = $2 WHERE id = $1`, [
        id,
        'La corrida terminó con un error interno. El detalle está en el log del servidor.',
      ])
      .catch(() => undefined);
    throw error;
  }
}

export async function contarPendientes(): Promise<number> {
  const { rows } = await obtenerPool().query<{ total: number }>(
    `SELECT count(*)::int AS total FROM envio_notificacion
      WHERE estado IN ('PENDIENTE', 'PROCESANDO') AND proximo_intento <= now()`,
  );
  return rows[0]?.total ?? 0;
}

/**
 * Compara el secreto recibido con CRON_SECRET en tiempo constante. Se comparan
 * los hash para que las longitudes coincidan siempre (timingSafeEqual exige
 * buffers del mismo tamaño y la longitud no debe filtrarse).
 */
export function secretoValido(recibido: string | undefined): boolean {
  const esperado = config.secretoProgramador;
  if (!esperado || !recibido) return false;
  const a = createHash('sha256').update(recibido).digest();
  const b = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(a, b);
}
