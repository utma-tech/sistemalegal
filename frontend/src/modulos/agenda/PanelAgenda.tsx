import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Ban,
  Bell,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  FolderOpen,
  History,
  Lock,
  MapPin,
  Pencil,
  RotateCcw,
  UserRound,
  Users,
  Video,
  X,
} from 'lucide-react';
import type { EventoAgenda, ItemAgenda } from '../../tipos/api';
import { useCambiarEstadoEvento, useEvento, useHistorialEvento } from '../../servicios/consultasAgenda';
import { useAvisos } from '../../componentes/ui/Avisos';
import { Boton } from '../../componentes/ui/Boton';
import { Etiqueta } from '../../componentes/ui/Etiqueta';
import { Modal } from '../../componentes/ui/Modal';
import { CampoArea } from '../../componentes/ui/Campo';
import { ErrorCarga, EsqueletoLista } from '../../componentes/ui/Estados';
import { fechaHora } from '../../lib/formato';
import { fechaDe, fechaLargaDia, horaDe, sumarDias, textoAnticipacion } from './calendario';
import { ESTADOS_EVENTO, ORDEN_TIPOS, TIPOS_AGENDA, VISIBILIDADES, esCritico, estaCerrado } from './vocabularioAgenda';

/**
 * Panel lateral de la agenda. Un solo panel con dos estados, en lugar de
 * varias tarjetas apiladas: sin selección muestra lo próximo y la leyenda;
 * con algo elegido, su detalle. Menos ruido y el calendario conserva el ancho.
 */

interface PropsPanel {
  seleccion: ItemAgenda | null;
  eventoId: string | null;
  proximos: ItemAgenda[];
  cargandoProximos: boolean;
  hoy: string;
  alCerrarSeleccion: () => void;
  alSeleccionar: (item: ItemAgenda) => void;
  alEditar: (evento: EventoAgenda) => void;
}

export function PanelAgenda(props: PropsPanel) {
  if (props.eventoId) {
    return <DetalleEvento id={props.eventoId} alCerrar={props.alCerrarSeleccion} alEditar={props.alEditar} />;
  }
  if (props.seleccion) {
    return <DetalleReferencia item={props.seleccion} alCerrar={props.alCerrarSeleccion} />;
  }
  return <Proximos {...props} />;
}

/* --- Sin selección --------------------------------------------------------------- */

const fmtCorto = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

function cuandoCorto(item: ItemAgenda, hoy: string): string {
  const dia = fechaDe(item.inicio);
  const hora = horaDe(item.inicio);
  const [a, m, d] = dia.split('-').map(Number);
  const corto = fmtCorto.format(new Date(Date.UTC(a!, m! - 1, d!, 12))).replace(/\./g, '');
  const fecha = dia === hoy ? 'Hoy' : dia === sumarDias(hoy, 1) ? 'Mañana' : corto.charAt(0).toUpperCase() + corto.slice(1);
  return hora && !item.todo_el_dia ? `${fecha} · ${hora}` : fecha;
}

function Proximos({ proximos, cargandoProximos, hoy, alSeleccionar }: PropsPanel) {
  const vencimientos = proximos.filter((item) => item.tipo === 'PLAZO').slice(0, 4);
  const compromisos = proximos.filter((item) => item.tipo !== 'PLAZO' && item.tipo !== 'INHABIL').slice(0, 6);

  const lista = (items: ItemAgenda[], vacio: string) =>
    items.length === 0 ? (
      <p className="panel-agenda__vacio">{vacio}</p>
    ) : (
      <ul className="panel-agenda__lista">
        {items.map((item) => {
          const Icono = esCritico(item) ? AlertTriangle : TIPOS_AGENDA[item.tipo].icono;
          return (
            <li key={item.clave}>
              <button
                type="button"
                className={`proximo ${TIPOS_AGENDA[item.tipo].clase}${esCritico(item) ? ' proximo--critico' : ''}`}
                onClick={() => alSeleccionar(item)}
              >
                <span className="proximo__marca" aria-hidden>
                  <Icono size={14} />
                </span>
                <span className="proximo__texto">
                  <span className="proximo__titulo">{item.titulo}</span>
                  <span className="proximo__cuando">
                    {cuandoCorto(item, hoy)}
                    {item.numero_expediente ? ` · Expte. ${item.numero_expediente}` : ''}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );

  return (
    <aside className="panel-agenda" aria-label="Próximos compromisos">
      <section className="panel-agenda__seccion">
        <h2 className="panel-agenda__titulo">Próximos compromisos</h2>
        {cargandoProximos ? <EsqueletoLista filas={3} /> : lista(compromisos, 'Nada agendado en los próximos 14 días.')}
      </section>
      <section className="panel-agenda__seccion">
        <h2 className="panel-agenda__titulo">Vencimientos</h2>
        {cargandoProximos ? <EsqueletoLista filas={2} /> : lista(vencimientos, 'Ningún plazo vence en los próximos 14 días.')}
      </section>
      <section className="panel-agenda__seccion panel-agenda__seccion--leyenda">
        <h2 className="panel-agenda__titulo">Referencias</h2>
        <ul className="leyenda-agenda">
          {ORDEN_TIPOS.map((tipo) => {
            const { corto, texto, clase, icono: Icono } = TIPOS_AGENDA[tipo];
            return (
              <li key={tipo} className={`leyenda-agenda__item ${clase}`} title={texto}>
                <span className="leyenda-agenda__muestra" aria-hidden>
                  <Icono size={11} />
                </span>
                {corto}
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}

/* --- Plazos, tareas y días inhábiles: se consultan acá, se editan en su módulo --- */

const DESTINO: Record<string, string> = {
  PLAZO: 'Abrir en el expediente',
  TAREA: 'Ir a tareas',
  DIA_INHABIL: 'Ver calendario judicial',
};

function DetalleReferencia({ item, alCerrar }: { item: ItemAgenda; alCerrar: () => void }) {
  const definicion = TIPOS_AGENDA[item.tipo];
  const Icono = definicion.icono;
  const estado = ESTADOS_EVENTO[item.estado];
  return (
    <aside className="panel-agenda" aria-label={`Detalle: ${item.titulo}`}>
      <div className="detalle-agenda">
        <CabeceraDetalle tipo={definicion.texto} clase={definicion.clase} Icono={Icono} alCerrar={alCerrar} />
        <h2 className="detalle-agenda__titulo">{item.titulo}</h2>
        <div className="detalle-agenda__etiquetas">
          {item.tipo !== 'INHABIL' && estado && <Etiqueta tono={estado.tono}>{estado.texto}</Etiqueta>}
          {esCritico(item) && (
            <Etiqueta tono="peligro">
              <AlertTriangle size={12} aria-hidden /> Crítico
            </Etiqueta>
          )}
        </div>
        <dl className="detalle-agenda__datos">
          <Dato icono={<Clock size={15} />} etiqueta="Fecha">
            {fechaLargaDia(fechaDe(item.inicio))}
            {item.origen === 'PLAZO' && <span className="detalle-agenda__nota">Vencimiento sin hora: rige el horario judicial.</span>}
          </Dato>
          {item.responsable && (
            <Dato icono={<UserRound size={15} />} etiqueta={item.origen === 'TAREA' ? 'Asignada a' : 'Responsable'} rotulo>
              {item.responsable}
            </Dato>
          )}
          {item.causa_id && (
            <Dato icono={<FolderOpen size={15} />} etiqueta="Expediente">
              <Link to={`/expedientes/${item.causa_id}`}>{item.numero_expediente ? `Expte. ${item.numero_expediente}` : 'Abrir'}</Link>
              {item.caratula && <span className="detalle-agenda__nota">{item.caratula}</span>}
            </Dato>
          )}
        </dl>
        <p className="detalle-agenda__ayuda">
          {item.origen === 'DIA_INHABIL'
            ? 'Los días inhábiles se administran en el calendario judicial y afectan el cómputo de plazos.'
            : 'Se consulta desde la agenda y se edita en su propio módulo, para no alterar el cómputo ni su historial.'}
        </p>
        <Link to={item.ruta} className="boton boton--secundario boton--bloque">
          <ExternalLink size={15} aria-hidden /> {DESTINO[item.origen]}
        </Link>
      </div>
    </aside>
  );
}

function CabeceraDetalle({
  tipo,
  clase,
  Icono,
  alCerrar,
}: {
  tipo: string;
  clase: string;
  Icono: typeof Clock;
  alCerrar: () => void;
}) {
  return (
    <div className="detalle-agenda__cabecera">
      <span className={`detalle-agenda__tipo ${clase}`}>
        <span className="detalle-agenda__tipo-marca" aria-hidden>
          <Icono size={13} />
        </span>
        {tipo}
      </span>
      <button type="button" className="boton boton--sutil boton--icono boton--pequeno" onClick={alCerrar} aria-label="Cerrar detalle">
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

function Dato({
  icono,
  etiqueta,
  rotulo = false,
  children,
}: {
  icono: React.ReactNode;
  etiqueta: string;
  /** Muestra la etiqueta debajo del valor, cuando el ícono solo no alcanza. */
  rotulo?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="detalle-agenda__dato">
      <dt>
        <span className="detalle-agenda__dato-icono" aria-hidden>
          {icono}
        </span>
        <span className="solo-lectores">{etiqueta}</span>
      </dt>
      <dd>
        {children}
        {rotulo && (
          <span className="detalle-agenda__nota" aria-hidden>
            {etiqueta}
          </span>
        )}
      </dd>
    </div>
  );
}

/* --- Evento propio de la agenda ---------------------------------------------------- */

function cuandoEvento(e: EventoAgenda): string {
  if (e.todo_el_dia) {
    return e.fecha_inicio === e.fecha_fin
      ? `${fechaLargaDia(e.fecha_inicio)} · todo el día`
      : `${fechaLargaDia(e.fecha_inicio)} al ${fechaLargaDia(e.fecha_fin)}`;
  }
  return e.fecha_inicio === e.fecha_fin
    ? `${fechaLargaDia(e.fecha_inicio)} · ${e.hora_inicio} a ${e.hora_fin}`
    : `${fechaLargaDia(e.fecha_inicio)} ${e.hora_inicio} al ${fechaLargaDia(e.fecha_fin)} ${e.hora_fin}`;
}

const TEXTO_ACCION: Record<string, string> = {
  CREADO: 'Creó el evento',
  EDITADO: 'Editó',
  REPROGRAMADO: 'Reprogramó',
  CONFIRMADO: 'Confirmó',
  COMPLETADO: 'Marcó como completado',
  CANCELADO: 'Canceló',
  REABIERTO: 'Reabrió',
};

function DetalleEvento({ id, alCerrar, alEditar }: { id: string; alCerrar: () => void; alEditar: (e: EventoAgenda) => void }) {
  const consulta = useEvento(id);
  const cambiar = useCambiarEstadoEvento(id);
  const { avisar } = useAvisos();
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [errorCancelar, setErrorCancelar] = useState<string>();
  const [verHistorial, setVerHistorial] = useState(false);
  const historial = useHistorialEvento(id, verHistorial);

  if (consulta.isPending) {
    return (
      <aside className="panel-agenda">
        <EsqueletoLista filas={5} />
      </aside>
    );
  }
  if (consulta.isError) {
    return (
      <aside className="panel-agenda">
        <div className="detalle-agenda__cabecera">
          <span />
          <button type="button" className="boton boton--sutil boton--icono boton--pequeno" onClick={alCerrar} aria-label="Cerrar detalle">
            <X size={16} aria-hidden />
          </button>
        </div>
        <ErrorCarga error={consulta.error} reintentar={() => void consulta.refetch()} />
      </aside>
    );
  }

  const e = consulta.data;
  const definicion = TIPOS_AGENDA[e.tipo];
  const estado = ESTADOS_EVENTO[e.estado]!;
  const abierto = !estaCerrado(e);

  async function aplicar(estadoNuevo: EventoAgenda['estado'], texto: string) {
    try {
      await cambiar.mutateAsync({ estado: estadoNuevo });
      avisar(texto);
    } catch (fallo) {
      avisar(fallo instanceof Error ? fallo.message : 'No se pudo actualizar el evento.', 'error');
    }
  }

  async function confirmarCancelacion() {
    setErrorCancelar(undefined);
    if (motivo.trim().length < 3) {
      setErrorCancelar('Indicá el motivo de la cancelación.');
      return;
    }
    try {
      await cambiar.mutateAsync({ estado: 'CANCELADO', motivo: motivo.trim() });
      avisar('Evento cancelado. Se avisó a los participantes.');
      setCancelando(false);
      setMotivo('');
    } catch (fallo) {
      setErrorCancelar(fallo instanceof Error ? fallo.message : 'No se pudo cancelar.');
    }
  }

  const visibilidad = VISIBILIDADES.find((v) => v.valor === e.visibilidad);

  return (
    <aside className="panel-agenda" aria-label={`Detalle: ${e.titulo}`}>
      <div className="detalle-agenda">
        <CabeceraDetalle tipo={definicion.texto} clase={definicion.clase} Icono={definicion.icono} alCerrar={alCerrar} />
        <h2 className={`detalle-agenda__titulo${e.estado === 'CANCELADO' ? ' detalle-agenda__titulo--cancelado' : ''}`}>{e.titulo}</h2>
        <div className="detalle-agenda__etiquetas">
          <Etiqueta tono={estado.tono}>{estado.texto}</Etiqueta>
          {e.prioridad === 'ALTA' && <Etiqueta tono="peligro">Prioridad alta</Etiqueta>}
          {e.visibilidad !== 'ESTUDIO' && (
            <Etiqueta tono="neutral" title={visibilidad?.ayuda}>
              <Lock size={11} aria-hidden /> {visibilidad?.texto}
            </Etiqueta>
          )}
        </div>

        <dl className="detalle-agenda__datos">
          <Dato icono={<Clock size={15} />} etiqueta="Cuándo">
            {cuandoEvento(e)}
          </Dato>
          {e.lugar && (
            <Dato icono={<MapPin size={15} />} etiqueta="Lugar">
              {e.lugar}
            </Dato>
          )}
          {e.enlace_virtual && (
            <Dato icono={<Video size={15} />} etiqueta="Reunión virtual">
              <a href={e.enlace_virtual} target="_blank" rel="noopener noreferrer">
                Unirse a la reunión
              </a>
            </Dato>
          )}
          {e.causa_id && (
            <Dato icono={<FolderOpen size={15} />} etiqueta="Expediente">
              <Link to={`/expedientes/${e.causa_id}`}>{e.numero_expediente ? `Expte. ${e.numero_expediente}` : 'Abrir expediente'}</Link>
              {e.caratula && <span className="detalle-agenda__nota">{e.caratula}</span>}
            </Dato>
          )}
          {e.persona && (
            <Dato icono={<UserRound size={15} />} etiqueta="Cliente o parte" rotulo>
              {e.persona}
            </Dato>
          )}
          <Dato icono={<UserRound size={15} />} etiqueta="Responsable" rotulo>
            {e.responsable ?? 'Sin responsable'}
          </Dato>
          {e.participantes.length > 0 && (
            <Dato icono={<Users size={15} />} etiqueta="Participantes" rotulo>
              {e.participantes.map((p) => p.nombre).join(', ')}
            </Dato>
          )}
          <Dato icono={<Bell size={15} />} etiqueta="Recordatorios" rotulo>
            {e.recordatorios.length ? e.recordatorios.map(textoAnticipacion).join(' · ') : 'Sin recordatorios'}
          </Dato>
        </dl>

        {e.estado === 'CANCELADO' && e.motivo_cancelacion && (
          <div className="aviso aviso--alerta">
            <span className="aviso__cuerpo">
              <strong>Cancelado</strong> {e.cancelado_en ? `el ${fechaHora(e.cancelado_en)}` : ''}: {e.motivo_cancelacion}
            </span>
          </div>
        )}

        {(e.descripcion || e.observaciones) && (
          <div className="detalle-agenda__texto">
            {e.descripcion && <p>{e.descripcion}</p>}
            {e.observaciones && (
              <p className="detalle-agenda__nota">
                <strong>Observaciones:</strong> {e.observaciones}
              </p>
            )}
          </div>
        )}

        {e.puede_editar && (
          <div className="detalle-agenda__acciones">
            {abierto ? (
              <>
                <Boton variante="primario" icono={<Pencil size={15} />} onClick={() => alEditar(e)}>
                  Editar
                </Boton>
                {e.estado === 'PENDIENTE' && (
                  <Boton icono={<Check size={15} />} onClick={() => void aplicar('CONFIRMADO', 'Evento confirmado.')} disabled={cambiar.isPending}>
                    Confirmar
                  </Boton>
                )}
                <Boton icono={<Check size={15} />} onClick={() => void aplicar('COMPLETADO', 'Evento completado.')} disabled={cambiar.isPending}>
                  Completar
                </Boton>
                {e.puede_cancelar && (
                  <Boton variante="sutil" icono={<Ban size={15} />} onClick={() => setCancelando(true)} disabled={cambiar.isPending}>
                    Cancelar evento
                  </Boton>
                )}
              </>
            ) : (
              <Boton icono={<RotateCcw size={15} />} onClick={() => void aplicar('PENDIENTE', 'Evento reabierto.')} cargando={cambiar.isPending}>
                Reabrir
              </Boton>
            )}
          </div>
        )}

        <div className="detalle-agenda__historial">
          <button
            type="button"
            className="detalle-agenda__desplegar"
            aria-expanded={verHistorial}
            onClick={() => setVerHistorial((v) => !v)}
          >
            <History size={14} aria-hidden /> Historial de cambios
            <ChevronDown size={14} aria-hidden className={verHistorial ? 'girado' : undefined} />
          </button>
          {verHistorial &&
            (historial.isPending ? (
              <EsqueletoLista filas={2} />
            ) : (
              <ol className="historial-evento">
                {(historial.data ?? []).map((h) => (
                  <li key={h.id} className="historial-evento__item">
                    <span className="historial-evento__accion">
                      {TEXTO_ACCION[h.accion] ?? h.accion}
                      {h.accion === 'REPROGRAMADO' && h.detalle.antes && h.detalle.despues && (
                        <>
                          {' '}
                          de {h.detalle.antes.inicio.replace(' ', ' · ')} a {h.detalle.despues.inicio.replace(' ', ' · ')}
                        </>
                      )}
                      {h.accion === 'EDITADO' && h.detalle.campos?.length ? `: ${h.detalle.campos.join(', ')}` : ''}
                    </span>
                    {h.motivo && <span className="historial-evento__motivo">“{h.motivo}”</span>}
                    <span className="historial-evento__meta">
                      {h.usuario ?? 'Sistema'} · {fechaHora(h.creado_en)}
                    </span>
                  </li>
                ))}
              </ol>
            ))}
        </div>

        <p className="detalle-agenda__meta">
          Creado por {e.creado_por ?? '—'} el {fechaHora(e.creado_en)}
          {e.actualizado_por && e.actualizado_en !== e.creado_en ? ` · modificado por ${e.actualizado_por}` : ''}
        </p>
      </div>

      <Modal
        abierto={cancelando}
        alCerrar={() => {
          setCancelando(false);
          setErrorCancelar(undefined);
        }}
        titulo="Cancelar el evento"
        descripcion="Se cancelan los recordatorios pendientes y se avisa a los participantes. El evento queda en el historial y se puede reabrir."
        pie={
          <>
            <Boton onClick={() => setCancelando(false)} disabled={cambiar.isPending}>
              Volver
            </Boton>
            <Boton variante="peligro" onClick={() => void confirmarCancelacion()} cargando={cambiar.isPending}>
              Cancelar evento
            </Boton>
          </>
        }
      >
        <div className="pila">
          {errorCancelar && (
            <div className="aviso aviso--peligro" role="alert">
              <span className="aviso__cuerpo">{errorCancelar}</span>
            </div>
          )}
          <CampoArea
            etiqueta="Motivo de la cancelación"
            value={motivo}
            onChange={(ev) => setMotivo(ev.target.value)}
            placeholder="Por ejemplo: el juzgado suspendió la audiencia."
            maxLength={300}
            obligatorio
            autoFocus
          />
        </div>
      </Modal>
    </aside>
  );
}
