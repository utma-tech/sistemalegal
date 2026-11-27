/**
 * Contratos compartidos con el backend.
 *
 * Se mantienen a mano y reflejan exactamente lo que devuelven los endpoints de
 * backend/src/modulos. Cuando el contrato crezca conviene generarlos desde el
 * backend para que no se desincronicen.
 */

export interface Pagina<T> {
  datos: T[];
  total: number;
  pagina: number;
  tamano: number;
  totalPaginas: number;
}

/* --- Sesión ---------------------------------------------------------------- */

export interface Usuario {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  rol: string;
  rolNombre: string;
  jerarquia: number;
  permisos: string[];
}

export interface RespuestaSesion {
  accessToken: string;
  expiraEnMinutos: number;
  usuario: Usuario;
}

/* --- Causas ---------------------------------------------------------------- */

export interface CausaListada {
  id: string;
  numero_expediente: string | null;
  caratula: string;
  fecha_inicio: string;
  estado: string;
  estado_codigo: string;
  es_final: boolean;
  fuero: string;
  tribunal: string | null;
  responsable: string | null;
  plazos_pendientes: number;
  proximo_vencimiento: string | null;
}

export interface CausaDetalle extends CausaListada {
  /** Ids de los catálogos, para precargar el formulario de edición. */
  fuero_id: string;
  estado_causa_id: string;
  tribunal_id: string | null;
  tipo_causa_id: string | null;
  tipo_causa: string | null;
  jurisdiccion: string | null;
  tribunal_domicilio: string | null;
  fecha_cierre: string | null;
  monto_reclamado: string | null;
  moneda: string;
  observaciones: string | null;
  creado_en: string;
  actualizado_en: string;
  cantidad_documentos: number;
  cantidad_movimientos: number;
  cantidad_tareas_abiertas: number;
}

export interface ParteCausa {
  id: string;
  persona_id: string;
  nombre_completo: string;
  tipo_persona: string;
  documento: string | null;
  email: string | null;
  telefono: string | null;
  caracter: string;
  es_cliente: boolean;
}

export interface ProfesionalCausa {
  id: string;
  usuario_id: string;
  nombre_completo: string;
  matricula: string | null;
  rol_en_causa: string;
  fecha_asignacion: string;
}

export interface DetalleCausa {
  causa: CausaDetalle;
  partes: ParteCausa[];
  profesionales: ProfesionalCausa[];
}

export interface MovimientoCausa {
  id: string;
  fecha: string;
  tipo: string | null;
  descripcion: string;
  origen: string;
  registrado_por: string | null;
}

/* --- Plazos ----------------------------------------------------------------
   La pestaña del expediente y la agenda muestran el mismo dato, así que
   comparten el tipo. */

export interface PlazoListado {
  id: string;
  causa_id: string;
  caratula: string;
  numero_expediente: string | null;
  descripcion: string;
  tipo_plazo: string | null;
  articulo_referencia: string | null;
  fecha_notificacion: string;
  fecha_inicio_computo: string;
  fecha_vencimiento: string;
  fecha_vencimiento_original: string;
  cantidad_dias: number;
  computo: string;
  estado: string;
  responsable: string | null;
  responsable_id: string | null;
  fecha_cumplimiento: string | null;
  /** Negativo si ya venció. */
  dias_restantes: number | null;
  suspendido_sin_fin: boolean;
}

export interface PlazoDetalle extends PlazoListado {
  tipo_plazo_id: string | null;
  observaciones: string | null;
  creado_en: string;
  actualizado_en: string;
}

export interface SuspensionPlazo {
  id: string;
  fecha_desde: string;
  fecha_hasta: string | null;
  motivo: string;
  registrado_por: string | null;
}

/** Un día del cómputo: contó, o no contó y por qué. */
export interface DiaDelComputo {
  fecha: string;
  salteadoPor?: 'FIN_DE_SEMANA' | 'INHABIL' | 'SUSPENDIDO';
  detalle?: string;
  numero?: number;
}

export interface ExplicacionComputo {
  explicacion: string[];
  dias: DiaDelComputo[];
  fecha_vencimiento_calculada: string;
  coincide_con_lo_guardado: boolean;
}

export interface DetallePlazo {
  plazo: PlazoDetalle;
  suspensiones: SuspensionPlazo[];
  computo: ExplicacionComputo | null;
  error_computo?: string;
}

/** Previsualización: lo que devuelve simular antes de guardar. */
export interface SimulacionPlazo {
  fecha_inicio_computo: string;
  fecha_vencimiento: string;
  explicacion: string[];
  dias: DiaDelComputo[];
  corrido_por_inhabil: boolean;
}

export interface DocumentoCausa {
  id: string;
  nombre_original: string;
  tipo_documento: string | null;
  mime_type: string;
  tamano_bytes: string;
  estado_extraccion: string;
  descripcion: string | null;
  fecha_subida: string;
  subido_por: string | null;
}

export interface TareaCausa {
  id: string;
  titulo: string;
  descripcion: string | null;
  estado: string;
  prioridad: string;
  fecha_vencimiento: string | null;
  asignada_a: string | null;
  causa_id: string | null;
  caratula: string | null;
  numero_expediente: string | null;
}

/* --- Panel ----------------------------------------------------------------- */

export interface IndicadoresPanel {
  causas_activas: number;
  plazos_por_vencer: number;
  plazos_vencidos: number;
  tareas_abiertas: number;
  mis_tareas_abiertas: number;
  audiencias_proximas: number;
}

export interface PlazoProximo {
  id: string;
  causa_id: string;
  caratula: string;
  numero_expediente: string | null;
  descripcion: string;
  tipo_plazo: string | null;
  fecha_vencimiento: string;
  dias_restantes: number;
  estado: string;
  responsable: string | null;
}

export interface TareaPanel {
  id: string;
  titulo: string;
  estado: string;
  prioridad: string;
  fecha_vencimiento: string | null;
  causa_id: string | null;
  caratula: string | null;
  numero_expediente: string | null;
  asignada_a: string | null;
  es_mia: boolean;
}

export interface EventoPanel {
  id: string;
  titulo: string;
  tipo: string;
  fecha_inicio: string;
  todo_el_dia: boolean;
  lugar: string | null;
  causa_id: string | null;
  caratula: string | null;
}

export interface ActividadPanel {
  id: string;
  causa_id: string;
  caratula: string;
  numero_expediente: string | null;
  fecha: string;
  tipo: string | null;
  descripcion: string;
  registrado_por: string | null;
}

export interface CausaReciente {
  id: string;
  caratula: string;
  numero_expediente: string | null;
  estado: string;
  es_final: boolean;
  fuero: string;
  actualizado_en: string;
}

export interface Panel {
  indicadores: IndicadoresPanel;
  plazosProximos: PlazoProximo[];
  tareas: TareaPanel[];
  eventos: EventoPanel[];
  actividad: ActividadPanel[];
  causasRecientes: CausaReciente[];
  finanzas?: { saldo_pendiente: string; costas_pendientes: number };
  diasHorizonte: number;
}

/* --- Catálogos ------------------------------------------------------------- */

export interface OpcionCatalogo {
  id: string;
  nombre: string;
  codigo?: string;
  fuero_id?: string;
  es_final?: boolean;
}

export interface Catalogos {
  fueros: OpcionCatalogo[];
  estados: OpcionCatalogo[];
  tribunales: OpcionCatalogo[];
  tiposCausa: OpcionCatalogo[];
  tiposDocumento: OpcionCatalogo[];
  profesionales: OpcionCatalogo[];
  tiposPlazo: OpcionTipoPlazo[];
  conceptosCosta: OpcionCatalogo[];
}

/** Regla de plazo del catálogo: el formulario precarga sus valores. */
export interface OpcionTipoPlazo extends OpcionCatalogo {
  cantidad_dias: number;
  computo: string;
  articulo_referencia: string | null;
  prorrogable: boolean;
}

/* --- Personas -------------------------------------------------------------- */

export interface PersonaListada {
  id: string;
  nombre_completo: string;
  tipo_persona: string;
  documento: string | null;
  cuit_cuil: string | null;
  email: string | null;
  telefono: string | null;
  localidad: string | null;
  cantidad_causas: number;
  es_cliente: boolean;
}

export interface PersonaDetalle extends PersonaListada {
  nombre: string | null;
  apellido: string | null;
  razon_social: string | null;
  tipo_documento: string | null;
  numero_documento: string | null;
  domicilio: string | null;
  provincia: string | null;
  observaciones: string | null;
  creado_en: string;
}

export interface CausaDePersona {
  causa_id: string;
  caratula: string;
  numero_expediente: string | null;
  estado: string;
  es_final: boolean;
  fuero: string;
  caracter: string;
  es_cliente: boolean;
  fecha_inicio: string;
}

export interface DetallePersona {
  persona: PersonaDetalle;
  causas: CausaDePersona[];
}

/* --- Diagnóstico ----------------------------------------------------------- */

export interface EstadoSalud {
  estado: string;
  entorno: string;
  base: 'conectada' | 'sin-conexion';
  detalleBase?: string;
  momento: string;
}

/* --- Tareas ---------------------------------------------------------------- */

export interface Tarea {
  id: string;
  titulo: string;
  descripcion: string | null;
  estado: 'PENDIENTE' | 'EN_CURSO' | 'COMPLETADA' | 'CANCELADA';
  prioridad: 'ALTA' | 'MEDIA' | 'BAJA';
  fecha_vencimiento: string | null;
  dias_restantes: number | null;
  causa_id: string | null;
  caratula: string | null;
  numero_expediente: string | null;
  plazo_id: string | null;
  plazo: string | null;
  asignada_a_id: string | null;
  asignada_a: string | null;
  creada_por: string | null;
  completada_en: string | null;
  creado_en: string;
}

/* --- Calendario ------------------------------------------------------------ */

export interface DiaInhabil {
  id: string;
  fecha: string;
  tipo: string;
  motivo: string;
  /** ISO: 1 = lunes … 7 = domingo. */
  dia_semana: number;
}

export interface CalendarioInhabiles {
  datos: DiaInhabil[];
  anios: { anio: number; cantidad: number }[];
}

/* --- Alertas y notificaciones ---------------------------------------------- */

export type NivelAlerta = 'CRITICA' | 'IMPORTANTE' | 'INFORMATIVA';

export interface AlertaVigente {
  plazo_id: string;
  causa_id: string;
  caratula: string;
  numero_expediente: string | null;
  descripcion: string;
  fecha_vencimiento: string;
  responsable_id: string | null;
  responsable: string | null;
  habiles_restantes: number;
  nivel: NivelAlerta;
  mensaje: string;
}

export interface Alertas {
  datos: AlertaVigente[];
  resumen: Record<NivelAlerta, number>;
}

export interface Notificacion {
  id: string;
  titulo: string;
  mensaje: string;
  nivel: NivelAlerta | null;
  causa_id: string | null;
  /** Aviso de un evento de agenda: la campana abre su detalle. */
  evento_id: string | null;
  leida_en: string | null;
  creado_en: string;
}

export interface Bandeja {
  datos: Notificacion[];
  no_leidas: number;
}

/* --- Usuarios -------------------------------------------------------------- */

export interface Integrante {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  matricula: string | null;
  telefono: string | null;
  rol: 'ADMIN' | 'JEFE_ESTUDIO' | 'EMPLEADO';
  rol_nombre: string;
  activo: boolean;
  ultimo_acceso_en: string | null;
  creado_en: string;
}

export interface Rol {
  codigo: string;
  nombre: string;
  descripcion: string | null;
}

/* --- Costas ---------------------------------------------------------------- */

export interface Costa {
  costa_id: string;
  causa_id: string;
  numero_expediente: string | null;
  caratula: string;
  concepto_costa_id: string;
  concepto: string;
  descripcion: string | null;
  monto: string;
  moneda: string;
  fecha_devengamiento: string;
  fecha_vencimiento_pago: string | null;
  a_cargo_de: 'ESTUDIO' | 'CLIENTE' | 'CONTRARIA';
  estado_cobro: 'PENDIENTE' | 'PARCIAL' | 'COBRADO' | 'INCOBRABLE';
  comprobante: string | null;
  total_cobrado: string;
  saldo_pendiente: string;
}

export interface PaginaCostas extends Pagina<Costa> {
  totales: { monto: string; cobrado: string; saldo: string };
}

export interface Cobro {
  id: string;
  monto: string;
  fecha: string;
  medio_pago: string;
  comprobante: string | null;
  observaciones: string | null;
  registrado_por: string | null;
}

/* --- Documentos ------------------------------------------------------------ */

export interface ResultadoBusquedaDocumento {
  id: string;
  causa_id: string;
  caratula: string;
  numero_expediente: string | null;
  nombre_original: string;
  fragmento: string;
}

export interface TextoDocumento {
  estado: string;
  texto: string | null;
  cantidad_paginas?: number | null;
  mensaje_error?: string | null;
}

/* --- Auditoría ------------------------------------------------------------- */

export interface EventoAuditoria {
  id: string;
  fecha: string;
  entidad: string;
  entidad_id: string | null;
  accion: string;
  datos_antes: unknown;
  datos_despues: unknown;
  ip: string | null;
  usuario: string | null;
}

export interface PaginaAuditoria extends Pagina<EventoAuditoria> {
  entidades: string[];
}

/* --- Agenda jurídica -------------------------------------------------------- */

export type TipoEvento = 'AUDIENCIA' | 'MEDIACION' | 'REUNION' | 'VENCIMIENTO' | 'OTRO';
export type TipoAgenda = TipoEvento | 'PLAZO' | 'TAREA' | 'INHABIL';
export type EstadoEvento = 'PENDIENTE' | 'CONFIRMADO' | 'COMPLETADO' | 'CANCELADO';
export type VisibilidadEvento = 'PERSONAL' | 'PARTICIPANTES' | 'ESTUDIO';
export type PrioridadEvento = 'ALTA' | 'MEDIA' | 'BAJA';

/** Elemento de la agenda, venga de donde venga. Las horas son de pared del estudio. */
export interface ItemAgenda {
  clave: string;
  origen: 'EVENTO' | 'PLAZO' | 'TAREA' | 'DIA_INHABIL';
  id: string;
  tipo: TipoAgenda;
  titulo: string;
  /** `YYYY-MM-DDTHH:mm` con hora; `YYYY-MM-DD` si es de día completo. */
  inicio: string;
  fin: string;
  todo_el_dia: boolean;
  estado: string;
  prioridad: string | null;
  responsable_id: string | null;
  responsable: string | null;
  causa_id: string | null;
  caratula: string | null;
  numero_expediente: string | null;
  lugar: string | null;
  nivel: NivelAlerta | null;
  ruta: string;
  editable: boolean;
}

export interface RespuestaAgenda {
  desde: string;
  hasta: string;
  /** Hoy y ahora en la zona del estudio (no la del navegador). */
  hoy: string;
  ahora: string;
  zona: string;
  datos: ItemAgenda[];
}

export interface EventoAgenda {
  id: string;
  titulo: string;
  tipo: TipoEvento;
  descripcion: string | null;
  prioridad: PrioridadEvento;
  estado: EstadoEvento;
  visibilidad: VisibilidadEvento;
  todo_el_dia: boolean;
  fecha_inicio: string;
  hora_inicio: string;
  fecha_fin: string;
  hora_fin: string;
  lugar: string | null;
  enlace_virtual: string | null;
  observaciones: string | null;
  causa_id: string | null;
  caratula: string | null;
  numero_expediente: string | null;
  persona_id: string | null;
  persona: string | null;
  responsable_id: string | null;
  responsable: string | null;
  creado_por_id: string | null;
  creado_por: string | null;
  creado_en: string;
  actualizado_en: string;
  actualizado_por: string | null;
  cancelado_en: string | null;
  motivo_cancelacion: string | null;
  completado_en: string | null;
  version: number;
  participantes: { id: string; nombre: string }[];
  recordatorios: number[];
  puede_editar: boolean;
  puede_cancelar: boolean;
}

export interface DatosEvento {
  titulo: string;
  tipo: TipoEvento;
  descripcion?: string;
  prioridad: PrioridadEvento;
  todo_el_dia: boolean;
  fecha_inicio: string;
  hora_inicio?: string;
  fecha_fin?: string;
  hora_fin?: string;
  causa_id?: string;
  persona_id?: string;
  responsable_id?: string;
  participantes: string[];
  lugar?: string;
  enlace_virtual?: string;
  observaciones?: string;
  visibilidad: VisibilidadEvento;
  recordatorios: number[];
}

export interface ConflictoHorario {
  id: string;
  titulo: string;
  inicio: string;
  fin: string;
}

export interface Conflictos {
  conflictos: ConflictoHorario[];
  ocultos: number;
}

export interface EntradaHistorialEvento {
  id: string;
  accion: 'CREADO' | 'EDITADO' | 'REPROGRAMADO' | 'CONFIRMADO' | 'COMPLETADO' | 'CANCELADO' | 'REABIERTO';
  detalle: {
    antes?: { inicio: string; fin: string; todo_el_dia: boolean };
    despues?: { inicio: string; fin: string; todo_el_dia: boolean };
    campos?: string[];
    estado_anterior?: string;
    estado?: string;
  };
  motivo: string | null;
  usuario: string | null;
  creado_en: string;
}

/* --- Notificaciones ---------------------------------------------------------- */

export interface PreferenciasNotificacion {
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

export interface RespuestaPreferencias {
  preferencias: PreferenciasNotificacion;
  correo_del_estudio: 'activo' | 'inactivo';
}

export interface EjecucionProgramador {
  iniciado_en: string;
  finalizado_en: string | null;
  origen: 'PROGRAMADOR' | 'MANUAL';
  procesados: number;
  aceptados: number;
  fallidos?: number;
  cancelados?: number;
  error?: string | null;
}

export interface EnvioFallido {
  id: string;
  tipo: string;
  canal: 'IN_APP' | 'EMAIL';
  intentos: number;
  ultimo_error: string | null;
  creado_en: string;
  procesado_en: string | null;
  destinatario: string;
}

export interface EstadoNotificaciones {
  correo: {
    modo: 'deshabilitado' | 'simulado' | 'real';
    modo_pedido: 'deshabilitado' | 'simulado' | 'real';
    proveedor: string;
    remitente_configurado: boolean;
    app_url_configurada: boolean;
    faltantes: string[];
  };
  programador: {
    configurado: boolean;
    ultima_ejecucion: EjecucionProgramador | null;
    ultima_exitosa: EjecucionProgramador | null;
    atrasado: boolean;
    minutos_atraso: number;
  };
  cola: {
    por_estado: { estado: string; canal: string; total: number }[];
    vencidos_sin_procesar: number;
  };
  fallidos: EnvioFallido[];
  zona_horaria: string;
}

export interface VistaPreviaCorreo {
  plantilla: string;
  asunto: string;
  html: string;
  texto: string;
}
