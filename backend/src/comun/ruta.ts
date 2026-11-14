import type { Request } from 'express';
import { z } from 'zod';
import { ErrorSolicitud } from './errores';

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

/** Hoy en formato `YYYY-MM-DD`, en la zona horaria del servidor. */
export function hoy(): string {
  const ahora = new Date();
  const anio = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const dia = String(ahora.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}
