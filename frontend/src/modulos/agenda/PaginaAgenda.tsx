import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, FilterX, PanelRightClose, PanelRightOpen, Plus, SlidersHorizontal } from 'lucide-react';
import { useAgenda, type FiltrosAgenda } from '../../servicios/consultasAgenda';
import { useCatalogos } from '../../servicios/consultas';
import type { EventoAgenda, ItemAgenda } from '../../tipos/api';
import { useSesion } from '../auth/ContextoSesion';
import { CabeceraPagina } from '../../componentes/ui/CabeceraPagina';
import { Boton } from '../../componentes/ui/Boton';
import { FiltroSelect } from '../../componentes/ui/Campo';
import { ErrorCarga } from '../../componentes/ui/Estados';
import {
  VISTAS,
  etiquetaPeriodo,
  hoyLocal,
  inicioSemana,
  navegar,
  rangoVista,
  sumarDias,
  type Vista,
} from './calendario';
import { VistaHoraria, VistaListado, VistaMes } from './VistasCalendario';
import { PanelAgenda } from './PanelAgenda';
import { DialogoEvento } from './DialogoEvento';
import { ORDEN_TIPOS, TIPOS_AGENDA } from './vocabularioAgenda';

/**
 * Agenda jurídica: audiencias, mediaciones, reuniones y vencimientos del
 * estudio, junto con los plazos procesales y las tareas (que se leen de sus
 * módulos, no se copian).
 *
 * No confundir con el calendario judicial (Administración), que es donde se
 * cargan feriados, ferias y asuetos para el cómputo de plazos.
 *
 * Vista, fecha y filtros viven en la URL: "mis audiencias de esta semana" se
 * puede guardar como marcador, y los enlaces de los avisos (`?evento=<id>`)
 * abren directamente el detalle.
 */

const CLAVE_PANEL = 'agenda.panel';

function vistaInicial(): Vista {
  // En el celular la lista cronológica se lee mejor que una grilla de 7 columnas.
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches ? 'agenda' : 'mes';
}

const OPCIONES_TIPO = ORDEN_TIPOS.filter((t) => t !== 'INHABIL').map((t) => ({ valor: t, texto: TIPOS_AGENDA[t].texto }));
const OPCIONES_ESTADO = [
  { valor: 'PENDIENTE', texto: 'Pendientes' },
  { valor: 'CONFIRMADO', texto: 'Confirmados' },
  { valor: 'COMPLETADO', texto: 'Completados' },
  { valor: 'CANCELADO', texto: 'Cancelados' },
];
const OPCIONES_PRIORIDAD = [
  { valor: 'ALTA', texto: 'Prioridad alta' },
  { valor: 'MEDIA', texto: 'Prioridad media' },
  { valor: 'BAJA', texto: 'Prioridad baja' },
];

const FILTROS = ['tipo', 'responsable', 'estado', 'prioridad', 'alcance', 'completados', 'cancelados', 'causa'] as const;

export function PaginaAgenda() {
  const { puede } = useSesion();
  const [parametros, setParametros] = useSearchParams();
  const { data: catalogos } = useCatalogos();

  const vista = (VISTAS.some((v) => v.valor === parametros.get('vista')) ? parametros.get('vista') : vistaInicial()) as Vista;
  const fechaUrl = parametros.get('fecha');
  const [hoyEstudio, setHoyEstudio] = useState<string>();
  const fecha = fechaUrl && /^\d{4}-\d{2}-\d{2}$/.test(fechaUrl) ? fechaUrl : (hoyEstudio ?? hoyLocal());
  const eventoId = parametros.get('evento');
  const [seleccion, setSeleccion] = useState<ItemAgenda | null>(null);
  const [panelAbierto, setPanelAbierto] = useState(() => localStorage.getItem(CLAVE_PANEL) !== 'cerrado');
  const [filtrosVisibles, setFiltrosVisibles] = useState(false);
  const [dialogo, setDialogo] = useState<{ evento?: EventoAgenda; fecha?: string; hora?: string } | null>(null);

  const actualizar = useCallback(
    (cambios: Record<string, string | null>) => {
      setParametros(
        (previos) => {
          const siguientes = new URLSearchParams(previos);
          for (const [clave, valor] of Object.entries(cambios)) {
            if (valor === null || valor === '') siguientes.delete(clave);
            else siguientes.set(clave, valor);
          }
          return siguientes;
        },
        { replace: true },
      );
    },
    [setParametros],
  );

  const filtros: Omit<FiltrosAgenda, 'desde' | 'hasta'> = {
    tipos: parametros.get('tipo') ? `${parametros.get('tipo')}` : undefined,
    responsable: parametros.get('responsable') ?? undefined,
    causa: parametros.get('causa') ?? undefined,
    estado: parametros.get('estado') ?? undefined,
    prioridad: parametros.get('prioridad') ?? undefined,
    alcance: parametros.get('alcance') === 'mios' ? 'mios' : 'estudio',
    completados: parametros.get('completados') === '1',
    cancelados: parametros.get('cancelados') === '1',
  };
  const cantidadFiltros = FILTROS.filter((f) => parametros.get(f)).length;

  const rango = rangoVista(vista, fecha);
  const agenda = useAgenda({ ...rango, ...filtros });

  // Próximos compromisos del panel: siempre desde hoy, con los mismos filtros.
  const hoy = agenda.data?.hoy ?? hoyEstudio ?? hoyLocal();
  const proximos = useAgenda({ ...filtros, desde: hoy, hasta: sumarDias(hoy, 14), completados: false, cancelados: false }, panelAbierto);

  // El "hoy" que vale es el del estudio, que informa la API.
  useEffect(() => {
    if (agenda.data?.hoy && agenda.data.hoy !== hoyEstudio) setHoyEstudio(agenda.data.hoy);
  }, [agenda.data?.hoy, hoyEstudio]);

  // Un enlace con ?evento= abre el panel aunque el usuario lo hubiera cerrado.
  useEffect(() => {
    if (eventoId) setPanelAbierto(true);
  }, [eventoId]);

  useEffect(() => {
    localStorage.setItem(CLAVE_PANEL, panelAbierto ? 'abierto' : 'cerrado');
  }, [panelAbierto]);

  const items = useMemo(() => agenda.data?.datos ?? [], [agenda.data]);
  const claveElegida = eventoId ? `EVENTO:${eventoId}` : (seleccion?.clave ?? null);

  function seleccionar(item: ItemAgenda) {
    setPanelAbierto(true);
    if (item.origen === 'EVENTO') {
      setSeleccion(null);
      actualizar({ evento: item.id });
    } else {
      actualizar({ evento: null });
      setSeleccion(item);
    }
  }

  function cerrarSeleccion() {
    setSeleccion(null);
    actualizar({ evento: null });
  }

  const puedeCrear = puede('agenda.crear');
  const alCrear = puedeCrear ? (dia: string, hora?: string) => setDialogo({ fecha: dia, hora }) : undefined;
  const irADia = (dia: string) => actualizar({ vista: 'dia', fecha: dia });

  const diasSemana = useMemo(() => {
    const desde = inicioSemana(fecha);
    return Array.from({ length: 7 }, (_, i) => sumarDias(desde, i));
  }, [fecha]);

  const opcionesResponsables = (catalogos?.profesionales ?? []).map((p) => ({ valor: p.id, texto: p.nombre }));

  const propsVista = {
    items,
    hoy,
    seleccion: claveElegida,
    alSeleccionar: seleccionar,
    alCrear,
  };

  return (
    <div className="pagina-agenda">
      <CabeceraPagina
        titulo="Agenda jurídica"
        descripcion="Audiencias, mediaciones, reuniones y vencimientos del estudio, con los plazos y las tareas."
        acciones={
          puedeCrear ? (
            <Boton variante="primario" icono={<Plus size={16} />} onClick={() => setDialogo({ fecha: vista === 'mes' ? hoy : fecha })}>
              Nuevo evento
            </Boton>
          ) : undefined
        }
      />

      <div className="barra-agenda" role="toolbar" aria-label="Navegación de la agenda">
        <div className="barra-agenda__navegacion">
          <Boton
            variante="sutil"
            pequeno
            className="boton--icono"
            aria-label="Período anterior"
            onClick={() => actualizar({ fecha: navegar(vista, fecha, -1) })}
          >
            <ChevronLeft size={18} aria-hidden />
          </Boton>
          <Boton
            variante="sutil"
            pequeno
            className="boton--icono"
            aria-label="Período siguiente"
            onClick={() => actualizar({ fecha: navegar(vista, fecha, 1) })}
          >
            <ChevronRight size={18} aria-hidden />
          </Boton>
          <Boton pequeno onClick={() => actualizar({ fecha: null })} disabled={!fechaUrl}>
            Hoy
          </Boton>
          <h2 className="barra-agenda__periodo" aria-live="polite">
            {etiquetaPeriodo(vista, fecha)}
          </h2>
        </div>

        <div className="barra-agenda__acciones">
          <div className="segmentado" role="group" aria-label="Vista">
            {VISTAS.map((opcion) => (
              <button
                key={opcion.valor}
                type="button"
                className="segmentado__opcion"
                aria-pressed={vista === opcion.valor}
                onClick={() => actualizar({ vista: opcion.valor })}
              >
                {opcion.texto}
              </button>
            ))}
          </div>
          <Boton
            pequeno
            icono={<SlidersHorizontal size={15} />}
            aria-expanded={filtrosVisibles}
            aria-controls="filtros-agenda"
            onClick={() => setFiltrosVisibles((v) => !v)}
          >
            Filtros{cantidadFiltros ? ` · ${cantidadFiltros}` : ''}
          </Boton>
          <Boton
            variante="sutil"
            pequeno
            className="boton--icono barra-agenda__panel"
            aria-label={panelAbierto ? 'Ocultar panel lateral' : 'Mostrar panel lateral'}
            aria-pressed={panelAbierto}
            onClick={() => setPanelAbierto((v) => !v)}
          >
            {panelAbierto ? <PanelRightClose size={18} aria-hidden /> : <PanelRightOpen size={18} aria-hidden />}
          </Boton>
        </div>
      </div>

      {filtrosVisibles && (
        <div className="filtros-agenda" id="filtros-agenda">
          <div className="segmentado segmentado--pequeno" role="group" aria-label="Alcance">
            <button
              type="button"
              className="segmentado__opcion"
              aria-pressed={filtros.alcance !== 'mios'}
              onClick={() => actualizar({ alcance: null })}
            >
              Todo el estudio
            </button>
            <button
              type="button"
              className="segmentado__opcion"
              aria-pressed={filtros.alcance === 'mios'}
              onClick={() => actualizar({ alcance: 'mios' })}
            >
              Mis eventos
            </button>
          </div>
          <FiltroSelect
            etiqueta="Tipo"
            vacio="Todos los tipos"
            opciones={OPCIONES_TIPO}
            value={parametros.get('tipo') ?? ''}
            onChange={(e) => actualizar({ tipo: e.target.value })}
          />
          <FiltroSelect
            etiqueta="Responsable"
            vacio="Cualquier responsable"
            opciones={opcionesResponsables}
            value={parametros.get('responsable') ?? ''}
            onChange={(e) => actualizar({ responsable: e.target.value })}
          />
          <FiltroSelect
            etiqueta="Estado"
            vacio="Abiertos"
            opciones={OPCIONES_ESTADO}
            value={parametros.get('estado') ?? ''}
            onChange={(e) => actualizar({ estado: e.target.value })}
          />
          <FiltroSelect
            etiqueta="Prioridad"
            vacio="Cualquier prioridad"
            opciones={OPCIONES_PRIORIDAD}
            value={parametros.get('prioridad') ?? ''}
            onChange={(e) => actualizar({ prioridad: e.target.value })}
          />
          {!parametros.get('estado') && (
            <>
              <label className="filtros-agenda__casilla">
                <input
                  type="checkbox"
                  checked={filtros.completados}
                  onChange={(e) => actualizar({ completados: e.target.checked ? '1' : null })}
                />
                Completados
              </label>
              <label className="filtros-agenda__casilla">
                <input
                  type="checkbox"
                  checked={filtros.cancelados}
                  onChange={(e) => actualizar({ cancelados: e.target.checked ? '1' : null })}
                />
                Cancelados
              </label>
            </>
          )}
          {cantidadFiltros > 0 && (
            <Boton
              variante="sutil"
              pequeno
              icono={<FilterX size={15} />}
              onClick={() => actualizar(Object.fromEntries(FILTROS.map((f) => [f, null])))}
            >
              Limpiar filtros
            </Boton>
          )}
        </div>
      )}

      <div className={`agenda${panelAbierto ? '' : ' agenda--sin-panel'}`}>
        <section className={`calendario-agenda${agenda.isFetching ? ' calendario-agenda--cargando' : ''}`} aria-busy={agenda.isFetching}>
          {agenda.isError ? (
            <ErrorCarga error={agenda.error} reintentar={() => void agenda.refetch()} />
          ) : vista === 'mes' ? (
            <VistaMes {...propsVista} fecha={fecha} alVerDia={irADia} />
          ) : vista === 'semana' ? (
            <VistaHoraria {...propsVista} dias={diasSemana} ahora={agenda.data?.ahora ?? ''} alVerDia={irADia} />
          ) : vista === 'dia' ? (
            <VistaHoraria {...propsVista} dias={[fecha]} ahora={agenda.data?.ahora ?? ''} />
          ) : (
            <VistaListado {...propsVista} desde={rango.desde} hasta={rango.hasta} />
          )}
        </section>

        {panelAbierto && (
          <PanelAgenda
            eventoId={eventoId}
            seleccion={seleccion}
            proximos={proximos.data?.datos ?? []}
            cargandoProximos={proximos.isPending}
            hoy={hoy}
            alCerrarSeleccion={cerrarSeleccion}
            alSeleccionar={seleccionar}
            alEditar={(evento) => setDialogo({ evento })}
          />
        )}
      </div>

      {dialogo && (
        <DialogoEvento
          abierto
          key={dialogo.evento?.id ?? `${dialogo.fecha}-${dialogo.hora}`}
          evento={dialogo.evento}
          fechaInicial={dialogo.fecha}
          horaInicial={dialogo.hora}
          alCerrar={() => setDialogo(null)}
          alGuardar={(evento) => {
            setSeleccion(null);
            actualizar({ evento: evento.id });
          }}
        />
      )}
    </div>
  );
}
