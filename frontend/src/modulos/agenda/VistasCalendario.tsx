import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Plus } from 'lucide-react';
import type { ItemAgenda } from '../../tipos/api';
import { Etiqueta } from '../../componentes/ui/Etiqueta';
import {
  NOMBRES_DIAS,
  disponerDia,
  fechaDe,
  fechaLargaDia,
  horaDe,
  nombreDiaCorto,
  ocupaDia,
  ordenarDelDia,
  semanasDelMes,
  sumarDias,
  minutos as aMinutos,
} from './calendario';
import { ESTADOS_EVENTO, TIPOS_AGENDA, esCritico, estaCerrado } from './vocabularioAgenda';

/**
 * Las cuatro vistas de la agenda: mes, semana, día (la de semana con una
 * columna) y agenda (lista cronológica).
 *
 * Son componentes de presentación: reciben los elementos ya filtrados y
 * avisan qué se eligió. No piden datos ni conocen la URL.
 */

export interface PropsVista {
  items: ItemAgenda[];
  hoy: string;
  seleccion: string | null;
  alSeleccionar: (item: ItemAgenda) => void;
  /** Ausente si quien mira no puede crear eventos. */
  alCrear?: (fecha: string, hora?: string) => void;
}

function rangoHorario(item: ItemAgenda): string {
  if (item.todo_el_dia) {
    return fechaDe(item.inicio) === fechaDe(item.fin) ? 'Todo el día' : 'Varios días';
  }
  const desde = horaDe(item.inicio);
  const hasta = horaDe(item.fin);
  return hasta && fechaDe(item.inicio) === fechaDe(item.fin) ? `${desde} – ${hasta}` : `${desde}`;
}

function descripcionAccesible(item: ItemAgenda): string {
  const tipo = TIPOS_AGENDA[item.tipo].texto;
  const estado = ESTADOS_EVENTO[item.estado]?.texto;
  return [tipo, item.titulo, rangoHorario(item), estado, esCritico(item) ? 'crítico' : null].filter(Boolean).join(', ');
}

function clasesElemento(base: string, item: ItemAgenda, seleccion: string | null): string {
  return [
    base,
    TIPOS_AGENDA[item.tipo].clase,
    esCritico(item) ? `${base}--critico` : '',
    estaCerrado(item) ? `${base}--cerrado` : '',
    item.estado === 'CANCELADO' || item.estado === 'CANCELADA' ? `${base}--cancelado` : '',
    seleccion === item.clave ? `${base}--elegido` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Ficha compacta de un elemento: celda del mes, fila de día completo. */
export function Chip({
  item,
  seleccion,
  alSeleccionar,
  conHora = true,
}: {
  item: ItemAgenda;
  seleccion: string | null;
  alSeleccionar: (item: ItemAgenda) => void;
  conHora?: boolean;
}) {
  const Icono = TIPOS_AGENDA[item.tipo].icono;
  const hora = !item.todo_el_dia ? horaDe(item.inicio) : null;
  return (
    <button
      type="button"
      className={clasesElemento('chip-agenda', item, seleccion)}
      onClick={(evento) => {
        evento.stopPropagation();
        alSeleccionar(item);
      }}
      aria-label={descripcionAccesible(item)}
      aria-pressed={seleccion === item.clave}
      title={item.titulo}
    >
      {esCritico(item) ? (
        <AlertTriangle size={12} aria-hidden className="chip-agenda__icono" />
      ) : estaCerrado(item) ? (
        <Check size={12} aria-hidden className="chip-agenda__icono" />
      ) : hora && conHora ? (
        <span className="chip-agenda__punto" aria-hidden />
      ) : (
        <Icono size={12} aria-hidden className="chip-agenda__icono" />
      )}
      {conHora && hora && <span className="chip-agenda__hora">{hora}</span>}
      <span className="chip-agenda__titulo">{item.titulo}</span>
    </button>
  );
}

/* --- Mes ------------------------------------------------------------------------- */

const MAXIMO_POR_CELDA = 3;

export function VistaMes({
  fecha,
  alVerDia,
  ...props
}: PropsVista & { fecha: string; alVerDia: (fecha: string) => void }) {
  const semanas = useMemo(() => semanasDelMes(fecha), [fecha]);
  const mes = fecha.slice(0, 7);

  return (
    <div className="mes" role="grid" aria-label="Calendario mensual">
      <div className="mes__cabecera" role="row">
        {NOMBRES_DIAS.map((dia) => (
          <div key={dia} className="mes__nombre-dia" role="columnheader">
            {dia}
          </div>
        ))}
      </div>
      {semanas.map((semana) => (
        <div key={semana[0]} className="mes__semana" role="row">
          {semana.map((dia) => {
            const delDia = ordenarDelDia(props.items.filter((item) => ocupaDia(item, dia)));
            const inhabil = delDia.find((item) => item.tipo === 'INHABIL');
            const visibles = delDia.filter((item) => item.tipo !== 'INHABIL');
            const sobran = visibles.length > MAXIMO_POR_CELDA ? visibles.length - (MAXIMO_POR_CELDA - 1) : 0;
            const mostrados = sobran ? visibles.slice(0, MAXIMO_POR_CELDA - 1) : visibles;
            const clases = [
              'mes__dia',
              dia.slice(0, 7) !== mes ? 'mes__dia--fuera' : '',
              dia === props.hoy ? 'mes__dia--hoy' : '',
              inhabil ? 'mes__dia--inhabil' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <div key={dia} className={clases} role="gridcell" aria-label={fechaLargaDia(dia)}>
                <div className="mes__dia-cabecera">
                  <button
                    type="button"
                    className="mes__numero"
                    onClick={() => alVerDia(dia)}
                    aria-label={`Ver el ${fechaLargaDia(dia)}`}
                    aria-current={dia === props.hoy ? 'date' : undefined}
                  >
                    {Number(dia.slice(8))}
                  </button>
                  {inhabil && (
                    <span className="mes__inhabil" title={inhabil.titulo}>
                      Inhábil
                    </span>
                  )}
                  {props.alCrear && (
                    <button
                      type="button"
                      className="mes__crear"
                      onClick={() => props.alCrear!(dia)}
                      aria-label={`Nuevo evento el ${fechaLargaDia(dia)}`}
                      title="Nuevo evento"
                    >
                      <Plus size={13} aria-hidden />
                    </button>
                  )}
                </div>
                <div className="mes__elementos">
                  {mostrados.map((item) => (
                    <Chip key={item.clave} item={item} seleccion={props.seleccion} alSeleccionar={props.alSeleccionar} />
                  ))}
                  {sobran > 0 && (
                    <button type="button" className="mes__mas" onClick={() => alVerDia(dia)}>
                      + {sobran} más
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* --- Semana y día ---------------------------------------------------------------- */

const ALTO_HORA = 48;
// La grilla cubre la jornada del estudio. Un compromiso que cae afuera se
// muestra pegado al borde más cercano, para que no desaparezca de la vista.
const HORA_INICIAL = 7;
const HORA_FINAL = 22;
const HORAS_VISIBLES = HORA_FINAL - HORA_INICIAL;
const INICIO_GRILLA = HORA_INICIAL * 60;
const FIN_GRILLA = HORA_FINAL * 60;
const DURACION_MINIMA = 30;

/** Lleva un tramo del día (en minutos) a la porción visible de la grilla. */
function recortarAGrilla(desde: number, hasta: number) {
  const inicio = Math.min(Math.max(desde, INICIO_GRILLA), FIN_GRILLA - DURACION_MINIMA);
  const fin = Math.max(Math.min(hasta, FIN_GRILLA), inicio + DURACION_MINIMA);
  return { inicio, fin };
}

const aPixeles = (minutosDelDia: number) => ((minutosDelDia - INICIO_GRILLA) / 60) * ALTO_HORA;

export function VistaHoraria({
  dias,
  ahora,
  alVerDia,
  ...props
}: PropsVista & { dias: string[]; ahora: string; alVerDia?: (fecha: string) => void }) {
  const desplazable = useRef<HTMLDivElement>(null);
  const [anchoDia, setAnchoDia] = useState(0);
  const horaActual = horaDe(ahora);

  // El ancho de cada día decide cuántas columnas entran sin volver ilegible un bloque.
  useEffect(() => {
    const elemento = desplazable.current;
    if (!elemento) return;
    const medir = () => setAnchoDia((elemento.clientWidth - 56) / dias.length);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(elemento);
    return () => observador.disconnect();
  }, [dias.length]);
  const hoy = fechaDe(ahora);

  // Al cambiar de vista, la grilla vuelve a mostrar el comienzo de la jornada.
  useEffect(() => {
    if (desplazable.current) desplazable.current.scrollTop = 0;
  }, [dias.length]);

  const deDiaCompleto = dias.map((dia) =>
    ordenarDelDia(props.items.filter((item) => item.todo_el_dia && ocupaDia(item, dia))),
  );
  const hayDiaCompleto = deDiaCompleto.some((lista) => lista.length > 0);

  return (
    <div className={`horaria horaria--${dias.length === 1 ? 'dia' : 'semana'}`} style={{ ['--dias' as string]: dias.length }}>
      <div className="horaria__cabecera">
        <div className="horaria__esquina" aria-hidden />
        {dias.map((dia) => (
          <div key={dia} className={`horaria__dia${dia === props.hoy ? ' horaria__dia--hoy' : ''}`}>
            {alVerDia && dias.length > 1 ? (
              <button type="button" className="horaria__dia-boton" onClick={() => alVerDia(dia)} aria-label={`Ver el ${fechaLargaDia(dia)}`}>
                <span className="horaria__dia-nombre">{nombreDiaCorto(dia)}</span>
                <span className="horaria__dia-numero">{Number(dia.slice(8))}</span>
              </button>
            ) : (
              <span className="horaria__dia-boton">
                <span className="horaria__dia-nombre">{nombreDiaCorto(dia)}</span>
                <span className="horaria__dia-numero">{Number(dia.slice(8))}</span>
              </span>
            )}
          </div>
        ))}
      </div>

      {hayDiaCompleto && (
        <div className="horaria__todo-el-dia">
          <div className="horaria__rotulo">Todo el día</div>
          {deDiaCompleto.map((lista, i) => (
            <div key={dias[i]} className="horaria__celda-dia">
              {lista.map((item) => (
                <Chip key={item.clave} item={item} seleccion={props.seleccion} alSeleccionar={props.alSeleccionar} />
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="horaria__cuerpo" ref={desplazable}>
        <div className="horaria__grilla" style={{ height: HORAS_VISIBLES * ALTO_HORA }}>
          <div className="horaria__horas" aria-hidden>
            {Array.from({ length: HORAS_VISIBLES + 1 }, (_, i) => HORA_INICIAL + i).map((h) => (
              <div key={h} className="horaria__hora" style={{ top: (h - HORA_INICIAL) * ALTO_HORA }}>
                {`${String(h).padStart(2, '0')}:00`}
              </div>
            ))}
          </div>
          {dias.map((dia) => {
            const todos = disponerDia(props.items, dia);
            // En la semana cada día es angosto: más de dos columnas vuelven
            // ilegibles los bloques. Lo que no entra se resume en "+N" y abre el día.
            const tope = dias.length === 1 ? 6 : anchoDia >= 170 ? 2 : 1;
            // Con una sola columna se muestra el primero a todo el ancho y el resto
            // se resume; con más, la última columna queda para el resumen.
            const visibles = Math.max(tope - 1, 1);
            const bloques = todos
              .filter((b) => b.columnas <= tope || b.columna < visibles)
              .map((b) => ({ ...b, columnas: b.columnas <= tope ? b.columnas : tope === 1 ? 1 : tope }));
            const resumidos = new Map<number, { desde: number; cantidad: number }>();
            for (const b of todos) {
              if (b.columnas > tope && b.columna >= visibles) {
                const previo = resumidos.get(b.grupo);
                resumidos.set(b.grupo, {
                  desde: Math.min(previo?.desde ?? b.desde, b.desde),
                  cantidad: (previo?.cantidad ?? 0) + 1,
                });
              }
            }
            return (
              <div
                key={dia}
                className={`horaria__columna${dia === props.hoy ? ' horaria__columna--hoy' : ''}`}
                onClick={
                  props.alCrear
                    ? (evento) => {
                        const rect = evento.currentTarget.getBoundingClientRect();
                        const hora = Math.max(
                          HORA_INICIAL,
                          Math.min(HORA_FINAL - 1, HORA_INICIAL + Math.floor((evento.clientY - rect.top) / ALTO_HORA)),
                        );
                        props.alCrear!(dia, `${String(hora).padStart(2, '0')}:00`);
                      }
                    : undefined
                }
              >
                {bloques.map(({ item, desde, hasta, columna, columnas, grupo }) => {
                  const Icono = TIPOS_AGENDA[item.tipo].icono;
                  const { inicio, fin } = recortarAGrilla(desde, hasta);
                  const alto = ((fin - inicio) / 60) * ALTO_HORA;
                  const conResumen = tope === 1 && resumidos.has(grupo);
                  return (
                    <button
                      key={item.clave}
                      type="button"
                      className={`${clasesElemento('bloque-agenda', item, props.seleccion)}${conResumen ? ' bloque-agenda--con-resumen' : ''}`}
                      style={{
                        top: aPixeles(inicio),
                        height: alto - 2,
                        left: `calc(${(columna / columnas) * 100}% + 2px)`,
                        width: `calc(${100 / columnas}% - 4px)`,
                      }}
                      onClick={(evento) => {
                        evento.stopPropagation();
                        props.alSeleccionar(item);
                      }}
                      aria-label={descripcionAccesible(item)}
                      aria-pressed={props.seleccion === item.clave}
                    >
                      {alto >= 40 ? (
                        <>
                          <span className="bloque-agenda__hora">
                            <Icono size={11} aria-hidden /> {dias.length > 1 && anchoDia < 150 ? horaDe(item.inicio) : rangoHorario(item)}
                          </span>
                          <span className="bloque-agenda__titulo">{item.titulo}</span>
                        </>
                      ) : (
                        <span className="bloque-agenda__titulo">
                          <span className="bloque-agenda__hora">{horaDe(item.inicio)}</span> {item.titulo}
                        </span>
                      )}
                      {alto >= 72 && item.lugar && <span className="bloque-agenda__lugar">{item.lugar}</span>}
                    </button>
                  );
                })}
                {[...resumidos.values()].map(({ desde, cantidad }) => (
                  <button
                    key={`mas-${desde}`}
                    type="button"
                    className={`bloque-agenda__mas${tope === 1 ? ' bloque-agenda__mas--encima' : ''}`}
                    style={{ top: aPixeles(recortarAGrilla(desde, desde).inicio) + (tope === 1 ? 3 : 0) }}
                    onClick={(evento) => {
                      evento.stopPropagation();
                      alVerDia?.(dia);
                    }}
                    aria-label={`${cantidad} compromisos superpuestos más. Ver el día.`}
                    title="Ver todos en la vista del día"
                  >
                    +{cantidad}
                  </button>
                ))}
                {dia === hoy && horaActual && aMinutos(horaActual) >= INICIO_GRILLA && aMinutos(horaActual) <= FIN_GRILLA && (
                  <div className="horaria__ahora" style={{ top: aPixeles(aMinutos(horaActual)) }} aria-hidden />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* --- Agenda (lista) ---------------------------------------------------------------- */

export function VistaListado({ desde, hasta, ...props }: PropsVista & { desde: string; hasta: string }) {
  const grupos = useMemo(() => {
    const mapa = new Map<string, ItemAgenda[]>();
    for (const item of props.items) {
      // Un evento que empezó antes del rango se lista en el primer día visible.
      const dia = fechaDe(item.inicio) < desde ? desde : fechaDe(item.inicio);
      if (dia > hasta) continue;
      mapa.set(dia, [...(mapa.get(dia) ?? []), item]);
    }
    return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dia, items]) => ({ dia, items: ordenarDelDia(items) }));
  }, [props.items, desde, hasta]);

  if (grupos.length === 0) {
    return (
      <div className="listado-agenda__vacio">
        <p className="listado-agenda__vacio-titulo">Nada agendado en este período</p>
        <p>Probá con otro rango o quitá algún filtro.</p>
      </div>
    );
  }

  return (
    <div className="listado-agenda">
      {grupos.map(({ dia, items }) => (
        <section key={dia} className="listado-agenda__grupo" aria-label={fechaLargaDia(dia)}>
          <h3 className={`listado-agenda__fecha${dia === props.hoy ? ' listado-agenda__fecha--hoy' : ''}`}>
            <span>{fechaLargaDia(dia)}</span>
            {dia === props.hoy && <span className="listado-agenda__hoy">Hoy</span>}
            {dia === sumarDias(props.hoy, 1) && <span className="listado-agenda__hoy listado-agenda__hoy--suave">Mañana</span>}
          </h3>
          <ul className="listado-agenda__lista">
            {items.map((item) => {
              const definicion = TIPOS_AGENDA[item.tipo];
              const Icono = definicion.icono;
              const estado = ESTADOS_EVENTO[item.estado];
              return (
                <li key={item.clave}>
                  <button
                    type="button"
                    className={clasesElemento('fila-agenda', item, props.seleccion)}
                    onClick={() => props.alSeleccionar(item)}
                    aria-pressed={props.seleccion === item.clave}
                  >
                    <span className="fila-agenda__hora">{rangoHorario(item)}</span>
                    <span className="fila-agenda__tipo">
                      <span className="fila-agenda__marca" aria-hidden>
                        {esCritico(item) ? <AlertTriangle size={13} /> : <Icono size={13} />}
                      </span>
                      {definicion.corto}
                    </span>
                    <span className="fila-agenda__principal">
                      <span className="fila-agenda__titulo">{item.titulo}</span>
                      {(item.caratula || item.lugar) && (
                        <span className="fila-agenda__detalle">
                          {[item.numero_expediente ? `Expte. ${item.numero_expediente}` : item.caratula, item.lugar]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                    </span>
                    <span className="fila-agenda__responsable">{item.responsable ?? ''}</span>
                    <span className="fila-agenda__estado">
                      {item.tipo !== 'INHABIL' && estado && <Etiqueta tono={estado.tono}>{estado.texto}</Etiqueta>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
