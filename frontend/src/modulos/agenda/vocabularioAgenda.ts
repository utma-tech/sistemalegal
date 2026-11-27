import {
  AlarmClock,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  Gavel,
  Handshake,
  ListChecks,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ItemAgenda, TipoAgenda } from '../../tipos/api';

/**
 * Vocabulario visual de la agenda: nombre, color e ícono de cada tipo.
 *
 * El color nunca va solo: cada tipo trae su ícono y su nombre, para que la
 * agenda se lea igual en blanco y negro o con daltonismo. Los tonos viven en
 * estilos/agenda.css (clases `tipo-*`) sobre los semánticos del sistema.
 */

export interface DefinicionTipo {
  texto: string;
  corto: string;
  clase: string;
  icono: LucideIcon;
}

export const TIPOS_AGENDA: Record<TipoAgenda, DefinicionTipo> = {
  AUDIENCIA: { texto: 'Audiencia', corto: 'Audiencia', clase: 'tipo-audiencia', icono: Gavel },
  MEDIACION: { texto: 'Mediación', corto: 'Mediación', clase: 'tipo-mediacion', icono: Handshake },
  REUNION: { texto: 'Reunión', corto: 'Reunión', clase: 'tipo-reunion', icono: Users },
  PLAZO: { texto: 'Plazo judicial', corto: 'Plazo', clase: 'tipo-plazo', icono: AlarmClock },
  VENCIMIENTO: { texto: 'Vencimiento administrativo', corto: 'Vencimiento', clase: 'tipo-vencimiento', icono: CalendarClock },
  TAREA: { texto: 'Tarea interna', corto: 'Tarea', clase: 'tipo-tarea', icono: ListChecks },
  OTRO: { texto: 'Otro', corto: 'Otro', clase: 'tipo-otro', icono: CalendarDays },
  INHABIL: { texto: 'Día inhábil', corto: 'Inhábil', clase: 'tipo-inhabil', icono: CalendarOff },
};

/** Orden de la leyenda y del filtro de tipos. */
export const ORDEN_TIPOS: TipoAgenda[] = [
  'AUDIENCIA',
  'MEDIACION',
  'REUNION',
  'PLAZO',
  'VENCIMIENTO',
  'TAREA',
  'OTRO',
  'INHABIL',
];

/** Tipos que se cargan desde la agenda (los plazos y tareas tienen su propio flujo). */
export const TIPOS_EVENTO_OPCIONES = [
  { valor: 'AUDIENCIA', texto: 'Audiencia' },
  { valor: 'MEDIACION', texto: 'Mediación' },
  { valor: 'REUNION', texto: 'Reunión' },
  { valor: 'VENCIMIENTO', texto: 'Vencimiento administrativo' },
  { valor: 'OTRO', texto: 'Otro' },
];

export const ESTADOS_EVENTO: Record<string, { texto: string; tono: 'neutral' | 'exito' | 'alerta' | 'peligro' | 'info' }> = {
  PENDIENTE: { texto: 'Pendiente', tono: 'alerta' },
  CONFIRMADO: { texto: 'Confirmado', tono: 'info' },
  COMPLETADO: { texto: 'Completado', tono: 'exito' },
  CANCELADO: { texto: 'Cancelado', tono: 'neutral' },
  // Plazos y tareas, con su propio vocabulario.
  VENCIDO: { texto: 'Vencido', tono: 'peligro' },
  CUMPLIDO: { texto: 'Cumplido', tono: 'exito' },
  SUSPENDIDO: { texto: 'Suspendido', tono: 'info' },
  EN_CURSO: { texto: 'En curso', tono: 'info' },
  COMPLETADA: { texto: 'Completada', tono: 'exito' },
  CANCELADA: { texto: 'Cancelada', tono: 'neutral' },
};

export const VISIBILIDADES = [
  { valor: 'ESTUDIO', texto: 'Todo el estudio', ayuda: 'Lo ve quien tenga acceso a la agenda (y al expediente, si tiene uno).' },
  { valor: 'PARTICIPANTES', texto: 'Solo participantes', ayuda: 'Lo ven quien lo crea, el responsable y los participantes.' },
  { valor: 'PERSONAL', texto: 'Personal', ayuda: 'Solo lo ven quien lo crea y el responsable.' },
] as const;

/** Anticipaciones que ofrece el formulario. */
export const OPCIONES_RECORDATORIO = [15, 60, 180, 1440, 2880, 10080];

/** Un plazo vencido o en alerta crítica se destaca; el resto de la agenda queda sereno. */
export function esCritico(item: Pick<ItemAgenda, 'tipo' | 'estado' | 'nivel'>): boolean {
  return item.tipo === 'PLAZO' && (item.estado === 'VENCIDO' || item.nivel === 'CRITICA');
}

export function estaCerrado(item: Pick<ItemAgenda, 'estado'>): boolean {
  return ['COMPLETADO', 'CANCELADO', 'CUMPLIDO', 'COMPLETADA', 'CANCELADA'].includes(item.estado);
}
