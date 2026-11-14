import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FilterX, Plus } from 'lucide-react';
import { useCatalogos } from '../../servicios/consultas';
import { useTareas, type FiltrosTarea } from '../../servicios/consultasOperacion';
import { useSesion } from '../auth/ContextoSesion';
import { PRIORIDADES_TAREA } from '../../lib/vocabulario';
import { CabeceraPagina } from '../../componentes/ui/CabeceraPagina';
import { Tarjeta } from '../../componentes/ui/Tarjeta';
import { Boton } from '../../componentes/ui/Boton';
import { FiltroSelect } from '../../componentes/ui/Campo';
import { Paginacion } from '../../componentes/ui/Paginacion';
import { ErrorCarga, EsqueletoLista } from '../../componentes/ui/Estados';
import { DialogoTarea } from './DialogoTarea';
import { ListaTareas } from './ListaTareas';

/**
 * Tablero de tareas del estudio.
 *
 * Arranca en "mis tareas abiertas", que es la pregunta de cada mañana. Los
 * filtros viven en la URL, como en el resto del producto.
 */

const TAMANO = 30;

export function PaginaTareas() {
  const [parametros, setParametros] = useSearchParams();
  const { usuario, puede } = useSesion();
  const { data: catalogos } = useCatalogos();
  const [creando, setCreando] = useState(false);

  // "mias" es el valor por defecto; "todas" lo apaga explícitamente.
  const asignadaParam = parametros.get('asignada') ?? 'mias';
  const asignada = asignadaParam === 'mias' ? usuario?.id : asignadaParam === 'todas' ? undefined : asignadaParam;
  const vigencia = (parametros.get('vigencia') ?? 'abiertas') as FiltrosTarea['vigencia'];
  const prioridad = parametros.get('prioridad') ?? '';

  const filtros = useMemo<FiltrosTarea>(
    () => ({
      pagina: Math.max(1, Number(parametros.get('pagina') ?? 1) || 1),
      tamano: TAMANO,
      asignada,
      vigencia,
      prioridad: prioridad || undefined,
    }),
    [parametros, asignada, vigencia, prioridad],
  );

  const { data, isPending, isError, error, refetch } = useTareas(filtros);

  const escribir = useCallback(
    (cambios: Record<string, string | undefined>, reiniciarPagina = true) => {
      const siguientes = new URLSearchParams(parametros);
      for (const [clave, valor] of Object.entries(cambios)) {
        if (!valor) siguientes.delete(clave);
        else siguientes.set(clave, valor);
      }
      if (reiniciarPagina) siguientes.delete('pagina');
      setParametros(siguientes, { replace: true });
    },
    [parametros, setParametros],
  );

  const hayFiltros = asignadaParam !== 'mias' || vigencia !== 'abiertas' || Boolean(prioridad);

  return (
    <>
      <CabeceraPagina
        titulo="Tareas"
        descripcion="Trabajo delegado entre los integrantes del estudio."
        acciones={
          puede('tarea.crear') && (
            <Boton variante="primario" icono={<Plus size={16} aria-hidden />} onClick={() => setCreando(true)}>
              Nueva tarea
            </Boton>
          )
        }
      />

      <Tarjeta>
        <div className="barra-filtros">
          <div className="barra-filtros__grupo">
            <FiltroSelect
              etiqueta="Asignadas a"
              value={asignadaParam === 'mias' ? '' : asignadaParam}
              onChange={(e) => escribir({ asignada: e.target.value || undefined })}
              opciones={[
                { valor: 'todas', texto: 'Todo el estudio' },
                ...(catalogos?.profesionales ?? [])
                  .filter((p) => p.id !== usuario?.id)
                  .map((p) => ({ valor: p.id, texto: p.nombre })),
              ]}
              vacio="Mis tareas"
            />
            <FiltroSelect
              etiqueta="Estado"
              value={vigencia === 'abiertas' ? '' : vigencia}
              onChange={(e) => escribir({ vigencia: e.target.value || undefined })}
              opciones={[
                { valor: 'cerradas', texto: 'Cerradas' },
                { valor: 'todas', texto: 'Todas' },
              ]}
              vacio="Abiertas"
            />
            <FiltroSelect
              etiqueta="Prioridad"
              value={prioridad}
              onChange={(e) => escribir({ prioridad: e.target.value || undefined })}
              opciones={PRIORIDADES_TAREA}
              vacio="Cualquier prioridad"
            />
            {hayFiltros && (
              <button
                type="button"
                className="boton boton--sutil boton--pequeno"
                onClick={() => setParametros(new URLSearchParams(), { replace: true })}
              >
                <FilterX size={15} aria-hidden />
                Quitar filtros
              </button>
            )}
          </div>
          <p className="texto-pequeno texto-tenue" aria-live="polite" style={{ margin: 0 }}>
            {isPending ? 'Buscando…' : `${data?.total ?? 0} ${data?.total === 1 ? 'tarea' : 'tareas'}`}
          </p>
        </div>
      </Tarjeta>

      <Tarjeta sinRelleno>
        {isPending && <EsqueletoLista />}
        {isError && <ErrorCarga error={error} reintentar={() => void refetch()} />}
        {data && (
          <ListaTareas
            tareas={data.datos}
            textoVacio={hayFiltros ? 'Nada con esos filtros.' : 'No tenés tareas abiertas. Buen momento para un café.'}
          />
        )}
      </Tarjeta>

      {data && data.totalPaginas > 1 && (
        <Tarjeta>
          <Paginacion
            pagina={data.pagina}
            totalPaginas={data.totalPaginas}
            total={data.total}
            tamano={data.tamano}
            cantidadEnPagina={data.datos.length}
            alCambiarPagina={(pagina) => escribir({ pagina: pagina <= 1 ? undefined : String(pagina) }, false)}
            sustantivo="tareas"
          />
        </Tarjeta>
      )}

      {creando && <DialogoTarea abierto alCerrar={() => setCreando(false)} />}
    </>
  );
}
