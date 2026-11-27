/**
 * Aritmética de horas de pared (sin zona) para la agenda.
 *
 * Todo lo que entra y sale de la API de agenda es hora de pared del estudio.
 * Estas funciones operan sobre esos textos como si fueran UTC —solo para
 * sumar minutos o días sin que intervenga la zona de la máquina— y la base
 * convierte el resultado a instante con `AT TIME ZONE` y ZONA_HORARIA.
 */

export interface DatosIntervalo {
  todo_el_dia: boolean;
  fecha_inicio: string;
  hora_inicio?: string;
  fecha_fin?: string;
  hora_fin?: string;
}

export interface IntervaloLocal {
  /** `YYYY-MM-DD HH:mm:ss`, hora de pared del estudio. */
  inicio: string;
  fin: string;
}

/** Duración por defecto de un evento con hora y sin hora de fin. */
export const MINUTOS_DURACION_POR_DEFECTO = 60;

function aMarca(fecha: string, hora: string): number {
  return Date.parse(`${fecha}T${hora}:00Z`);
}

function deMarca(marca: number): string {
  return new Date(marca).toISOString().slice(0, 19).replace('T', ' ');
}

export function sumarMinutos(fecha: string, hora: string, minutos: number): { fecha: string; hora: string } {
  const texto = deMarca(aMarca(fecha, hora) + minutos * 60_000);
  return { fecha: texto.slice(0, 10), hora: texto.slice(11, 16) };
}

export function sumarDias(fecha: string, dias: number): string {
  return deMarca(Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000).slice(0, 10);
}

/**
 * Intervalo a guardar.
 *  - Día completo: de 00:00:00 del primer día a 23:59:59 del último (fin inclusivo).
 *  - Con hora: de la hora de inicio a la de fin; sin hora de fin, una hora.
 */
export function intervaloLocal(d: DatosIntervalo): IntervaloLocal {
  const fechaFin = d.fecha_fin ?? d.fecha_inicio;
  if (d.todo_el_dia || !d.hora_inicio) {
    return { inicio: `${d.fecha_inicio} 00:00:00`, fin: `${fechaFin} 23:59:59` };
  }
  if (d.hora_fin) {
    return { inicio: `${d.fecha_inicio} ${d.hora_inicio}:00`, fin: `${fechaFin} ${d.hora_fin}:00` };
  }
  const fin = sumarMinutos(d.fecha_inicio, d.hora_inicio, MINUTOS_DURACION_POR_DEFECTO);
  return { inicio: `${d.fecha_inicio} ${d.hora_inicio}:00`, fin: `${fin.fecha} ${fin.hora}:00` };
}
