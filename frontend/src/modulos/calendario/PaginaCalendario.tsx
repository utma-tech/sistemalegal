import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarOff, Copy, Plus, Trash2 } from 'lucide-react';
import {
  useAgregarInhabiles,
  useCopiarInhabiles,
  useEliminarInhabil,
  useInhabiles,
} from '../../servicios/consultasOperacion';
import type { DiaInhabil } from '../../tipos/api';
import { useSesion } from '../auth/ContextoSesion';
import { TIPOS_INHABIL, tipoInhabilLegible } from '../../lib/vocabulario';
import { fechaLarga } from '../../lib/formato';
import { useErroresFormulario } from '../../lib/formulario';
import { useAvisos } from '../../componentes/ui/Avisos';
import { CabeceraPagina } from '../../componentes/ui/CabeceraPagina';
import { Tarjeta } from '../../componentes/ui/Tarjeta';
import { Boton } from '../../componentes/ui/Boton';
import { Modal } from '../../componentes/ui/Modal';
import { CampoCasilla, CampoSelect, CampoTexto, FiltroSelect } from '../../componentes/ui/Campo';
import { DialogoConfirmar } from '../../componentes/ui/DialogoConfirmar';
import { Etiqueta, type Tono } from '../../componentes/ui/Etiqueta';
import { ErrorCarga, EsqueletoLista, Vacio } from '../../componentes/ui/Estados';

/**
 * Calendario judicial: los días inhábiles de cada año.
 *
 * Es el dato del que depende cada vencimiento. Un feriado que falta corre un
 * plazo sin avisar, por eso la pantalla dice cuántos días tiene cargados el
 * año y advierte si el que viene todavía está vacío.
 */

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const TONO_TIPO: Record<string, Tono> = {
  FERIADO_NACIONAL: 'marca',
  FERIADO_PROVINCIAL: 'info',
  FERIA_JUDICIAL: 'alerta',
  ASUETO: 'neutral',
  OTRO: 'neutral',
};

/** Agrupa los días por mes, y las corridas consecutivas del mismo motivo en un solo renglón (la feria). */
function agrupar(dias: DiaInhabil[]) {
  const porMes = new Map<number, { desde: DiaInhabil; hasta: DiaInhabil; dias: DiaInhabil[] }[]>();
  for (const dia of dias) {
    const mes = Number(dia.fecha.slice(5, 7)) - 1;
    const grupos = porMes.get(mes) ?? [];
    const ultimo = grupos[grupos.length - 1];
    const siguiente = ultimo && new Date(`${ultimo.hasta.fecha}T12:00:00`);
    siguiente?.setDate(siguiente.getDate() + 1);
    const contiguo =
      ultimo && ultimo.desde.motivo === dia.motivo && siguiente?.toISOString().slice(0, 10) === dia.fecha;
    if (ultimo && contiguo) {
      ultimo.hasta = dia;
      ultimo.dias.push(dia);
    } else grupos.push({ desde: dia, hasta: dia, dias: [dia] });
    porMes.set(mes, grupos);
  }
  return [...porMes.entries()].sort(([a], [b]) => a - b);
}

export function PaginaCalendario() {
  const [parametros, setParametros] = useSearchParams();
  const { puede } = useSesion();
  const { avisar } = useAvisos();
  const anioActual = new Date().getFullYear();
  const anio = Number(parametros.get('anio') ?? anioActual) || anioActual;

  const { data, isPending, isError, error, refetch } = useInhabiles(anio);
  const eliminar = useEliminarInhabil();
  const [agregando, setAgregando] = useState(false);
  const [copiando, setCopiando] = useState(false);
  const [aEliminar, setAEliminar] = useState<{ dias: DiaInhabil[]; texto: string }>();
  const [errorBaja, setErrorBaja] = useState<string>();

  const cargadosProximo = data?.anios.find((a) => a.anio === anioActual + 1)?.cantidad ?? 0;
  const opcionesAnio = [anioActual - 1, anioActual, anioActual + 1, anioActual + 2].map((a) => ({
    valor: String(a),
    texto: `${a} (${data?.anios.find((x) => x.anio === a)?.cantidad ?? 0} días)`,
  }));

  async function confirmarBaja() {
    if (!aEliminar) return;
    setErrorBaja(undefined);
    try {
      for (const dia of aEliminar.dias) await eliminar.mutateAsync(dia.id);
      avisar(aEliminar.dias.length === 1 ? 'Día quitado del calendario.' : `${aEliminar.dias.length} días quitados.`);
      setAEliminar(undefined);
    } catch (fallo) {
      setErrorBaja(fallo instanceof Error ? fallo.message : 'No se pudo quitar.');
    }
  }

  return (
    <>
      <CabeceraPagina
        titulo="Calendario judicial"
        descripcion="Feriados, feria y asuetos. Los plazos en días hábiles se calculan sobre este calendario."
        acciones={
          puede('calendario.crear') && (
            <>
              <Boton icono={<Copy size={16} aria-hidden />} onClick={() => setCopiando(true)}>
                Copiar de otro año
              </Boton>
              <Boton variante="primario" icono={<Plus size={16} aria-hidden />} onClick={() => setAgregando(true)}>
                Agregar días
              </Boton>
            </>
          )
        }
      />

      {anio === anioActual && cargadosProximo === 0 && new Date().getMonth() >= 9 && (
        <div className="aviso aviso--alerta" role="status">
          <span className="aviso__cuerpo">
            <strong>{anioActual + 1} todavía no tiene días inhábiles cargados.</strong> Un plazo que se extienda
            al año que viene se va a calcular sin feriados ni feria. Usá «Copiar de otro año» para los feriados
            de fecha fija y sumá la feria de enero.
          </span>
        </div>
      )}

      <Tarjeta>
        <div className="barra-filtros">
          <div className="barra-filtros__grupo">
            <FiltroSelect
              etiqueta="Año"
              value={String(anio)}
              onChange={(e) => setParametros(e.target.value ? { anio: e.target.value } : {}, { replace: true })}
              opciones={opcionesAnio.filter((o) => o.valor !== String(anioActual))}
              vacio={opcionesAnio.find((o) => o.valor === String(anioActual))?.texto ?? String(anioActual)}
            />
          </div>
          <p className="texto-pequeno texto-tenue" style={{ margin: 0 }}>
            {data ? `${data.datos.length} días inhábiles en ${anio}` : 'Cargando…'} · sábados y domingos no se cargan:
            siempre son inhábiles.
          </p>
        </div>
      </Tarjeta>

      {isPending && (
        <Tarjeta>
          <EsqueletoLista />
        </Tarjeta>
      )}
      {isError && (
        <Tarjeta>
          <ErrorCarga error={error} reintentar={() => void refetch()} />
        </Tarjeta>
      )}
      {data && data.datos.length === 0 && (
        <Tarjeta>
          <Vacio
            titulo={`${anio} no tiene días inhábiles`}
            texto="Sin este calendario, los vencimientos en días hábiles solo descuentan los fines de semana."
            icono={<CalendarOff size={20} aria-hidden />}
          />
        </Tarjeta>
      )}

      {data &&
        agrupar(data.datos).map(([mes, grupos]) => (
          <Tarjeta key={mes} titulo={MESES[mes]} sinRelleno>
            <div className="lista">
              {grupos.map((grupo) => {
                const rango = grupo.dias.length > 1;
                const texto = rango
                  ? `Del ${fechaLarga(grupo.desde.fecha)} al ${fechaLarga(grupo.hasta.fecha)}`
                  : fechaLarga(grupo.desde.fecha);
                return (
                  <div key={grupo.desde.id} className="lista__item">
                    <span className="lista__cuerpo">
                      <span className="lista__titulo">{grupo.desde.motivo}</span>
                      <span className="lista__meta">
                        {texto}
                        {rango && ` · ${grupo.dias.length} días`}
                      </span>
                    </span>
                    <span className="lista__lateral">
                      <Etiqueta tono={TONO_TIPO[grupo.desde.tipo] ?? 'neutral'}>
                        {tipoInhabilLegible(grupo.desde.tipo)}
                      </Etiqueta>
                      {puede('calendario.eliminar') && (
                        <Boton
                          pequeno
                          variante="sutil"
                          icono={<Trash2 size={14} aria-hidden />}
                          aria-label={`Quitar ${grupo.desde.motivo}`}
                          title="Quitar"
                          onClick={() => setAEliminar({ dias: grupo.dias, texto: `${grupo.desde.motivo} (${texto})` })}
                        />
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </Tarjeta>
        ))}

      {agregando && <DialogoAgregarInhabiles anio={anio} alCerrar={() => setAgregando(false)} />}
      {copiando && <DialogoCopiar anio={anio} alCerrar={() => setCopiando(false)} />}

      <DialogoConfirmar
        abierto={Boolean(aEliminar)}
        titulo="Quitar del calendario"
        mensaje={
          <>
            Se quita <strong>{aEliminar?.texto}</strong>. Los plazos que ya están calculados no cambian solos: su
            detalle va a avisar que el calendario cambió.
          </>
        }
        textoConfirmar="Quitar"
        cargando={eliminar.isPending}
        error={errorBaja}
        alConfirmar={() => void confirmarBaja()}
        alCerrar={() => setAEliminar(undefined)}
      />
    </>
  );
}

function DialogoAgregarInhabiles({ anio, alCerrar }: { anio: number; alCerrar: () => void }) {
  const agregar = useAgregarInhabiles();
  const { avisar } = useAvisos();
  const { errores, errorGeneral, limpiar, limpiarCampo, registrar } = useErroresFormulario();
  const [desde, setDesde] = useState(`${anio}-01-01`);
  const [hasta, setHasta] = useState('');
  const [tipo, setTipo] = useState('FERIADO_NACIONAL');
  const [motivo, setMotivo] = useState('');
  const [omitir, setOmitir] = useState(false);

  async function enviar(evento: SubmitEvent) {
    evento.preventDefault();
    limpiar();
    try {
      const r = await agregar.mutateAsync({
        fecha_desde: desde,
        fecha_hasta: hasta || undefined,
        tipo,
        motivo,
        omitir_fines_de_semana: omitir,
      });
      avisar(
        r.omitidos > 0
          ? `${r.creados.length} días agregados; ${r.omitidos} ya estaban cargados o eran fin de semana.`
          : `${r.creados.length} ${r.creados.length === 1 ? 'día agregado' : 'días agregados'}.`,
      );
      alCerrar();
    } catch (fallo) {
      registrar(fallo, 'No se pudieron agregar los días.');
    }
  }

  return (
    <Modal
      abierto
      alCerrar={alCerrar}
      titulo="Agregar días inhábiles"
      descripcion="Un día suelto, o un rango para la feria judicial."
      pie={
        <>
          <Boton onClick={alCerrar} disabled={agregar.isPending}>
            Cancelar
          </Boton>
          <Boton variante="primario" type="submit" form="formulario-inhabil" cargando={agregar.isPending}>
            Agregar
          </Boton>
        </>
      }
    >
      <form id="formulario-inhabil" onSubmit={enviar} noValidate className="pila">
        {errorGeneral && (
          <div className="aviso aviso--peligro" role="alert">
            <span className="aviso__cuerpo">{errorGeneral}</span>
          </div>
        )}
        <div className="datos">
          <CampoTexto
            etiqueta="Fecha (o desde)"
            type="date"
            value={desde}
            onChange={(e) => {
              setDesde(e.target.value);
              limpiarCampo('fecha_desde');
            }}
            error={errores.fecha_desde?.[0]}
            obligatorio
          />
          <CampoTexto
            etiqueta="Hasta"
            type="date"
            value={hasta}
            onChange={(e) => {
              setHasta(e.target.value);
              limpiarCampo('fecha_hasta');
            }}
            ayuda="Solo para un rango."
            error={errores.fecha_hasta?.[0]}
          />
          <CampoSelect etiqueta="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} opciones={TIPOS_INHABIL} />
        </div>
        <CampoTexto
          etiqueta="Motivo"
          value={motivo}
          onChange={(e) => {
            setMotivo(e.target.value);
            limpiarCampo('motivo');
          }}
          placeholder="Día de la Bandera · Feria judicial de julio · Asueto Acuerdo TSJ n.º …"
          error={errores.motivo?.[0]}
          maxLength={200}
          obligatorio
        />
        {hasta && (
          <CampoCasilla
            etiqueta="No cargar sábados ni domingos"
            ayuda="Ya son inhábiles para el cómputo; cargarlos solo agrega filas."
            checked={omitir}
            onChange={(e) => setOmitir(e.target.checked)}
          />
        )}
      </form>
    </Modal>
  );
}

function DialogoCopiar({ anio, alCerrar }: { anio: number; alCerrar: () => void }) {
  const copiar = useCopiarInhabiles();
  const { avisar } = useAvisos();
  const { errores, errorGeneral, limpiar, registrar } = useErroresFormulario();
  const [origen, setOrigen] = useState(String(anio - 1));
  const [destino, setDestino] = useState(String(anio));

  async function enviar(evento: SubmitEvent) {
    evento.preventDefault();
    limpiar();
    try {
      const r = await copiar.mutateAsync({
        anio_origen: Number(origen),
        anio_destino: Number(destino),
        tipos: ['FERIADO_NACIONAL', 'FERIADO_PROVINCIAL'],
      });
      avisar(`${r.creados.length} feriados copiados a ${destino}. Revisá los trasladables.`);
      alCerrar();
    } catch (fallo) {
      registrar(fallo, 'No se pudo copiar.');
    }
  }

  return (
    <Modal
      abierto
      alCerrar={alCerrar}
      titulo="Copiar feriados de otro año"
      descripcion="Copia los feriados nacionales y provinciales en la misma fecha. La feria y los asuetos no se copian."
      pie={
        <>
          <Boton onClick={alCerrar} disabled={copiar.isPending}>
            Cancelar
          </Boton>
          <Boton variante="primario" type="submit" form="formulario-copia" cargando={copiar.isPending}>
            Copiar
          </Boton>
        </>
      }
    >
      <form id="formulario-copia" onSubmit={enviar} noValidate className="pila">
        {errorGeneral && (
          <div className="aviso aviso--peligro" role="alert">
            <span className="aviso__cuerpo">{errorGeneral}</span>
          </div>
        )}
        <div className="datos">
          <CampoTexto etiqueta="Desde el año" type="number" value={origen} onChange={(e) => setOrigen(e.target.value)} />
          <CampoTexto
            etiqueta="Hacia el año"
            type="number"
            value={destino}
            onChange={(e) => setDestino(e.target.value)}
            error={errores.anio_destino?.[0]}
          />
        </div>
        <div className="aviso aviso--info">
          <span className="aviso__cuerpo">
            Carnaval, Semana Santa y los feriados trasladables cambian de fecha cada año: después de copiar,
            corregilos contra el decreto del año.
          </span>
        </div>
      </form>
    </Modal>
  );
}
