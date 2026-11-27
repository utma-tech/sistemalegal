import { z } from 'zod';
import { fechaOpcional, textoOpcional, uuidOpcional } from '../../comun/ruta';

/**
 * Validación de la agenda jurídica.
 *
 * Las fechas y horas llegan como hora de pared del estudio (`YYYY-MM-DD` y
 * `HH:mm`), nunca como instantes con zona del navegador: quien carga una
 * audiencia a las 9:30 quiere decir 9:30 en Córdoba, esté donde esté su
 * computadora. La conversión a instante la hace la base con ZONA_HORARIA.
 */

export const TIPOS_EVENTO = ['AUDIENCIA', 'MEDIACION', 'REUNION', 'VENCIMIENTO', 'OTRO'] as const;
export const TIPOS_AGENDA = [...TIPOS_EVENTO, 'PLAZO', 'TAREA', 'INHABIL'] as const;
export const ESTADOS_EVENTO = ['PENDIENTE', 'CONFIRMADO', 'COMPLETADO', 'CANCELADO'] as const;
export const PRIORIDADES = ['ALTA', 'MEDIA', 'BAJA'] as const;
export const VISIBILIDADES = ['PERSONAL', 'PARTICIPANTES', 'ESTUDIO'] as const;

export type TipoEvento = (typeof TIPOS_EVENTO)[number];
export type TipoAgenda = (typeof TIPOS_AGENDA)[number];
export type EstadoEvento = (typeof ESTADOS_EVENTO)[number];

/** Tope de la ventana consultada: una vista mensual usa 42 días; la de agenda, 60. */
export const DIAS_MAXIMOS_RANGO = 100;

const hora = (mensaje: string) =>
  z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, mensaje)
    .optional()
    .or(z.literal(''))
    .transform((v) => v || undefined);

const enlace = z
  .string()
  .trim()
  .max(500, 'Máximo 500 caracteres.')
  .regex(/^https:\/\/[^\s]+$/, 'El enlace tiene que empezar con https://')
  .optional()
  .or(z.literal(''))
  .transform((v) => v || undefined);

export const esquemaEvento = z
  .object({
    titulo: z.string().trim().min(1, 'Indicá un título.').max(200, 'Máximo 200 caracteres.'),
    tipo: z.enum(TIPOS_EVENTO, 'Elegí el tipo de evento.'),
    descripcion: textoOpcional(2000),
    prioridad: z.enum(PRIORIDADES).default('MEDIA'),
    todo_el_dia: z.boolean().default(false),
    fecha_inicio: z.iso.date('Indicá la fecha.'),
    hora_inicio: hora('Hora inválida.'),
    fecha_fin: fechaOpcional('Fecha de fin inválida.'),
    hora_fin: hora('Hora inválida.'),
    causa_id: uuidOpcional('Expediente inválido.'),
    persona_id: uuidOpcional('Persona inválida.'),
    responsable_id: uuidOpcional('Responsable inválido.'),
    participantes: z.array(z.uuid('Participante inválido.')).max(30, 'Hasta 30 participantes.').default([]),
    lugar: textoOpcional(200),
    enlace_virtual: enlace,
    observaciones: textoOpcional(2000),
    visibilidad: z.enum(VISIBILIDADES).default('ESTUDIO'),
    /** Minutos de anticipación. Sin informar, se usan las reglas del estudio para el tipo. */
    recordatorios: z
      .array(z.number().int().min(0).max(43200, 'Hasta 30 días antes.'))
      .max(5, 'Hasta 5 recordatorios.')
      .optional(),
  })
  .superRefine((d, ctx) => {
    if (!d.todo_el_dia && !d.hora_inicio) {
      ctx.addIssue({ code: 'custom', path: ['hora_inicio'], message: 'Indicá la hora o marcá "todo el día".' });
    }
    const fin = d.fecha_fin ?? d.fecha_inicio;
    if (fin < d.fecha_inicio) {
      ctx.addIssue({ code: 'custom', path: ['fecha_fin'], message: 'La fecha de fin es anterior al inicio.' });
    }
    if (!d.todo_el_dia && d.hora_inicio && d.hora_fin && fin === d.fecha_inicio && d.hora_fin <= d.hora_inicio) {
      ctx.addIssue({ code: 'custom', path: ['hora_fin'], message: 'La hora de fin tiene que ser posterior al inicio.' });
    }
    if (d.visibilidad === 'PERSONAL' && d.participantes.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['participantes'],
        message: 'Un evento personal no tiene participantes. Elegí otra visibilidad.',
      });
    }
    if (new Set(d.participantes).size !== d.participantes.length) {
      ctx.addIssue({ code: 'custom', path: ['participantes'], message: 'Hay participantes repetidos.' });
    }
  });

export type DatosEvento = z.infer<typeof esquemaEvento>;

export const esquemaEstadoEvento = z
  .object({
    estado: z.enum(ESTADOS_EVENTO, 'Estado inválido.'),
    motivo: textoOpcional(300),
  })
  .superRefine((d, ctx) => {
    if (d.estado === 'CANCELADO' && (!d.motivo || d.motivo.length < 3)) {
      ctx.addIssue({ code: 'custom', path: ['motivo'], message: 'Indicá el motivo de la cancelación.' });
    }
  });

export type DatosEstadoEvento = z.infer<typeof esquemaEstadoEvento>;

const booleano = (porDefecto: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? porDefecto : v === 'true' || v === '1'));

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

export const esquemaFiltrosAgenda = z
  .object({
    desde: z.iso.date('Fecha "desde" inválida.'),
    hasta: z.iso.date('Fecha "hasta" inválida.'),
    /** Lista separada por comas. Vacía o ausente = todos los tipos. */
    tipos: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (!v) return [...TIPOS_AGENDA] as TipoAgenda[];
        const lista = v.split(',').map((t) => t.trim()).filter(Boolean);
        const invalidos = lista.filter((t) => !(TIPOS_AGENDA as readonly string[]).includes(t));
        if (invalidos.length) {
          ctx.addIssue({ code: 'custom', message: `Tipos inválidos: ${invalidos.join(', ')}` });
          return z.NEVER;
        }
        return lista as TipoAgenda[];
      }),
    responsable: uuidOpcional('Responsable inválido.'),
    causa: uuidOpcional('Expediente inválido.'),
    estado: z
      .enum(ESTADOS_EVENTO)
      .optional()
      .or(z.literal(''))
      .transform((v) => v || undefined),
    prioridad: z
      .enum(PRIORIDADES)
      .optional()
      .or(z.literal(''))
      .transform((v) => v || undefined),
    /** 'mios' = de los que soy responsable, creador o participante. */
    alcance: z.enum(['estudio', 'mios']).default('estudio'),
    completados: booleano(false),
    cancelados: booleano(false),
  })
  .superRefine((d, ctx) => {
    const dias = diasEntre(d.desde, d.hasta);
    if (dias < 0) ctx.addIssue({ code: 'custom', path: ['hasta'], message: 'El rango está invertido.' });
    if (dias > DIAS_MAXIMOS_RANGO) {
      ctx.addIssue({ code: 'custom', path: ['hasta'], message: `El rango no puede superar ${DIAS_MAXIMOS_RANGO} días.` });
    }
  });

export type FiltrosAgenda = z.infer<typeof esquemaFiltrosAgenda>;

export const esquemaConflictos = z.object({
  fecha_inicio: z.iso.date(),
  hora_inicio: hora('Hora inválida.'),
  fecha_fin: fechaOpcional('Fecha inválida.'),
  hora_fin: hora('Hora inválida.'),
  todo_el_dia: booleano(false),
  responsable: uuidOpcional('Responsable inválido.'),
  participantes: z
    .string()
    .optional()
    .transform((v, ctx) => {
      const lista = (v ?? '').split(',').map((t) => t.trim()).filter(Boolean);
      if (lista.some((id) => !z.uuid().safeParse(id).success)) {
        ctx.addIssue({ code: 'custom', message: 'Participantes inválidos.' });
        return z.NEVER;
      }
      return lista.slice(0, 30);
    }),
  excluir: uuidOpcional('Evento inválido.'),
});

export type DatosConflictos = z.infer<typeof esquemaConflictos>;
