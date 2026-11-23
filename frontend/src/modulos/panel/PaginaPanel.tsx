import { Link, useNavigate } from 'react-router-dom';
import {
  AlarmClock,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  FolderOpen,
  History,
  ListChecks,
  Plus,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { usePanel } from '../../servicios/consultas';
import { useSesion } from '../auth/ContextoSesion';
import { CabeceraPagina } from '../../componentes/ui/CabeceraPagina';
import { Tarjeta } from '../../componentes/ui/Tarjeta';
import { Boton } from '../../componentes/ui/Boton';
import { EstadoTarea, Etiqueta, Prioridad, Vencimiento } from '../../componentes/ui/Etiqueta';
import { Cargando, ErrorCarga, Vacio } from '../../componentes/ui/Estados';
import { enDias, fecha, fechaLarga, haceCuanto, hora, importe, legible } from '../../lib/formato';
import type { PlazoProximo } from '../../tipos/api';

/**
 * Panel de inicio.
 *
 * Responde, en este orden, las preguntas con las que un abogado abre el
 * sistema: qué requiere atención, qué tengo que hacer, qué pasó y qué viene.
 * Cuatro bandas, cada una con menos peso visual que la anterior: bienvenida,
 * indicadores, prioridades, y actividad y agenda.
 *
 * Todas las cifras vienen de /api/panel, calculadas sobre la base y recortadas
 * según los permisos de quien consulta.
 */

function saludo(): string {
  const horaActual = new Date().getHours();
  if (horaActual < 13) return 'Buen día';
  if (horaActual < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

function plural(cantidad: number, singular: string, pluralTexto: string): string {
  return `${cantidad} ${cantidad === 1 ? singular : pluralTexto}`;
}

type TonoIndicador = 'neutral' | 'alerta' | 'peligro';

interface PropsIndicador {
  valor: number | string;
  etiqueta: string;
  descripcion: string;
  icono: LucideIcon;
  tono?: TonoIndicador;
  ruta?: string;
}

/**
 * Una cifra del estudio. El tono solo cambia cuando la cifra pide una acción:
 * rojo si algo ya venció, ámbar si algo vence pronto. El resto queda en
 * grafito, para que el color siga significando algo.
 */
function Indicador({ valor, etiqueta, descripcion, icono: Icono, tono = 'neutral', ruta }: PropsIndicador) {
  // Un importe formateado ocupa mucho más que un conteo: se achica para que no
  // ensanche la tarjeta y descuadre la fila.
  const valorLargo = String(valor).length > 6;
  const clases = `indicador${tono === 'neutral' ? '' : ` indicador--${tono}`}`;

  const contenido = (
    <>
      <span className="indicador__cabecera">
        <span className="indicador__icono" aria-hidden>
          <Icono size={16} strokeWidth={1.9} />
        </span>
        <span className="indicador__etiqueta">{etiqueta}</span>
      </span>
      <span className={`indicador__valor numero${valorLargo ? ' indicador__valor--largo' : ''}`}>{valor}</span>
      <span className="indicador__pie">{descripcion}</span>
    </>
  );

  // Cuando el indicador lleva a algún lado se vuelve un enlace completo: el
  // blanco de clic es la tarjeta entera, no un enlace chiquito adentro.
  return ruta ? (
    <Link to={ruta} className={clases}>
      {contenido}
    </Link>
  ) : (
    <div className={clases}>{contenido}</div>
  );
}

/** Fila de un plazo: qué, en qué expediente, quién, cuándo y cómo está. */
function FilaPlazo({ plazo }: { plazo: PlazoProximo }) {
  const vencido = plazo.dias_restantes < 0;
  return (
    <Link
      to={`/expedientes/${plazo.causa_id}`}
      className={`lista__item${vencido ? ' lista__item--critico' : ''}`}
    >
      <span className="lista__cuerpo">
        <span className="lista__titulo" title={plazo.descripcion}>
          {plazo.descripcion}
        </span>
        <span className="lista__meta" title={plazo.caratula}>
          {plazo.numero_expediente ?? 'Sin radicar'} · {plazo.caratula}
          {plazo.responsable && ` · ${plazo.responsable}`}
        </span>
      </span>
      <span className="lista__lateral">
        <span className="texto-pequeno texto-tenue numero">{fecha(plazo.fecha_vencimiento)}</span>
        <Vencimiento dias={plazo.dias_restantes} texto={enDias(plazo.dias_restantes)} />
        <ChevronRight size={16} className="lista__flecha" aria-hidden />
      </span>
    </Link>
  );
}

export function PaginaPanel() {
  const { usuario, puede } = useSesion();
  const { data, isPending, isError, error, refetch } = usePanel();
  const navegar = useNavigate();

  const hoy = new Date().toISOString().slice(0, 10);
  const titulo = `${saludo()}, ${usuario?.nombre ?? ''}`;

  const accion = puede('causa.crear') ? (
    <Boton
      variante="primario"
      // El alta vive en el listado de expedientes, que es donde se ve el
      // resultado; el panel solo lleva hasta ahí, con el formulario abierto.
      onClick={() => navegar('/expedientes?nueva=1')}
      icono={<Plus size={16} aria-hidden />}
    >
      Nuevo expediente
    </Boton>
  ) : undefined;

  if (isPending) {
    return (
      <>
        <CabeceraPagina titulo={titulo} descripcion={fechaLarga(hoy)} />
        <Cargando texto="Preparando tu panel…" />
      </>
    );
  }

  if (isError) {
    return (
      <>
        <CabeceraPagina titulo={titulo} descripcion={fechaLarga(hoy)} />
        <Tarjeta>
          <ErrorCarga error={error} reintentar={() => void refetch()} />
        </Tarjeta>
      </>
    );
  }

  const { indicadores, plazosProximos, tareas, eventos, actividad, causasRecientes, finanzas, diasHorizonte } =
    data;

  const vencidos = plazosProximos.filter((plazo) => plazo.dias_restantes < 0);
  const proximos = plazosProximos.filter((plazo) => plazo.dias_restantes >= 0);

  // Una sola frase que dice qué mirar primero. Si no hay nada urgente, lo dice.
  const resumen =
    indicadores.plazos_vencidos > 0 ? (
      <>
        Tenés{' '}
        <strong className="texto-peligro">
          {plural(indicadores.plazos_vencidos, 'plazo vencido', 'plazos vencidos')}
        </strong>{' '}
        que {indicadores.plazos_vencidos === 1 ? 'requiere' : 'requieren'} atención.
      </>
    ) : indicadores.plazos_por_vencer > 0 ? (
      <>
        <strong>{plural(indicadores.plazos_por_vencer, 'plazo vence', 'plazos vencen')}</strong> en los próximos{' '}
        {diasHorizonte} días.
      </>
    ) : (
      <>No hay plazos vencidos ni por vencer en los próximos {diasHorizonte} días.</>
    );

  return (
    <>
      {/* A — Bienvenida */}
      <header className="bienvenida">
        <div style={{ minWidth: 0 }}>
          <h1 className="bienvenida__titulo">{titulo}</h1>
          <p className="bienvenida__resumen">
            <span className="bienvenida__fecha">{fechaLarga(hoy)}</span> · {resumen}
          </p>
        </div>
        {accion && <div className="pagina__acciones">{accion}</div>}
      </header>

      {/* B — Indicadores */}
      <section className="rejilla-indicadores" aria-label="Indicadores del estudio">
        <Indicador
          valor={indicadores.plazos_vencidos}
          etiqueta="Vencimientos incumplidos"
          descripcion={indicadores.plazos_vencidos > 0 ? 'Requieren atención' : 'Todo al día'}
          icono={CircleAlert}
          tono={indicadores.plazos_vencidos > 0 ? 'peligro' : 'neutral'}
          ruta={puede('plazo.ver') ? '/agenda' : undefined}
        />
        <Indicador
          valor={indicadores.plazos_por_vencer}
          etiqueta="Plazos próximos"
          descripcion={`En los próximos ${diasHorizonte} días`}
          icono={AlarmClock}
          tono={indicadores.plazos_por_vencer > 0 ? 'alerta' : 'neutral'}
          ruta={puede('plazo.ver') ? `/agenda?rango=${diasHorizonte <= 7 ? '7' : '30'}` : undefined}
        />
        <Indicador
          valor={indicadores.causas_activas}
          etiqueta="Expedientes activos"
          descripcion="En trámite en el estudio"
          icono={FolderOpen}
          ruta={puede('causa.ver') ? '/expedientes?vigencia=activas' : undefined}
        />
        <Indicador
          valor={indicadores.mis_tareas_abiertas}
          etiqueta="Mis tareas abiertas"
          descripcion={`${indicadores.tareas_abiertas} en todo el estudio`}
          icono={ListChecks}
          ruta={puede('tarea.ver') ? '/tareas' : undefined}
        />
        {/* El bloque financiero solo llega si el backend decidió que este
            usuario puede verlo. */}
        {finanzas && (
          <Indicador
            valor={importe(finanzas.saldo_pendiente)}
            etiqueta="Saldo pendiente de cobro"
            descripcion={plural(finanzas.costas_pendientes, 'costa pendiente', 'costas pendientes')}
            icono={Wallet}
            ruta={puede('costa.ver') ? '/costas' : undefined}
          />
        )}
      </section>

      {/* C — Prioridades */}
      <section className="seccion-panel" aria-labelledby="titulo-prioridades">
        <h2 className="seccion-panel__titulo" id="titulo-prioridades">
          Prioridades
        </h2>
        <div className="rejilla-prioridades">
          <Tarjeta
            titulo="Vencimientos"
            descripcion={`Incumplidos y los que vencen en los próximos ${diasHorizonte} días.`}
            accion={
              puede('plazo.ver') ? (
                <Link to="/agenda" className="texto-pequeno">
                  Ver agenda
                </Link>
              ) : undefined
            }
            sinRelleno
          >
            <p className="subgrupo subgrupo--peligro">
              Incumplidos <span className="subgrupo__cantidad">{vencidos.length}</span>
            </p>
            {vencidos.length === 0 ? (
              <p className="subgrupo__vacio">Ningún plazo vencido sin cumplir.</p>
            ) : (
              <div className="lista">
                {vencidos.map((plazo) => (
                  <FilaPlazo key={plazo.id} plazo={plazo} />
                ))}
              </div>
            )}

            <p className="subgrupo">
              Próximos <span className="subgrupo__cantidad">{proximos.length}</span>
            </p>
            {proximos.length === 0 ? (
              <p className="subgrupo__vacio">Ningún plazo vence en los próximos {diasHorizonte} días.</p>
            ) : (
              <div className="lista">
                {proximos.map((plazo) => (
                  <FilaPlazo key={plazo.id} plazo={plazo} />
                ))}
              </div>
            )}
          </Tarjeta>

          <Tarjeta
            titulo="Tareas abiertas"
            descripcion="Las tuyas primero."
            accion={
              puede('tarea.ver') ? (
                <Link to="/tareas" className="texto-pequeno">
                  Ver todas
                </Link>
              ) : undefined
            }
            sinRelleno
          >
            {tareas.length === 0 ? (
              <Vacio titulo="Sin tareas pendientes" icono={<ListChecks size={20} aria-hidden />} />
            ) : (
              <div className="lista">
                {tareas.map((tarea) => {
                  const contenido = (
                    <>
                      <span className="lista__cuerpo">
                        <span className="lista__titulo" title={tarea.titulo}>
                          {tarea.titulo}
                        </span>
                        <span className="lista__meta" title={tarea.caratula ?? undefined}>
                          {tarea.es_mia ? 'Asignada a vos' : (tarea.asignada_a ?? 'Sin asignar')}
                          {tarea.fecha_vencimiento && ` · vence ${fecha(tarea.fecha_vencimiento)}`}
                          {tarea.caratula && ` · ${tarea.caratula}`}
                        </span>
                      </span>
                      <span className="lista__lateral">
                        <Prioridad prioridad={tarea.prioridad} />
                        <EstadoTarea estado={tarea.estado} />
                        {tarea.causa_id && <ChevronRight size={16} className="lista__flecha" aria-hidden />}
                      </span>
                    </>
                  );
                  // Con expediente, la fila abre el expediente; sin él, no hay
                  // detalle al que ir y la fila no finge ser un enlace.
                  return tarea.causa_id ? (
                    <Link key={tarea.id} to={`/expedientes/${tarea.causa_id}`} className="lista__item">
                      {contenido}
                    </Link>
                  ) : (
                    <div key={tarea.id} className="lista__item">
                      {contenido}
                    </div>
                  );
                })}
              </div>
            )}
          </Tarjeta>
        </div>
      </section>

      {/* D — Actividad y agenda */}
      <section className="seccion-panel" aria-labelledby="titulo-contexto">
        <h2 className="seccion-panel__titulo" id="titulo-contexto">
          Actividad y agenda
        </h2>
        <div className="rejilla-contexto">
          <Tarjeta titulo="Últimos movimientos procesales">
            {actividad.length === 0 ? (
              <Vacio
                titulo="Todavía no hay movimientos"
                texto="Cuando se registren movimientos en los expedientes, aparecen acá."
                icono={<History size={20} aria-hidden />}
              />
            ) : (
              <ol className="linea-tiempo">
                {actividad.map((item) => (
                  <li key={item.id} className="linea-tiempo__item">
                    <span className="linea-tiempo__marca" aria-hidden>
                      <History size={13} />
                    </span>
                    <div className="linea-tiempo__contenido">
                      <div className="linea-tiempo__encabezado">
                        <span className="linea-tiempo__titulo">{item.tipo ?? 'Movimiento'}</span>
                        <span className="linea-tiempo__fecha">{fecha(item.fecha)}</span>
                      </div>
                      <p className="linea-tiempo__descripcion">{item.descripcion}</p>
                      <p className="linea-tiempo__meta">
                        <Link to={`/expedientes/${item.causa_id}`}>{item.caratula}</Link>
                        {item.registrado_por && ` · registrado por ${item.registrado_por}`}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Tarjeta>

          <div className="pila pila--panel">
            <Tarjeta titulo="Agenda" descripcion={`Audiencias y eventos de los próximos ${diasHorizonte} días.`} sinRelleno>
              {eventos.length === 0 ? (
                <p className="subgrupo__vacio subgrupo__vacio--suelto">
                  <CalendarDays size={15} aria-hidden /> Sin audiencias ni eventos próximos.
                </p>
              ) : (
                <div className="lista">
                  {eventos.map((evento) => (
                    <div key={evento.id} className="lista__item">
                      <span className="lista__cuerpo">
                        <span className="lista__titulo" title={evento.titulo}>
                          {evento.titulo}
                        </span>
                        <span className="lista__meta">
                          {fecha(evento.fecha_inicio)}
                          {!evento.todo_el_dia && ` · ${hora(evento.fecha_inicio)}`}
                          {evento.lugar && ` · ${evento.lugar}`}
                        </span>
                      </span>
                      <span className="lista__lateral">
                        <Etiqueta tono={evento.tipo === 'AUDIENCIA' ? 'info' : 'neutral'}>
                          {legible(evento.tipo)}
                        </Etiqueta>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Tarjeta>

            <Tarjeta
              titulo="Expedientes recientes"
              accion={
                puede('causa.ver') ? (
                  <Link to="/expedientes" className="texto-pequeno">
                    Ver todos
                  </Link>
                ) : undefined
              }
              sinRelleno
            >
              {causasRecientes.length === 0 ? (
                <Vacio titulo="Todavía no hay expedientes" icono={<FolderOpen size={20} aria-hidden />} />
              ) : (
                <div className="lista">
                  {causasRecientes.map((causa) => (
                    <Link key={causa.id} to={`/expedientes/${causa.id}`} className="lista__item">
                      <span className="lista__cuerpo">
                        <span className="lista__titulo" title={causa.caratula}>
                          {causa.caratula}
                        </span>
                        <span className="lista__meta">
                          {causa.fuero} · modificado {haceCuanto(causa.actualizado_en)}
                        </span>
                      </span>
                      <ChevronRight size={16} className="lista__flecha" aria-hidden />
                    </Link>
                  ))}
                </div>
              )}
            </Tarjeta>
          </div>
        </div>
      </section>
    </>
  );
}
