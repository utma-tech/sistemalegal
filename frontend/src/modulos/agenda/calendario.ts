import type { ItemAgenda } from '../../tipos/api';

/**
 * Aritmética de calendario para la agenda.
 *
 * Todas las fechas son textos `YYYY-MM-DD` de pared del estudio, tal como los
 * manda la API. Se opera sobre ellos con Date.UTC para que la zona del
 * navegador nunca corra un día (un `new Date('2026-12-01')` en Argentina es el
 * 30 de noviembre a las 21 h).
 */

export type Vista = 'mes' | 'semana' | 'dia' | 'agenda';

export const VISTAS: { valor: Vista; texto: string }[] = [
  { valor: 'mes', texto: 'Mes' },
  { valor: 'semana', texto: 'Semana' },
  { valor: 'dia', texto: 'Día' },
  { valor: 'agenda', texto: 'Agenda' },
];

/** Días que abarca la vista de agenda (lista cronológica). */
export const DIAS_VISTA_AGENDA = 30;

function aMarca(fecha: string): number {
  const [a, m, d] = fecha.split('-').map(Number);
  return Date.UTC(a!, m! - 1, d!);
}

function deMarca(marca: number): string {
  return new Date(marca).toISOString().slice(0, 10);
}

export function sumarDias(fecha: string, dias: number): string {
  return deMarca(aMarca(fecha) + dias * 86_400_000);
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((aMarca(hasta) - aMarca(desde)) / 86_400_000);
}

/** 0 = lunes … 6 = domingo. */
export function diaSemana(fecha: string): number {
  return (new Date(aMarca(fecha)).getUTCDay() + 6) % 7;
}

export function inicioSemana(fecha: string): string {
  return sumarDias(fecha, -diaSemana(fecha));
}

export function inicioMes(fecha: string): string {
  return `${fecha.slice(0, 7)}-01`;
}

export function finMes(fecha: string): string {
  const [a, m] = fecha.split('-').map(Number);
  return deMarca(Date.UTC(a!, m!, 0));
}

export function sumarMeses(fecha: string, meses: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  // Se ancla al día 1 para que 31 de enero + 1 mes no salte a marzo.
  const base = new Date(Date.UTC(a!, m! - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  return deMarca(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), Math.min(d!, ultimo)));
}

/** Semanas (de lunes a domingo) que cubren el mes de `fecha`. Entre 4 y 6. */
export function semanasDelMes(fecha: string): string[][] {
  const desde = inicioSemana(inicioMes(fecha));
  const hasta = sumarDias(inicioSemana(finMes(fecha)), 6);
  const semanas: string[][] = [];
  for (let dia = desde; dia <= hasta; dia = sumarDias(dia, 7)) {
    semanas.push(Array.from({ length: 7 }, (_, i) => sumarDias(dia, i)));
  }
  return semanas;
}

/** Rango que hay que pedirle a la API para dibujar la vista. */
export function rangoVista(vista: Vista, fecha: string): { desde: string; hasta: string } {
  switch (vista) {
    case 'mes': {
      const semanas = semanasDelMes(fecha);
      return { desde: semanas[0]![0]!, hasta: semanas.at(-1)![6]! };
    }
    case 'semana': {
      const desde = inicioSemana(fecha);
      return { desde, hasta: sumarDias(desde, 6) };
    }
    case 'dia':
      return { desde: fecha, hasta: fecha };
    case 'agenda':
      return { desde: fecha, hasta: sumarDias(fecha, DIAS_VISTA_AGENDA - 1) };
  }
}

export function navegar(vista: Vista, fecha: string, sentido: 1 | -1): string {
  switch (vista) {
    case 'mes':
      return sumarMeses(inicioMes(fecha), sentido);
    case 'semana':
      return sumarDias(fecha, 7 * sentido);
    case 'dia':
      return sumarDias(fecha, sentido);
    case 'agenda':
      return sumarDias(fecha, DIAS_VISTA_AGENDA * sentido);
  }
}

const formato = (opciones: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-AR', { ...opciones, timeZone: 'UTC' });
const fmtMesAnio = formato({ month: 'long', year: 'numeric' });
const fmtDiaMes = formato({ day: 'numeric', month: 'short' });
const fmtLarga = formato({ weekday: 'long', day: 'numeric', month: 'long' });
const fmtLargaAnio = formato({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtSemana = formato({ weekday: 'short' });

function enFecha(fecha: string): Date {
  return new Date(aMarca(fecha) + 12 * 3_600_000);
}

function capital(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Título del período visible: "Noviembre de 2026", "23 – 29 nov. 2026"… */
export function etiquetaPeriodo(vista: Vista, fecha: string): string {
  switch (vista) {
    case 'mes':
      return capital(fmtMesAnio.format(enFecha(fecha)));
    case 'semana': {
      const desde = inicioSemana(fecha);
      const hasta = sumarDias(desde, 6);
      return `${fmtDiaMes.format(enFecha(desde))} – ${fmtDiaMes.format(enFecha(hasta))} ${hasta.slice(0, 4)}`;
    }
    case 'dia':
      return capital(fmtLargaAnio.format(enFecha(fecha)));
    case 'agenda':
      return `${fmtDiaMes.format(enFecha(fecha))} – ${fmtDiaMes.format(enFecha(sumarDias(fecha, DIAS_VISTA_AGENDA - 1)))}`;
  }
}

export function fechaLargaDia(fecha: string): string {
  return capital(fmtLarga.format(enFecha(fecha)));
}

export function nombreDiaCorto(fecha: string): string {
  return capital(fmtSemana.format(enFecha(fecha)).replace('.', ''));
}

export const NOMBRES_DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/** Fecha de hoy según el navegador. Solo como punto de partida: la API informa el "hoy" del estudio. */
export function hoyLocal(): string {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
}

/* --- Ubicación de los elementos ------------------------------------------------- */

export function fechaDe(valor: string): string {
  return valor.slice(0, 10);
}

export function horaDe(valor: string): string | null {
  return valor.length > 10 ? valor.slice(11, 16) : null;
}

export function minutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h! * 60 + m!;
}

/**
 * ¿El elemento ocupa ese día? Un evento con hora que termina justo a las 00:00
 * del día siguiente no ocupa ese día siguiente.
 */
export function ocupaDia(item: ItemAgenda, fecha: string): boolean {
  const inicio = fechaDe(item.inicio);
  const fin = fechaDe(item.fin);
  if (fecha < inicio || fecha > fin) return false;
  if (!item.todo_el_dia && fecha === fin && fecha !== inicio && horaDe(item.fin) === '00:00') return false;
  return true;
}

/** Orden dentro de un día: lo de día completo primero, después por hora. */
export function ordenarDelDia(items: ItemAgenda[]): ItemAgenda[] {
  return [...items].sort((a, b) => {
    if (a.todo_el_dia !== b.todo_el_dia) return a.todo_el_dia ? -1 : 1;
    if (a.tipo === 'INHABIL' || b.tipo === 'INHABIL') return a.tipo === 'INHABIL' ? -1 : 1;
    return a.inicio.localeCompare(b.inicio) || a.titulo.localeCompare(b.titulo);
  });
}

export interface BloqueDia {
  item: ItemAgenda;
  /** Minutos desde las 00:00 del día, recortados al día. */
  desde: number;
  hasta: number;
  columna: number;
  columnas: number;
  /** Racimo de superposiciones al que pertenece (para resumir los que no entran). */
  grupo: number;
}

/**
 * Disposición de los eventos con hora de un día en la grilla horaria.
 *
 * Los que se superponen se reparten en columnas. Se agrupan en racimos (cadena
 * de superposiciones) para que un evento suelto a la tarde no quede angosto
 * por culpa de dos que chocaron a la mañana.
 */
export function disponerDia(items: ItemAgenda[], fecha: string): BloqueDia[] {
  const conHora = items
    .filter((item) => !item.todo_el_dia && ocupaDia(item, fecha))
    .map((item) => {
      const desde = fechaDe(item.inicio) < fecha ? 0 : minutos(horaDe(item.inicio) ?? '00:00');
      let hasta = fechaDe(item.fin) > fecha ? 24 * 60 : minutos(horaDe(item.fin) ?? '23:59');
      // Un evento de duración cero o muy corta igual tiene que poder leerse.
      hasta = Math.max(hasta, desde + 30);
      return { item, desde, hasta: Math.min(hasta, 24 * 60), columna: 0, columnas: 1, grupo: 0 };
    })
    .sort((a, b) => a.desde - b.desde || b.hasta - a.hasta);

  const resultado: BloqueDia[] = [];
  let grupo = 0;
  let racimo: BloqueDia[] = [];
  let finRacimo = -1;
  let finesColumnas: number[] = [];

  const cerrar = () => {
    const columnas = finesColumnas.length || 1;
    for (const bloque of racimo) {
      bloque.columnas = columnas;
      bloque.grupo = grupo;
    }
    grupo += 1;
    resultado.push(...racimo);
    racimo = [];
    finesColumnas = [];
  };

  for (const bloque of conHora) {
    if (racimo.length && bloque.desde >= finRacimo) cerrar();
    let columna = finesColumnas.findIndex((fin) => fin <= bloque.desde);
    if (columna === -1) {
      columna = finesColumnas.length;
      finesColumnas.push(bloque.hasta);
    } else {
      finesColumnas[columna] = bloque.hasta;
    }
    bloque.columna = columna;
    racimo.push(bloque);
    finRacimo = Math.max(finRacimo, bloque.hasta);
  }
  if (racimo.length) cerrar();
  return resultado;
}

/** Texto de anticipación de un recordatorio: "1 día antes", "1 h antes"… */
export function textoAnticipacion(minutosAntes: number): string {
  if (minutosAntes === 0) return 'Al comenzar';
  if (minutosAntes % 10080 === 0) return `${minutosAntes / 10080} ${minutosAntes === 10080 ? 'semana' : 'semanas'} antes`;
  if (minutosAntes % 1440 === 0) return `${minutosAntes / 1440} ${minutosAntes === 1440 ? 'día' : 'días'} antes`;
  if (minutosAntes % 60 === 0) return `${minutosAntes / 60} h antes`;
  return `${minutosAntes} min antes`;
}
