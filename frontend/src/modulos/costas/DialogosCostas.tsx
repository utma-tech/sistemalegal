import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { Ban, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { useCatalogos } from '../../servicios/consultas';
import {
  useCosta,
  useEliminarCosta,
  useGuardarCosta,
  useMarcarIncobrable,
  useQuitarCobro,
  useRegistrarCobro,
} from '../../servicios/consultasOperacion';
import type { Costa } from '../../tipos/api';
import { useSesion } from '../auth/ContextoSesion';
import { A_CARGO_COSTA, MEDIOS_PAGO, aCargoLegible, estadoCobroLegible, medioPagoLegible } from '../../lib/vocabulario';
import { fecha, importe } from '../../lib/formato';
import { useErroresFormulario } from '../../lib/formulario';
import { useAvisos } from '../../componentes/ui/Avisos';
import { Modal } from '../../componentes/ui/Modal';
import { Boton } from '../../componentes/ui/Boton';
import { CampoSelect, CampoTexto } from '../../componentes/ui/Campo';
import { Etiqueta, type Tono } from '../../componentes/ui/Etiqueta';
import { Cargando, ErrorCarga } from '../../componentes/ui/Estados';
import { DialogoConfirmar } from '../../componentes/ui/DialogoConfirmar';

const HOY = new Date().toISOString().slice(0, 10);

const TONO_COBRO: Record<string, Tono> = {
  PENDIENTE: 'alerta',
  PARCIAL: 'info',
  COBRADO: 'exito',
  INCOBRABLE: 'neutral',
};

export function EstadoCobro({ estado }: { estado: string }) {
  return <Etiqueta tono={TONO_COBRO[estado] ?? 'neutral'}>{estadoCobroLegible(estado)}</Etiqueta>;
}

/** Alta o edición de una costa. */
export function DialogoCosta({
  causaId,
  caratula,
  costa,
  alCerrar,
}: {
  causaId: string;
  caratula: string;
  costa?: Costa;
  alCerrar: () => void;
}) {
  const guardar = useGuardarCosta(causaId, costa?.costa_id);
  const { data: catalogos } = useCatalogos();
  const { avisar } = useAvisos();
  const { errores, errorGeneral, limpiar, limpiarCampo, registrar } = useErroresFormulario();
  const [concepto, setConcepto] = useState(costa?.concepto_costa_id ?? '');
  const [descripcion, setDescripcion] = useState(costa?.descripcion ?? '');
  const [monto, setMonto] = useState(costa?.monto ?? '');
  const [devengada, setDevengada] = useState(costa?.fecha_devengamiento ?? HOY);
  const [vence, setVence] = useState(costa?.fecha_vencimiento_pago ?? '');
  const [aCargo, setACargo] = useState<Costa['a_cargo_de']>(costa?.a_cargo_de ?? 'CLIENTE');
  const [comprobante, setComprobante] = useState(costa?.comprobante ?? '');

  async function enviar(evento: SubmitEvent) {
    evento.preventDefault();
    limpiar();
    try {
      await guardar.mutateAsync({
        concepto_costa_id: concepto,
        descripcion: descripcion || undefined,
        monto,
        fecha_devengamiento: devengada,
        fecha_vencimiento_pago: vence || undefined,
        a_cargo_de: aCargo,
        comprobante: comprobante || undefined,
      });
      avisar(costa ? 'Costa actualizada.' : 'Costa registrada.');
      alCerrar();
    } catch (fallo) {
      registrar(fallo, 'No se pudo guardar la costa.');
    }
  }

  const campo = (clave: string, set: (v: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value);
    limpiarCampo(clave);
  };

  return (
    <Modal
      abierto
      alCerrar={alCerrar}
      titulo={costa ? 'Editar costa' : 'Registrar costa'}
      descripcion={caratula}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardar.isPending}>
            Cancelar
          </Boton>
          <Boton variante="primario" type="submit" form="formulario-costa" cargando={guardar.isPending}>
            Guardar
          </Boton>
        </>
      }
    >
      <form id="formulario-costa" onSubmit={enviar} noValidate className="pila">
        {errorGeneral && (
          <div className="aviso aviso--peligro" role="alert">
            <span className="aviso__cuerpo">{errorGeneral}</span>
          </div>
        )}
        <div className="datos">
          <CampoSelect
            etiqueta="Concepto"
            value={concepto}
            onChange={campo('concepto_costa_id', setConcepto)}
            opciones={(catalogos?.conceptosCosta ?? []).map((c) => ({ valor: c.id, texto: c.nombre }))}
            vacio="Elegí un concepto"
            error={errores.concepto_costa_id?.[0]}
            obligatorio
          />
          <CampoTexto
            etiqueta="Monto (ARS)"
            inputMode="decimal"
            value={monto}
            onChange={campo('monto', setMonto)}
            placeholder="15.000,00"
            error={errores.monto?.[0]}
            obligatorio
          />
          <CampoSelect
            etiqueta="A cargo de"
            value={aCargo}
            onChange={(e) => setACargo(e.target.value as Costa['a_cargo_de'])}
            opciones={A_CARGO_COSTA}
            error={errores.a_cargo_de?.[0]}
          />
          <CampoTexto
            etiqueta="Devengada el"
            type="date"
            value={devengada}
            onChange={campo('fecha_devengamiento', setDevengada)}
            error={errores.fecha_devengamiento?.[0]}
            obligatorio
          />
          <CampoTexto
            etiqueta="Vence el pago"
            type="date"
            value={vence}
            onChange={campo('fecha_vencimiento_pago', setVence)}
            error={errores.fecha_vencimiento_pago?.[0]}
          />
          <CampoTexto etiqueta="Comprobante" value={comprobante} onChange={campo('comprobante', setComprobante)} maxLength={100} />
        </div>
        <CampoTexto
          etiqueta="Descripción"
          value={descripcion}
          onChange={campo('descripcion', setDescripcion)}
          placeholder="Tasa de justicia por iniciación"
          error={errores.descripcion?.[0]}
          maxLength={300}
        />
      </form>
    </Modal>
  );
}

/** Detalle de una costa con sus cobros: registrar, quitar, marcar incobrable. */
export function DialogoDetalleCosta({ costaId, alCerrar }: { costaId: string; alCerrar: () => void }) {
  const { data, isPending, isError, error, refetch } = useCosta(costaId);
  const [editando, setEditando] = useState(false);

  return (
    <Modal abierto alCerrar={alCerrar} titulo="Costa y cobros" descripcion={data?.costa.caratula} ancho>
      {isPending && <Cargando />}
      {isError && <ErrorCarga error={error} reintentar={() => void refetch()} />}
      {data && (
        <>
          <ContenidoDetalle costa={data.costa} cobros={data.cobros} alEditar={() => setEditando(true)} alCerrar={alCerrar} />
          {editando && (
            <DialogoCosta
              causaId={data.costa.causa_id}
              caratula={data.costa.caratula}
              costa={data.costa}
              alCerrar={() => setEditando(false)}
            />
          )}
        </>
      )}
    </Modal>
  );
}

function ContenidoDetalle({
  costa,
  cobros,
  alEditar,
  alCerrar,
}: {
  costa: Costa;
  cobros: { id: string; monto: string; fecha: string; medio_pago: string; comprobante: string | null; registrado_por: string | null }[];
  alEditar: () => void;
  alCerrar: () => void;
}) {
  const { puede } = useSesion();
  const { avisar } = useAvisos();
  const registrarCobro = useRegistrarCobro(costa);
  const quitarCobro = useQuitarCobro(costa);
  const incobrable = useMarcarIncobrable(costa);
  const eliminar = useEliminarCosta();
  const { errores, errorGeneral, limpiar, limpiarCampo, registrar } = useErroresFormulario();
  const [monto, setMonto] = useState('');
  const [fechaCobro, setFechaCobro] = useState(HOY);
  const [medio, setMedio] = useState('TRANSFERENCIA');
  const [comprobante, setComprobante] = useState('');
  const [borrando, setBorrando] = useState(false);
  const [errorBaja, setErrorBaja] = useState<string>();

  const conSaldo = costa.estado_cobro === 'PENDIENTE' || costa.estado_cobro === 'PARCIAL';

  async function cobrar(evento: SubmitEvent) {
    evento.preventDefault();
    limpiar();
    try {
      await registrarCobro.mutateAsync({ monto, fecha: fechaCobro, medio_pago: medio, comprobante: comprobante || undefined });
      avisar('Cobro registrado.');
      setMonto('');
      setComprobante('');
    } catch (fallo) {
      registrar(fallo, 'No se pudo registrar el cobro.');
    }
  }

  async function alternarIncobrable() {
    try {
      await incobrable.mutateAsync(costa.estado_cobro !== 'INCOBRABLE');
      avisar(costa.estado_cobro === 'INCOBRABLE' ? 'La costa vuelve a estar por cobrar.' : 'Marcada como incobrable.');
    } catch (fallo) {
      avisar(fallo instanceof Error ? fallo.message : 'No se pudo actualizar.', 'error');
    }
  }

  async function confirmarBaja() {
    setErrorBaja(undefined);
    try {
      await eliminar.mutateAsync(costa);
      avisar('Costa eliminada.');
      alCerrar();
    } catch (fallo) {
      setErrorBaja(fallo instanceof Error ? fallo.message : 'No se pudo eliminar.');
    }
  }

  return (
    <div className="pila">
      <div className="totales">
        <div>
          <p className="dato__etiqueta">{costa.concepto}</p>
          <p className="dato__valor">{costa.descripcion ?? '—'}</p>
        </div>
        <div>
          <p className="dato__etiqueta">Monto</p>
          <p className="dato__valor numero">{importe(costa.monto, costa.moneda)}</p>
        </div>
        <div>
          <p className="dato__etiqueta">Cobrado</p>
          <p className="dato__valor numero">{importe(costa.total_cobrado, costa.moneda)}</p>
        </div>
        <div>
          <p className="dato__etiqueta">Saldo</p>
          <p className="dato__valor numero">{importe(costa.saldo_pendiente, costa.moneda)}</p>
        </div>
      </div>
      <p className="texto-pequeno texto-tenue fila fila--envuelve" style={{ gap: 'var(--esp-2)' }}>
        <EstadoCobro estado={costa.estado_cobro} /> A cargo de: {aCargoLegible(costa.a_cargo_de)} · devengada el{' '}
        {fecha(costa.fecha_devengamiento)}
        {costa.fecha_vencimiento_pago && ` · vence el ${fecha(costa.fecha_vencimiento_pago)}`}
      </p>

      <div className="fila fila--envuelve" style={{ gap: 'var(--esp-2)' }}>
        {puede('costa.editar') && (
          <>
            <Boton pequeno icono={<Pencil size={14} aria-hidden />} onClick={alEditar}>
              Editar
            </Boton>
            {(conSaldo || costa.estado_cobro === 'INCOBRABLE') && (
              <Boton
                pequeno
                icono={costa.estado_cobro === 'INCOBRABLE' ? <Undo2 size={14} aria-hidden /> : <Ban size={14} aria-hidden />}
                onClick={() => void alternarIncobrable()}
                cargando={incobrable.isPending}
              >
                {costa.estado_cobro === 'INCOBRABLE' ? 'Volver a cobrar' : 'Marcar incobrable'}
              </Boton>
            )}
          </>
        )}
        {puede('costa.eliminar') && (
          <Boton pequeno variante="peligro" icono={<Trash2 size={14} aria-hidden />} onClick={() => setBorrando(true)}>
            Eliminar
          </Boton>
        )}
      </div>

      <h3 className="tarjeta__titulo">Cobros</h3>
      {cobros.length === 0 && <p className="texto-pequeno texto-tenue">Todavía no se registró ningún cobro.</p>}
      {cobros.length > 0 && (
        <div className="lista lista--encuadrada">
          {cobros.map((cobro) => (
            <div key={cobro.id} className="lista__item">
              <span className="lista__cuerpo">
                <span className="lista__titulo numero">{importe(cobro.monto, costa.moneda)}</span>
                <span className="lista__meta">
                  {fecha(cobro.fecha)} · {medioPagoLegible(cobro.medio_pago)}
                  {cobro.comprobante && ` · ${cobro.comprobante}`}
                  {cobro.registrado_por && ` · ${cobro.registrado_por}`}
                </span>
              </span>
              {puede('costa.eliminar') && (
                <span className="lista__lateral">
                  <Boton
                    pequeno
                    variante="sutil"
                    icono={<Trash2 size={14} aria-hidden />}
                    aria-label="Quitar el cobro"
                    title="Quitar el cobro"
                    onClick={() => void quitarCobro.mutateAsync(cobro.id).then(() => avisar('Cobro quitado.'))}
                  />
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {conSaldo && puede('costa.editar') && (
        <form onSubmit={cobrar} noValidate className="pila">
          {errorGeneral && (
            <div className="aviso aviso--peligro" role="alert">
              <span className="aviso__cuerpo">{errorGeneral}</span>
            </div>
          )}
          <div className="datos">
            <CampoTexto
              etiqueta="Monto cobrado"
              inputMode="decimal"
              value={monto}
              onChange={(e) => {
                setMonto(e.target.value);
                limpiarCampo('monto');
              }}
              placeholder={costa.saldo_pendiente}
              error={errores.monto?.[0]}
              obligatorio
            />
            <CampoTexto etiqueta="Fecha" type="date" value={fechaCobro} onChange={(e) => setFechaCobro(e.target.value)} error={errores.fecha?.[0]} />
            <CampoSelect etiqueta="Medio" value={medio} onChange={(e) => setMedio(e.target.value)} opciones={MEDIOS_PAGO} />
            <CampoTexto etiqueta="Comprobante" value={comprobante} onChange={(e) => setComprobante(e.target.value)} maxLength={100} />
          </div>
          <div>
            <Boton type="submit" variante="primario" icono={<Plus size={15} aria-hidden />} cargando={registrarCobro.isPending}>
              Registrar cobro
            </Boton>
          </div>
        </form>
      )}

      <DialogoConfirmar
        abierto={borrando}
        titulo="Eliminar la costa"
        mensaje={
          <>
            Se borra <strong>{costa.descripcion ?? costa.concepto}</strong> por {importe(costa.monto)}
            {cobros.length > 0 && <> junto con sus {cobros.length} cobros</>}. Queda registrado en la auditoría.
          </>
        }
        textoConfirmar="Eliminar"
        cargando={eliminar.isPending}
        error={errorBaja}
        alConfirmar={() => void confirmarBaja()}
        alCerrar={() => setBorrando(false)}
      />
    </div>
  );
}
