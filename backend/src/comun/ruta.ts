import type { Request } from 'express';
import { z } from 'zod';
import { ErrorSolicitud } from './errores';
import { config } from '../config';

/**
 * Lectura de parámetros de ruta.
 *
 * Un identificador que no es UUID no puede existir en la base: se rechaza con
 * un 400 legible antes de que PostgreSQL responda con un error de sintaxis que
 * terminaría como 500.
 */

const esquemaUuid = z.uuid();

export function idDeRuta(req: Request, que = 'registro', parametro = 'id'): string {
  const valor = (req.params as Record<string, string | undefined>)[parametro];
  const resultado = esquemaUuid.safeParse(valor);
  if (!resultado.success) throw new ErrorSolicitud(`El identificador del ${que} no es válido.`);
  return resultado.data;
}

/** Texto opcional: vacío o ausente se normaliza a `undefined`. */
export const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres.`)
    .optional()
    .or(z.literal(''))
    .transform((v) => v || undefined);

export const uuidOpcional = (mensaje: string) =>
  z
    .uuid(mensaje)
    .optional()
    .or(z.literal(''))
    .transform((v) => v || undefined);

export const fechaOpcional = (mensaje: string) =>
  z.iso
    .date(mensaje)
    .optional()
    .or(z.literal(''))
    .transform((v) => v || undefined);

/**
 * Hoy en formato `YYYY-MM-DD`, en la zona horaria del estudio (ZONA_HORARIA).
 *
 * Antes usaba la zona del servidor. En Render es UTC: entre las 21 h y la
 * medianoche de Argentina "hoy" ya era mañana, y una alerta podía adelantarse
 * un día. La fecha procesal es la del estudio, no la de la máquina.
 */
export function hoy(ahora: Date = new Date()): string {
  return fechaEnZona(ahora, config.zonaHoraria);
}

/** Fecha civil (`YYYY-MM-DD`) de un instante en una zona IANA. */
export function fechaEnZona(instante: Date, zona: string): string {
  // en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);
}

/** Hora de pared (`HH:mm`) de un instante en una zona IANA. */
export function horaEnZona(instante: Date, zona: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zona,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instante);
}
