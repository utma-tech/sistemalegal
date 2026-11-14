import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FilterX } from 'lucide-react';
import { useCatalogos } from '../../servicios/consultas';
import { useAuditoria, type FiltrosAuditoria } from '../../servicios/consultasOperacion';
import type { EventoAuditoria } from '../../tipos/api';
import { fechaHora, legible } from '../../lib/formato';
import { CabeceraPagina } from '../../componentes/ui/CabeceraPagina';
import { Tarjeta } from '../../componentes/ui/Tarjeta';
import { FiltroSelect } from '../../componentes/ui/Campo';
import { Paginacion } from '../../componentes/ui/Paginacion';
import { Modal } from '../../componentes/ui/Modal';
import { Etiqueta, type Tono } from '../../componentes/ui/Etiqueta';
import { ErrorCarga, EsqueletoTabla, Vacio } from '../../componentes/ui/Estados';

/**
 * Registro de auditoría: quién hizo qué, cuándo y desde dónde.
 *
 * Solo lectura. Cada fila guarda el antes y el después de la operación (sin
 * contraseñas ni tokens); el detalle los muestra lado a lado.
 */

const TAMANO = 50;
const ACCIONES = ['CREAR', 'ACTUALIZAR', 'ELIMINAR', 'CONSULTAR', 'EXPORTAR', 'LOGIN', 'LOGOUT', 'LOGIN_FALLIDO'];
const TONO: Record<string, Tono> = { CREAR: 'exito', ACTUALIZAR: 'info', ELIMINAR: 'peligro', LOGIN_FALLIDO: 'alerta' };

export function PaginaAuditoria() {
  const [parametros, setParametros] = useSearchParams();
  const { data: catalogos } = useCatalogos();
  const [detalle, setDetalle] = useState<EventoAuditoria>();

  const filtros = useMemo<FiltrosAuditoria>(
    () => ({
      pagina: Math.max(1, Number(parametros.get('pagina') ?? 1) || 1),
      tamano: TAMANO,
      entidad: parametros.get('entidad') || undefined,
      accion: parametros.get('accion') || undefined,
      usuario: parametros.get('usuario') || undefined,
      desde: parametros.get('desde') || undefined,
      hasta: parametros.get('hasta') || undefined,
    }),
    [parametros],
  );
  const { data, isPending, isError, error, refetch } = useAuditoria(filtros);

  const escribir = useCallback(
    (cambios: Record<string, string | undefined>, reiniciar = true) => {
      const siguientes = new URLSearchParams(parametros);
      for (const [clave, valor] of Object.entries(cambios)) {
        if (!valor) siguientes.delete(clave);
        else siguientes.set(clave, valor);
      }
      if (reiniciar) siguientes.delete('pagina');
      setParametros(siguientes, { replace: true });
    },
    [parametros, setParametros],
  );

  const hayFiltros = Boolean(filtros.entidad || filtros.accion || filtros.usuario || filtros.desde || filtros.hasta);

  return (
    <>
      <CabeceraPagina titulo="Auditoría" descripcion="Cada operación que modifica datos, con quién la hizo y qué cambió." />

      <Tarjeta>
        <div className="barra-filtros">
          <div className="barra-filtros__grupo">
            <FiltroSelect
              etiqueta="Qué"
              value={filtros.entidad ?? ''}
              onChange={(e) => escribir({ entidad: e.target.value || undefined })}
              opciones={(data?.entidades ?? []).map((e) => ({ valor: e, texto: legible(e) }))}
              vacio="Cualquier registro"
            />
            <FiltroSelect
              etiqueta="Acción"
              value={filtros.accion ?? ''}
              onChange={(e) => escribir({ accion: e.target.value || undefined })}
              opciones={ACCIONES.map((a) => ({ valor: a, texto: legible(a) }))}
              vacio="Cualquier acción"
            />
            <FiltroSelect
              etiqueta="Quién"
              value={filtros.usuario ?? ''}
              onChange={(e) => escribir({ usuario: e.target.value || undefined })}
              opciones={(catalogos?.profesionales ?? []).map((p) => ({ valor: p.id, texto: p.nombre }))}
              vacio="Cualquier integrante"
            />
            <input
              type="date"
              className="campo__control"
              aria-label="Desde"
              style={{ width: 'auto' }}
              title="Desde"
              value={filtros.desde ?? ''}
              onChange={(e) => escribir({ desde: e.target.value || undefined })}
            />
            <input
              type="date"
              className="campo__control"
              aria-label="Hasta"
              style={{ width: 'auto' }}
              title="Hasta"
              value={filtros.hasta ?? ''}
              onChange={(e) => escribir({ hasta: e.target.value || undefined })}
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
          <p className="texto-pequeno texto-tenue" style={{ margin: 0 }}>
            {data ? `${data.total} eventos` : 'Buscando…'}
          </p>
        </div>
      </Tarjeta>

      <Tarjeta sinRelleno>
        {isPending && <EsqueletoTabla columnas={4} />}
        {isError && <ErrorCarga error={error} reintentar={() => void refetch()} />}
        {data?.datos.length === 0 && <Vacio titulo="Sin eventos" texto="Nada registrado con esos filtros." />}
        {data && data.datos.length > 0 && (
          <div className="tabla-envoltorio">
            <table className="tabla tabla--clicable">
              <caption className="solo-lectores">Eventos de auditoría. Cada fila abre el detalle.</caption>
              <thead>
                <tr>
                  <th scope="col">Cuándo</th>
                  <th scope="col">Quién</th>
                  <th scope="col">Acción</th>
                  <th scope="col">Sobre</th>
                </tr>
              </thead>
              <tbody>
                {data.datos.map((evento) => (
                  <tr
                    key={evento.id}
                    tabIndex={0}
                    onClick={() => setDetalle(evento)}
                    onKeyDown={(e) => e.key === 'Enter' && setDetalle(evento)}
                  >
                    <td className="numero">{fechaHora(evento.fecha)}</td>
                    <td>{evento.usuario ?? 'Sistema'}</td>
                    <td>
                      <Etiqueta tono={TONO[evento.accion] ?? 'neutral'}>{legible(evento.accion)}</Etiqueta>
                    </td>
                    <td>
                      <div className="tabla__principal">{legible(evento.entidad)}</div>
                      {evento.ip && <div className="tabla__secundario">desde {evento.ip}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
            sustantivo="eventos"
          />
        </Tarjeta>
      )}

      {detalle && (
        <Modal
          abierto
          alCerrar={() => setDetalle(undefined)}
          titulo={`${legible(detalle.accion)} · ${legible(detalle.entidad)}`}
          descripcion={`${detalle.usuario ?? 'Sistema'} · ${fechaHora(detalle.fecha)}`}
          ancho
        >
          <div className="datos">
            <div>
              <p className="dato__etiqueta">Antes</p>
              <pre className="texto-extraido">{detalle.datos_antes ? JSON.stringify(detalle.datos_antes, null, 2) : '—'}</pre>
            </div>
            <div>
              <p className="dato__etiqueta">Después</p>
              <pre className="texto-extraido">{detalle.datos_despues ? JSON.stringify(detalle.datos_despues, null, 2) : '—'}</pre>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
