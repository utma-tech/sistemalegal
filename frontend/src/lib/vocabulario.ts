/**
 * Vocabulario del dominio: los valores que la base admite y cómo se nombran en
 * pantalla.
 *
 * Son listas cerradas definidas por restricciones CHECK en las migraciones, no
 * tablas de catálogo, así que no hay endpoint que las devuelva. Se replican acá
 * con el comentario que dice de dónde salen: si alguna cambia, cambia por una
 * migración y este archivo se actualiza con ella.
 *
 * El texto visible nunca es el código. "CODEMANDADO" es lo que guarda la base;
 * "Codemandado" es lo que lee el abogado.
 */

export interface OpcionVocabulario {
  valor: string;
  texto: string;
}

/** `ck_parte_caracter` — migración 004. Carácter procesal de una parte. */
export const CARACTERES_PARTE: OpcionVocabulario[] = [
  { valor: 'ACTOR', texto: 'Actor' },
  { valor: 'DEMANDADO', texto: 'Demandado' },
  { valor: 'CODEMANDADO', texto: 'Codemandado' },
  { valor: 'TERCERO', texto: 'Tercero' },
  { valor: 'PERITO', texto: 'Perito' },
  { valor: 'TESTIGO', texto: 'Testigo' },
];

/** `ck_profesional_rol` — migración 004. Rol de un integrante del estudio en la causa. */
export const ROLES_PROFESIONAL: OpcionVocabulario[] = [
  { valor: 'TITULAR', texto: 'Titular' },
  { valor: 'PATROCINANTE', texto: 'Patrocinante' },
  { valor: 'APODERADO', texto: 'Apoderado' },
  { valor: 'COLABORADOR', texto: 'Colaborador' },
];

/** `ck_persona_tipo_documento` — migración 004. */
export const TIPOS_DOCUMENTO: OpcionVocabulario[] = [
  { valor: 'DNI', texto: 'DNI' },
  { valor: 'LC', texto: 'Libreta cívica' },
  { valor: 'LE', texto: 'Libreta de enrolamiento' },
  { valor: 'CI', texto: 'Cédula de identidad' },
  { valor: 'PASAPORTE', texto: 'Pasaporte' },
  { valor: 'CUIT', texto: 'CUIT' },
  { valor: 'CUIL', texto: 'CUIL' },
];

export const TIPOS_PERSONA: OpcionVocabulario[] = [
  { valor: 'FISICA', texto: 'Persona física' },
  { valor: 'JURIDICA', texto: 'Persona jurídica' },
];

/** Busca el texto visible de un código. Si no lo conoce, devuelve el código tal cual. */
function texto(lista: OpcionVocabulario[], codigo: string | null | undefined): string {
  if (!codigo) return '—';
  return lista.find((opcion) => opcion.valor === codigo)?.texto ?? codigo;
}

export const caracterLegible = (codigo: string | null | undefined) => texto(CARACTERES_PARTE, codigo);
export const rolLegible = (codigo: string | null | undefined) => texto(ROLES_PROFESIONAL, codigo);
export const tipoPersonaLegible = (codigo: string | null | undefined) => texto(TIPOS_PERSONA, codigo);

/* --- Módulos de operación ---------------------------------------------------- */

/** `ck_tarea_prioridad` — migración 009. */
export const PRIORIDADES_TAREA: OpcionVocabulario[] = [
  { valor: 'ALTA', texto: 'Alta' },
  { valor: 'MEDIA', texto: 'Media' },
  { valor: 'BAJA', texto: 'Baja' },
];

/** `ck_tarea_estado` — migración 009. */
export const ESTADOS_TAREA: OpcionVocabulario[] = [
  { valor: 'PENDIENTE', texto: 'Pendiente' },
  { valor: 'EN_CURSO', texto: 'En curso' },
  { valor: 'COMPLETADA', texto: 'Completada' },
  { valor: 'CANCELADA', texto: 'Cancelada' },
];

/** `ck_dia_inhabil_tipo` — migración 006. */
export const TIPOS_INHABIL: OpcionVocabulario[] = [
  { valor: 'FERIADO_NACIONAL', texto: 'Feriado nacional' },
  { valor: 'FERIADO_PROVINCIAL', texto: 'Feriado provincial' },
  { valor: 'FERIA_JUDICIAL', texto: 'Feria judicial' },
  { valor: 'ASUETO', texto: 'Asueto' },
  { valor: 'OTRO', texto: 'Otro' },
];

/** `ck_costa_a_cargo` — migración 008. */
export const A_CARGO_COSTA: OpcionVocabulario[] = [
  { valor: 'CLIENTE', texto: 'Cliente' },
  { valor: 'ESTUDIO', texto: 'Estudio (a recuperar)' },
  { valor: 'CONTRARIA', texto: 'Parte contraria' },
];

/** `ck_costa_estado` — migración 008. */
export const ESTADOS_COBRO: OpcionVocabulario[] = [
  { valor: 'PENDIENTE', texto: 'Pendiente' },
  { valor: 'PARCIAL', texto: 'Cobro parcial' },
  { valor: 'COBRADO', texto: 'Cobrada' },
  { valor: 'INCOBRABLE', texto: 'Incobrable' },
];

/** `ck_cobro_medio` — migración 008. */
export const MEDIOS_PAGO: OpcionVocabulario[] = [
  { valor: 'TRANSFERENCIA', texto: 'Transferencia' },
  { valor: 'EFECTIVO', texto: 'Efectivo' },
  { valor: 'CHEQUE', texto: 'Cheque' },
  { valor: 'TARJETA', texto: 'Tarjeta' },
  { valor: 'OTRO', texto: 'Otro' },
];

/** `ck_rol_codigo` — migración 003. */
export const ROLES_USUARIO: OpcionVocabulario[] = [
  { valor: 'ADMIN', texto: 'Administrador' },
  { valor: 'JEFE_ESTUDIO', texto: 'Jefe de Estudio' },
  { valor: 'EMPLEADO', texto: 'Empleado' },
];

export const NIVELES_ALERTA: OpcionVocabulario[] = [
  { valor: 'CRITICA', texto: 'Crítica' },
  { valor: 'IMPORTANTE', texto: 'Importante' },
  { valor: 'INFORMATIVA', texto: 'Informativa' },
];

export const tipoInhabilLegible = (codigo: string | null | undefined) => texto(TIPOS_INHABIL, codigo);
export const aCargoLegible = (codigo: string | null | undefined) => texto(A_CARGO_COSTA, codigo);
export const estadoCobroLegible = (codigo: string | null | undefined) => texto(ESTADOS_COBRO, codigo);
export const medioPagoLegible = (codigo: string | null | undefined) => texto(MEDIOS_PAGO, codigo);
export const nivelAlertaLegible = (codigo: string | null | undefined) => texto(NIVELES_ALERTA, codigo);
