import { z } from 'zod';
import { esquemaPaginacion } from '../../comun/paginacion';
import { fechaOpcional, textoOpcional, uuidOpcional } from '../../comun/ruta';

/** Entrada válida del módulo de tareas. */

export const PRIORIDADES = ['ALTA', 'MEDIA', 'BAJA'] as const;
export const ESTADOS_TAREA = ['PENDIENTE', 'EN_CURSO', 'COMPLETADA', 'CANCELADA'] as const;

export const esquemaTarea = z.object({
  titulo: z
    .string()
    .trim()
    .min(1, 'Indicá qué hay que hacer.')
    .max(200, 'Máximo 200 caracteres.'),
  descripcion: textoOpcional(5000),
  /** Opcional: hay tareas administrativas que no cuelgan de ningún expediente. */
  causa_id: uuidOpcional('Expediente inválido.'),
  /** Si la tarea nace de vigilar un plazo, el plazo tiene que ser del mismo expediente. */
  plazo_id: uuidOpcional('Plazo inválido.'),
  asignada_a: uuidOpcional('Integrante inválido.'),
  prioridad: z.enum(PRIORIDADES, 'Elegí una prioridad.').default('MEDIA'),
  fecha_vencimiento: fechaOpcional('Fecha inválida.'),
});

export type DatosTarea = z.infer<typeof esquemaTarea>;

/**
 * Cambio de estado.
 *
 * Va por su propia acción y no dentro del PUT: completar una tarea registra
 * cuándo, y reabrirla lo borra. Mezclarlo con la edición del texto obligaría al
 * formulario a mandar un estado que el usuario no tocó.
 */
export const esquemaEstadoTarea = z.object({
  estado: z.enum(ESTADOS_TAREA, 'Estado inválido.'),
});

export type DatosEstadoTarea = z.infer<typeof esquemaEstadoTarea>;

export const esquemaFiltrosTarea = esquemaPaginacion.extend({
  estado: z.enum(ESTADOS_TAREA).optional(),
  asignada: z.uuid('Integrante inválido.').optional(),
  causa: z.uuid('Expediente inválido.').optional(),
  prioridad: z.enum(PRIORIDADES).optional(),
  /** 'abiertas' = pendientes y en curso, que es lo que hay que hacer. */
  vigencia: z.enum(['todas', 'abiertas', 'cerradas']).default('abiertas'),
  busqueda: z.string().trim().max(100).optional(),
});

export type FiltrosTarea = z.infer<typeof esquemaFiltrosTarea>;
