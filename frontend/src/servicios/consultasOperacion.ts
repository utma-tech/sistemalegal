import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, consulta } from './api';
import { claves } from './consultas';
import type {
  Alertas,
  Bandeja,
  CalendarioInhabiles,
  Cobro,
  Costa,
  DiaInhabil,
  Integrante,
  PaginaAuditoria,
  Pagina,
  PaginaCostas,
  ResultadoBusquedaDocumento,
  Rol,
  Tarea,
  TextoDocumento,
} from '../tipos/api';

/**
 * Acceso a datos de los módulos de operación: tareas, calendario, alertas,
 * usuarios, costas, documentos y auditoría.
 *
 * Es la continuación de `consultas.ts` —mismas reglas: ninguna pantalla llama
 * a fetch por su cuenta— en un archivo aparte para que ninguno de los dos se
 * vuelva inmanejable. Las claves de caché propias cuelgan de `clavesOperacion`
 * y las compartidas (expediente, panel) se importan de `claves`.
 */

export const clavesOperacion = {
  tareas: ['tareas'] as const,
  listaTareas: (filtros: FiltrosTarea) => ['tareas', 'lista', filtros] as const,
  inhabiles: (anio: number) => ['calendario', 'inhabiles', anio] as const,
  alertas: (alcance: string) => ['alertas', alcance] as const,
  bandeja: ['notificaciones'] as const,
  usuarios: ['usuarios'] as const,
  roles: ['usuarios', 'roles'] as const,
  costas: ['costas'] as const,
  listaCostas: (filtros: FiltrosCosta) => ['costas', 'lista', filtros] as const,
  costa: (id: string) => ['costas', 'detalle', id] as const,
  documentos: (causaId: string) => ['causas', 'detalle', causaId, 'documentos'] as const,
  busquedaDocumentos: (q: string) => ['documentos', 'busqueda', q] as const,
  textoDocumento: (id: string) => ['documentos', 'texto', id] as const,
  auditoria: (filtros: FiltrosAuditoria) => ['auditoria', filtros] as const,
};

/** Lo que cambia en un expediente cuando se escribe algo que cuelga de él. */
function refrescarExpediente(cliente: QueryClient, causaId?: string | null) {
  void cliente.invalidateQueries({ queryKey: claves.panel });
  if (causaId) void cliente.invalidateQueries({ queryKey: claves.causa(causaId) });
}

/* --- Tareas ---------------------------------------------------------------- */

export interface FiltrosTarea {
  pagina: number;
  tamano: number;
  estado?: string;
  asignada?: string;
  causa?: string;
  prioridad?: string;
  busqueda?: string;
  vigencia: 'todas' | 'abiertas' | 'cerradas';
}

export interface DatosTarea {
  titulo: string;
  descripcion?: string;
  causa_id?: string;
  plazo_id?: string;
  asignada_a?: string;
  prioridad: 'ALTA' | 'MEDIA' | 'BAJA';
  fecha_vencimiento?: string;
}

export function useTareas(filtros: FiltrosTarea) {
  return useQuery({
    queryKey: clavesOperacion.listaTareas(filtros),
    queryFn: () => api.obtener<Pagina<Tarea>>(`/api/tareas${consulta({ ...filtros })}`),
    placeholderData: (previo) => previo,
  });
}

function useRefrescarTareas() {
  const cliente = useQueryClient();
  return (causaId?: string | null) => {
    void cliente.invalidateQueries({ queryKey: clavesOperacion.tareas });
    // La pestaña Tareas del expediente lee su propia consulta.
    void cliente.invalidateQueries({ queryKey: claves.causas });
    refrescarExpediente(cliente, causaId);
  };
}

export function useGuardarTarea(id?: string) {
  const refrescar = useRefrescarTareas();
  return useMutation({
    mutationFn: (datos: DatosTarea) =>
      (id
        ? api.reemplazar<{ tarea: Tarea }>(`/api/tareas/${id}`, datos)
        : api.enviar<{ tarea: Tarea }>('/api/tareas', datos)
      ).then((r) => r.tarea),
    onSuccess: (tarea) => refrescar(tarea.causa_id),
  });
}

export function useCambiarEstadoTarea() {
  const refrescar = useRefrescarTareas();
  return useMutation({
    mutationFn: ({ id, estado }: { id: string; estado: Tarea['estado'] }) =>
      api.enviar<{ tarea: Tarea }>(`/api/tareas/${id}/estado`, { estado }).then((r) => r.tarea),
    onSuccess: (tarea) => refrescar(tarea.causa_id),
  });
}

export function useEliminarTarea() {
  const refrescar = useRefrescarTareas();
  return useMutation({
    mutationFn: (id: string) => api.eliminar<{ tarea: Tarea }>(`/api/tareas/${id}`).then((r) => r.tarea),
    onSuccess: (tarea) => refrescar(tarea.causa_id),
  });
}

/* --- Calendario de días inhábiles ------------------------------------------ */

export function useInhabiles(anio: number) {
  return useQuery({
    queryKey: clavesOperacion.inhabiles(anio),
    queryFn: () => api.obtener<CalendarioInhabiles>(`/api/calendario/inhabiles?anio=${anio}`),
    placeholderData: (previo) => previo,
  });
}

export interface DatosInhabil {
  fecha_desde: string;
  fecha_hasta?: string;
  tipo: string;
  motivo: string;
  omitir_fines_de_semana?: boolean;
}

function useRefrescarCalendario() {
  const cliente = useQueryClient();
  // El calendario cambia los vencimientos que se ven en todas partes.
  return () => {
    void cliente.invalidateQueries({ queryKey: ['calendario'] });
    void cliente.invalidateQueries({ queryKey: claves.plazos });
    void cliente.invalidateQueries({ queryKey: ['alertas'] });
  };
}

export function useAgregarInhabiles() {
  const refrescar = useRefrescarCalendario();
  return useMutation({
    mutationFn: (datos: DatosInhabil) =>
      api.enviar<{ creados: DiaInhabil[]; omitidos: number }>('/api/calendario/inhabiles', datos),
    onSuccess: refrescar,
  });
}

export function useCopiarInhabiles() {
  const refrescar = useRefrescarCalendario();
  return useMutation({
    mutationFn: (datos: { anio_origen: number; anio_destino: number; tipos: string[] }) =>
      api.enviar<{ creados: DiaInhabil[] }>('/api/calendario/inhabiles/copiar', datos),
    onSuccess: refrescar,
  });
}

export function useEditarInhabil() {
  const refrescar = useRefrescarCalendario();
  return useMutation({
    mutationFn: ({ id, ...datos }: { id: string; tipo: string; motivo: string }) =>
      api.reemplazar<{ dia: DiaInhabil }>(`/api/calendario/inhabiles/${id}`, datos),
    onSuccess: refrescar,
  });
}

export function useEliminarInhabil() {
  const refrescar = useRefrescarCalendario();
  return useMutation({
    mutationFn: (id: string) => api.eliminar<{ dia: DiaInhabil }>(`/api/calendario/inhabiles/${id}`),
    onSuccess: refrescar,
  });
}

/* --- Alertas y notificaciones ---------------------------------------------- */

export function useAlertas(alcance: 'todas' | 'mias', habilitada = true) {
  return useQuery({
    queryKey: clavesOperacion.alertas(alcance),
    queryFn: () => api.obtener<Alertas>(`/api/alertas?alcance=${alcance}`),
    enabled: habilitada,
  });
}

/** La bandeja se refresca sola cada cinco minutos, que es lo que tarda el backend en reevaluar. */
export function useBandeja() {
  return useQuery({
    queryKey: clavesOperacion.bandeja,
    queryFn: () => api.obtener<Bandeja>('/api/notificaciones'),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60_000,
  });
}

export function useMarcarLeida() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (id: string | 'todas') =>
      id === 'todas'
        ? api.enviar('/api/notificaciones/leer-todas', {})
        : api.enviar(`/api/notificaciones/${id}/leer`, {}),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: clavesOperacion.bandeja }),
  });
}

/* --- Usuarios -------------------------------------------------------------- */

export function useUsuarios() {
  return useQuery({
    queryKey: clavesOperacion.usuarios,
    queryFn: () => api.obtener<{ datos: Integrante[] }>('/api/usuarios').then((r) => r.datos),
  });
}

export function useRoles() {
  return useQuery({
    queryKey: clavesOperacion.roles,
    queryFn: () => api.obtener<{ datos: Rol[] }>('/api/usuarios/roles').then((r) => r.datos),
    staleTime: 60 * 60 * 1000,
  });
}

export interface DatosIntegrante {
  nombre: string;
  apellido: string;
  matricula?: string;
  telefono?: string;
  rol: Integrante['rol'];
  email?: string;
  password?: string;
  activo?: boolean;
}

export function useGuardarIntegrante(id?: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (datos: DatosIntegrante) =>
      (id
        ? api.reemplazar<{ usuario: Integrante }>(`/api/usuarios/${id}`, datos)
        : api.enviar<{ usuario: Integrante }>('/api/usuarios', datos)
      ).then((r) => r.usuario),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: clavesOperacion.usuarios });
      // La nómina alimenta los desplegables de responsable.
      void cliente.invalidateQueries({ queryKey: claves.catalogos });
    },
  });
}

export function useRestablecerPassword() {
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api.enviar(`/api/usuarios/${id}/password`, { password }),
  });
}

export function useCambiarMiPassword() {
  return useMutation({
    mutationFn: (datos: { actual: string; nueva: string }) => api.enviar('/api/cuenta/password', datos),
  });
}

/* --- Costas ---------------------------------------------------------------- */

export interface FiltrosCosta {
  pagina: number;
  tamano: number;
  causa?: string;
  estado?: string;
  a_cargo_de?: string;
  desde?: string;
  hasta?: string;
  vigencia: 'todas' | 'pendientes';
}

export interface DatosCosta {
  concepto_costa_id: string;
  descripcion?: string;
  monto: string;
  fecha_devengamiento: string;
  fecha_vencimiento_pago?: string;
  a_cargo_de: Costa['a_cargo_de'];
  comprobante?: string;
}

export interface DatosCobro {
  monto: string;
  fecha: string;
  medio_pago: string;
  comprobante?: string;
  observaciones?: string;
}

export function useCostas(filtros: FiltrosCosta) {
  return useQuery({
    queryKey: clavesOperacion.listaCostas(filtros),
    queryFn: () => api.obtener<PaginaCostas>(`/api/costas${consulta({ ...filtros })}`),
    placeholderData: (previo) => previo,
  });
}

export function useCosta(id: string | undefined) {
  return useQuery({
    queryKey: clavesOperacion.costa(id ?? ''),
    queryFn: () => api.obtener<{ costa: Costa; cobros: Cobro[] }>(`/api/costas/${id}`),
    enabled: Boolean(id),
  });
}

function useRefrescarCostas() {
  const cliente = useQueryClient();
  return (causaId?: string) => {
    void cliente.invalidateQueries({ queryKey: clavesOperacion.costas });
    refrescarExpediente(cliente, causaId);
  };
}

export function useGuardarCosta(causaId: string, id?: string) {
  const refrescar = useRefrescarCostas();
  return useMutation({
    mutationFn: (datos: DatosCosta) =>
      (id
        ? api.reemplazar<{ costa: Costa }>(`/api/costas/${id}`, datos)
        : api.enviar<{ costa: Costa }>(`/api/causas/${causaId}/costas`, datos)
      ).then((r) => r.costa),
    onSuccess: () => refrescar(causaId),
  });
}

export function useRegistrarCobro(costa: Costa) {
  const refrescar = useRefrescarCostas();
  return useMutation({
    mutationFn: (datos: DatosCobro) => api.enviar(`/api/costas/${costa.costa_id}/cobros`, datos),
    onSuccess: () => refrescar(costa.causa_id),
  });
}

export function useQuitarCobro(costa: Costa) {
  const refrescar = useRefrescarCostas();
  return useMutation({
    mutationFn: (cobroId: string) => api.eliminar(`/api/costas/${costa.costa_id}/cobros/${cobroId}`),
    onSuccess: () => refrescar(costa.causa_id),
  });
}

export function useMarcarIncobrable(costa: Costa) {
  const refrescar = useRefrescarCostas();
  return useMutation({
    mutationFn: (incobrable: boolean) => api.enviar(`/api/costas/${costa.costa_id}/incobrable`, { incobrable }),
    onSuccess: () => refrescar(costa.causa_id),
  });
}

export function useEliminarCosta() {
  const refrescar = useRefrescarCostas();
  return useMutation({
    mutationFn: (costa: Costa) => api.eliminar(`/api/costas/${costa.costa_id}`).then(() => costa),
    onSuccess: (costa) => refrescar(costa.causa_id),
  });
}

/* --- Documentos ------------------------------------------------------------ */

export function useSubirDocumento(causaId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ archivo, tipoDocumentoId, descripcion }: { archivo: File; tipoDocumentoId?: string; descripcion?: string }) =>
      api.subir(
        `/api/causas/${causaId}/documentos${consulta({
          nombre: archivo.name,
          tipo_documento_id: tipoDocumentoId,
          descripcion,
        })}`,
        archivo,
      ),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: clavesOperacion.documentos(causaId) });
      refrescarExpediente(cliente, causaId);
    },
  });
}

export function useEliminarDocumento(causaId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.eliminar(`/api/documentos/${id}`),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: clavesOperacion.documentos(causaId) });
      refrescarExpediente(cliente, causaId);
    },
  });
}

export function useReintentarExtraccion(causaId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.enviar<{ estado: string }>(`/api/documentos/${id}/extraer`, {}),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: clavesOperacion.documentos(causaId) }),
  });
}

export function useTextoDocumento(id: string | undefined) {
  return useQuery({
    queryKey: clavesOperacion.textoDocumento(id ?? ''),
    queryFn: () => api.obtener<TextoDocumento>(`/api/documentos/${id}/texto`),
    enabled: Boolean(id),
  });
}

export function useBuscarDocumentos(q: string) {
  return useQuery({
    queryKey: clavesOperacion.busquedaDocumentos(q),
    queryFn: () =>
      api
        .obtener<{ datos: ResultadoBusquedaDocumento[] }>(`/api/documentos/buscar${consulta({ q })}`)
        .then((r) => r.datos),
    enabled: q.trim().length >= 2,
  });
}

/** Descarga un archivo con la sesión y lo entrega al navegador con su nombre. */
export async function descargarArchivo(ruta: string, nombre: string): Promise<void> {
  const blob = await api.descargar(ruta);
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* --- Auditoría ------------------------------------------------------------- */

export interface FiltrosAuditoria {
  pagina: number;
  tamano: number;
  entidad?: string;
  accion?: string;
  usuario?: string;
  desde?: string;
  hasta?: string;
}

export function useAuditoria(filtros: FiltrosAuditoria) {
  return useQuery({
    queryKey: clavesOperacion.auditoria(filtros),
    queryFn: () => api.obtener<PaginaAuditoria>(`/api/auditoria${consulta({ ...filtros })}`),
    placeholderData: (previo) => previo,
  });
}
