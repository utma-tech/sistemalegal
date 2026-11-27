import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, consulta } from './api';
import { claves } from './consultas';
import type {
  Conflictos,
  DatosEvento,
  EntradaHistorialEvento,
  EstadoEvento,
  EstadoNotificaciones,
  EventoAgenda,
  PreferenciasNotificacion,
  RespuestaAgenda,
  RespuestaPreferencias,
  VistaPreviaCorreo,
} from '../tipos/api';

/**
 * Acceso a datos de la agenda jurídica y de las notificaciones.
 *
 * Misma regla que el resto de `servicios/`: ninguna pantalla llama a fetch por
 * su cuenta. La agenda se pide por rango (lo que se ve en pantalla) y la caché
 * se indexa por rango + filtros, así ir y volver de un mes no vuelve a pedirlo.
 */

export const clavesAgenda = {
  todo: ['agenda'] as const,
  rango: (filtros: FiltrosAgenda) => ['agenda', 'rango', filtros] as const,
  evento: (id: string) => ['agenda', 'evento', id] as const,
  historial: (id: string) => ['agenda', 'evento', id, 'historial'] as const,
  conflictos: (datos: ConsultaConflictos) => ['agenda', 'conflictos', datos] as const,
  recordatorios: ['agenda', 'recordatorios'] as const,
  preferencias: ['cuenta', 'notificaciones'] as const,
  administracion: ['notificaciones', 'administracion'] as const,
  vistaPrevia: (plantilla: string) => ['notificaciones', 'administracion', 'plantilla', plantilla] as const,
};

export interface FiltrosAgenda {
  desde: string;
  hasta: string;
  tipos?: string;
  responsable?: string;
  causa?: string;
  estado?: string;
  prioridad?: string;
  alcance?: 'estudio' | 'mios';
  completados?: boolean;
  cancelados?: boolean;
}

export function useAgenda(filtros: FiltrosAgenda, habilitada = true) {
  return useQuery({
    queryKey: clavesAgenda.rango(filtros),
    queryFn: () =>
      api.obtener<RespuestaAgenda>(
        `/api/agenda${consulta({
          ...filtros,
          completados: filtros.completados ? 'true' : undefined,
          cancelados: filtros.cancelados ? 'true' : undefined,
        })}`,
      ),
    // Al cambiar de mes se sigue viendo el anterior hasta que llega el nuevo:
    // la grilla no parpadea vacía.
    placeholderData: keepPreviousData,
    enabled: habilitada,
  });
}

export function useEvento(id: string | null) {
  return useQuery({
    queryKey: clavesAgenda.evento(id ?? ''),
    queryFn: () => api.obtener<{ evento: EventoAgenda }>(`/api/agenda/eventos/${id}`).then((r) => r.evento),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useHistorialEvento(id: string, habilitada: boolean) {
  return useQuery({
    queryKey: clavesAgenda.historial(id),
    queryFn: () =>
      api.obtener<{ datos: EntradaHistorialEvento[] }>(`/api/agenda/eventos/${id}/historial`).then((r) => r.datos),
    enabled: habilitada,
  });
}

export function useRecordatoriosPredeterminados() {
  return useQuery({
    queryKey: clavesAgenda.recordatorios,
    queryFn: () => api.obtener<{ porTipo: Record<string, number[]> }>('/api/agenda/recordatorios').then((r) => r.porTipo),
    staleTime: 10 * 60_000,
  });
}

export interface ConsultaConflictos {
  fecha_inicio: string;
  hora_inicio?: string;
  fecha_fin?: string;
  hora_fin?: string;
  responsable?: string;
  participantes?: string;
  excluir?: string;
}

export function useConflictos(datos: ConsultaConflictos | null) {
  return useQuery({
    queryKey: clavesAgenda.conflictos(datos ?? { fecha_inicio: '' }),
    queryFn: () => api.obtener<Conflictos>(`/api/agenda/conflictos${consulta({ ...datos })}`),
    enabled: Boolean(datos?.fecha_inicio && datos.hora_inicio),
    staleTime: 30_000,
  });
}

/** Tras escribir un evento cambian la agenda, el panel de inicio y, si cuelga de uno, el expediente. */
function useRefrescarAgenda() {
  const cliente = useQueryClient();
  return (causaId?: string | null) => {
    void cliente.invalidateQueries({ queryKey: clavesAgenda.todo });
    void cliente.invalidateQueries({ queryKey: claves.panel });
    void cliente.invalidateQueries({ queryKey: ['notificaciones'] });
    if (causaId) void cliente.invalidateQueries({ queryKey: claves.causa(causaId) });
  };
}

export interface RespuestaGuardado extends Conflictos {
  evento: EventoAgenda;
}

export function useGuardarEvento(id?: string) {
  const refrescar = useRefrescarAgenda();
  return useMutation({
    mutationFn: (datos: DatosEvento) =>
      id
        ? api.reemplazar<RespuestaGuardado>(`/api/agenda/eventos/${id}`, datos)
        : api.enviar<RespuestaGuardado>('/api/agenda/eventos', datos),
    onSuccess: (respuesta) => refrescar(respuesta.evento.causa_id),
  });
}

export function useCambiarEstadoEvento(id: string) {
  const refrescar = useRefrescarAgenda();
  return useMutation({
    mutationFn: (datos: { estado: EstadoEvento; motivo?: string }) =>
      api.parchear<{ evento: EventoAgenda }>(`/api/agenda/eventos/${id}/estado`, datos).then((r) => r.evento),
    onSuccess: (evento) => refrescar(evento.causa_id),
  });
}

/* --- Preferencias ------------------------------------------------------------ */

export function usePreferencias() {
  return useQuery({
    queryKey: clavesAgenda.preferencias,
    queryFn: () => api.obtener<RespuestaPreferencias>('/api/cuenta/notificaciones'),
  });
}

export function useGuardarPreferencias() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (datos: PreferenciasNotificacion) =>
      api.reemplazar<{ preferencias: PreferenciasNotificacion }>('/api/cuenta/notificaciones', datos),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: clavesAgenda.preferencias }),
  });
}

/* --- Administración ------------------------------------------------------------ */

export function useEstadoNotificaciones() {
  return useQuery({
    queryKey: clavesAgenda.administracion,
    queryFn: () => api.obtener<EstadoNotificaciones>('/api/notificaciones/administracion'),
    refetchInterval: 60_000,
  });
}

export function useVistaPreviaCorreo(plantilla: string) {
  return useQuery({
    queryKey: clavesAgenda.vistaPrevia(plantilla),
    queryFn: () => api.obtener<VistaPreviaCorreo>(`/api/notificaciones/administracion/plantillas/${plantilla}`),
    staleTime: Infinity,
  });
}

export function useProcesarAhora() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.enviar<{ resumen: { procesados: number; aceptados: number; fallidos: number; cancelados: number } }>(
        '/api/notificaciones/administracion/procesar',
        {},
      ),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['notificaciones'] }),
  });
}

export function useCorreoDePrueba() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.enviar<{ estado: string; error: string | null; destinatario: string }>(
        '/api/notificaciones/administracion/prueba',
        {},
      ),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: clavesAgenda.administracion }),
  });
}

export function useReintentarEnvio() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.enviar<{ reintentado: boolean }>(`/api/notificaciones/administracion/envios/${id}/reintentar`, {}),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: clavesAgenda.administracion }),
  });
}
