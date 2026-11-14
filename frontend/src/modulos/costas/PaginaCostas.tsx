import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, FilterX } from 'lucide-react';
import { consulta } from '../../servicios/api';
import { descargarArchivo, useCostas, type FiltrosCosta } from '../../servicios/consultasOperacion';
import { useSesion } from '../auth/ContextoSesion';
import { A_CARGO_COSTA, ESTADOS_COBRO } from '../../lib/vocabulario';
import { importe } from '../../lib/formato';
import { useAvisos } from '../../componentes/ui/Avisos';
import { CabeceraPagina } from '../../componentes/ui/CabeceraPagina';
import { Tarjeta } from '../../componentes/ui/Tarjeta';
import { Boton } from '../../componentes/ui/Boton';
import { FiltroSelect } from '../../componentes/ui/Campo';
import { Paginacion } from '../../componentes/ui/Paginacion';
import { ErrorCarga, EsqueletoTabla } from '../../componentes/ui/Estados';
import { TablaCostas } from './TablaCostas';

/**
 * Honorarios y costas: control de cobranza del estudio.
 *
 * Responde "qué nos deben y desde cuándo". Los totales salen del servidor con
 * los mismos filtros que la tabla, así que el reporte exportado coincide con lo
 * que se ve.
 */

const TAMANO = 30;

export function PaginaCostas() {
  const [parametros, setParametros] = useSearchParams();
  const { puede } = useSesion();
  const { avisar } = useAvisos();
  const [exportando, setExportando] = useState(false);

  const vigencia = (parametros.get('vigencia') ?? 'pendientes') as FiltrosCosta['vigencia'];
  const estado = parametros.get('estado') ?? '';
  const aCargo = parametros.get('a_cargo_de') ?? '';
  const desde = parametros.get('desde') ?? '';
  const hasta = parametros.get('hasta') ?? '';

  const filtros = useMemo<FiltrosCosta>(
    () => ({
      pagina: Math.max(1, Number(parametros.get('pagina') ?? 1) || 1),
      tamano: TAMANO,
      vigencia: estado ? 'todas' : vigencia,
      estado: estado || undefined,
      a_cargo_de: aCargo || undefined,
      desde: desde || undefined,
      hasta: hasta || undefined,
    }),
    [parametros, vigencia, estado, aCargo, desde, hasta],
  );

  const { data, isPending, isError, error, refetch } = useCostas(filtros);

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

  async function exportar() {
    setExportando(true);
    try {
      const { pagina: _p, tamano: _t, ...resto } = filtros;
      await descargarArchivo(`/api/costas/exportar${consulta({ ...resto })}`, 'costas.csv');
    } catch (fallo) {
      avisar(fallo instanceof Error ? fallo.message : 'No se pudo exportar.', 'error');
    } finally {
      setExportando(false);
    }
  }

  const hayFiltros = vigencia !== 'pendientes' || Boolean(estado || aCargo || desde || hasta);

  return (
    <>
      <CabeceraPagina
        titulo="Honorarios y costas"
        descripcion="Gastos del proceso, quién los soporta y qué falta cobrar."
        acciones={
          puede('costa.exportar') && (
            <Boton icono={<Download size={16} aria-hidden />} onClick={() => void exportar()} cargando={exportando}>
              Exportar CSV
            </Boton>
          )
        }
      />

      <Tarjeta>
        <div className="barra-filtros">
          <div className="barra-filtros__grupo">
            <FiltroSelect
              etiqueta="Qué mostrar"
              value={vigencia === 'pendientes' ? '' : vigencia}
              onChange={(e) => escribir({ vigencia: e.target.value || undefined })}
              opciones={[{ valor: 'todas', texto: 'Todas las costas' }]}
              vacio="Con saldo por cobrar"
            />
            <FiltroSelect
              etiqueta="Estado"
              value={estado}
              onChange={(e) => escribir({ estado: e.target.value || undefined })}
              opciones={ESTADOS_COBRO}
              vacio="Cualquier estado"
            />
            <FiltroSelect
              etiqueta="A cargo de"
              value={aCargo}
              onChange={(e) => escribir({ a_cargo_de: e.target.value || undefined })}
              opciones={A_CARGO_COSTA}
              vacio="Cualquiera"
            />
            <input
              type="date"
              className="campo__control"
              aria-label="Devengadas desde"
              style={{ width: 'auto' }}
              title="Devengadas desde"
              value={desde}
              onChange={(e) => escribir({ desde: e.target.value || undefined })}
            />
            <input
              type="date"
              className="campo__control"
              aria-label="Devengadas hasta"
              style={{ width: 'auto' }}
              title="Devengadas hasta"
              value={hasta}
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
        </div>
      </Tarjeta>

      {data && (
        <Tarjeta>
          <div className="totales">
            <div>
              <p className="dato__etiqueta">Costas</p>
              <p className="indicador__valor">{data.total}</p>
            </div>
            <div>
              <p className="dato__etiqueta">Devengado</p>
              <p className="indicador__valor numero">{importe(data.totales.monto)}</p>
            </div>
            <div>
              <p className="dato__etiqueta">Cobrado</p>
              <p className="indicador__valor numero">{importe(data.totales.cobrado)}</p>
            </div>
            <div>
              <p className="dato__etiqueta">Por cobrar</p>
              <p className="indicador__valor numero">{importe(data.totales.saldo)}</p>
            </div>
          </div>
        </Tarjeta>
      )}

      <Tarjeta sinRelleno>
        {isPending && <EsqueletoTabla columnas={6} />}
        {isError && <ErrorCarga error={error} reintentar={() => void refetch()} />}
        {data && <TablaCostas costas={data.datos} />}
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
            sustantivo="costas"
          />
        </Tarjeta>
      )}

      <p className="texto-pequeno texto-tenue" style={{ textAlign: 'center' }}>
        Las costas se registran desde la pestaña «Costas» de cada expediente.
      </p>
    </>
  );
}
