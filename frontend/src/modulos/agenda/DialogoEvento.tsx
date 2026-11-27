import { useEffect, useMemo, useState } from 'react';
import type { SubmitEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useCatalogos, useCausa, useCausas } from '../../servicios/consultas';
import {
  useConflictos,
  useGuardarEvento,
  useRecordatoriosPredeterminados,
  type ConsultaConflictos,
} from '../../servicios/consultasAgenda';
import type { DatosEvento, EventoAgenda, PrioridadEvento, TipoEvento, VisibilidadEvento } from '../../tipos/api';
import { useSesion } from '../auth/ContextoSesion';
import { useErroresFormulario } from '../../lib/formulario';
import { PRIORIDADES_TAREA } from '../../lib/vocabulario';
import { useAvisos } from '../../componentes/ui/Avisos';
import { Modal } from '../../componentes/ui/Modal';
import { Boton } from '../../componentes/ui/Boton';
import { CampoArea, CampoCasilla, CampoSelect, CampoTexto } from '../../componentes/ui/Campo';
import { fechaLargaDia, horaDe, hoyLocal, sumarDias, textoAnticipacion } from './calendario';
import { OPCIONES_RECORDATORIO, TIPOS_EVENTO_OPCIONES, VISIBILIDADES } from './vocabularioAgenda';

/**
 * Alta y edición de un evento de agenda.
 *
 * Dos columnas en escritorio: a la izquierda qué y cuándo (lo que se carga
 * siempre); a la derecha con quién y cómo se avisa. En el celular se apilan en
 * ese mismo orden. Las superposiciones se avisan mientras se completa, sin
 * impedir guardar: dos audiencias a la misma hora pueden ser un error o una
 * decisión, y eso lo resuelve el abogado.
 */

interface Props {
  abierto: boolean;
  alCerrar: () => void;
  /** Si se edita, el evento; si no, se crea uno nuevo. */
  evento?: EventoAgenda;
  /** Valores iniciales de un alta rápida (día o franja elegidos en el calendario). */
  fechaInicial?: string;
  horaInicial?: string;
  /** Alta desde un expediente: la causa queda fija. */
  causaFija?: { id: string; caratula: string };
  alGuardar?: (evento: EventoAgenda) => void;
}

function horaMas(hora: string, minutos: number): string {
  const [h, m] = hora.split(':').map(Number);
  const total = Math.min(h! * 60 + m! + minutos, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function DialogoEvento({ abierto, alCerrar, evento, fechaInicial, horaInicial, causaFija, alGuardar }: Props) {
  const { usuario } = useSesion();
  const guardar = useGuardarEvento(evento?.id);
  const { data: catalogos } = useCatalogos();
  const { data: reglas } = useRecordatoriosPredeterminados();
  const { avisar } = useAvisos();
  const { errores, errorGeneral, limpiar, limpiarCampo, registrar } = useErroresFormulario();

  const inicial = fechaInicial ?? hoyLocal();
  // Un alta para hoy propone la próxima hora en punto, no las 9 si ya pasaron.
  const horaSugerida =
    horaInicial ??
    (inicial === hoyLocal()
      ? `${String(Math.min(Math.max(new Date().getHours() + 1, 8), 20)).padStart(2, '0')}:00`
      : '09:00');
  const [titulo, setTitulo] = useState(evento?.titulo ?? '');
  const [tipo, setTipo] = useState<TipoEvento>(evento?.tipo ?? 'AUDIENCIA');
  const [prioridad, setPrioridad] = useState<PrioridadEvento>(evento?.prioridad ?? 'MEDIA');
  const [todoElDia, setTodoElDia] = useState(evento?.todo_el_dia ?? false);
  const [fechaInicio, setFechaInicio] = useState(evento?.fecha_inicio ?? inicial);
  const [horaInicio, setHoraInicio] = useState(evento && !evento.todo_el_dia ? evento.hora_inicio : horaSugerida);
  const [fechaFin, setFechaFin] = useState(evento?.fecha_fin ?? inicial);
  const [horaFin, setHoraFin] = useState(
    evento && !evento.todo_el_dia ? evento.hora_fin : horaMas(horaSugerida, 60),
  );
  const [causaId, setCausaId] = useState(evento?.causa_id ?? causaFija?.id ?? '');
  const [personaId, setPersonaId] = useState(evento?.persona_id ?? '');
  const [responsableId, setResponsableId] = useState(evento?.responsable_id ?? usuario?.id ?? '');
  const [participantes, setParticipantes] = useState<string[]>(evento?.participantes.map((p) => p.id) ?? []);
  const [lugar, setLugar] = useState(evento?.lugar ?? '');
  const [enlace, setEnlace] = useState(evento?.enlace_virtual ?? '');
  const [descripcion, setDescripcion] = useState(evento?.descripcion ?? '');
  const [observaciones, setObservaciones] = useState(evento?.observaciones ?? '');
  const [visibilidad, setVisibilidad] = useState<VisibilidadEvento>(evento?.visibilidad ?? 'ESTUDIO');
  const [recordatorios, setRecordatorios] = useState<number[] | null>(evento?.recordatorios ?? null);

  // Mientras no se toquen, los recordatorios siguen la regla del estudio para el tipo elegido.
  const recordatoriosEfectivos = recordatorios ?? reglas?.[tipo] ?? [];

  const causas = useCausas({ pagina: 1, tamano: 100, vigencia: 'activas', orden: 'caratula', direccion: 'asc' });
  const detalleCausa = useCausa(causaId || undefined);
  const partes = detalleCausa.data?.partes ?? [];

  // Cambiar de expediente invalida la persona elegida (tiene que ser parte de la causa).
  useEffect(() => {
    if (personaId && detalleCausa.data && !detalleCausa.data.partes.some((p) => p.persona_id === personaId)) {
      setPersonaId('');
    }
  }, [detalleCausa.data, personaId]);

  // Advertencia de superposición, con un respiro para no consultar en cada tecla.
  const [consultaConflictos, setConsultaConflictos] = useState<ConsultaConflictos | null>(null);
  useEffect(() => {
    if (!abierto || todoElDia || !horaInicio || !fechaInicio) {
      setConsultaConflictos(null);
      return;
    }
    const temporizador = setTimeout(() => {
      setConsultaConflictos({
        fecha_inicio: fechaInicio,
        hora_inicio: horaInicio,
        fecha_fin: fechaFin || undefined,
        hora_fin: horaFin || undefined,
        responsable: responsableId || undefined,
        participantes: participantes.join(',') || undefined,
        excluir: evento?.id,
      });
    }, 400);
    return () => clearTimeout(temporizador);
  }, [abierto, todoElDia, fechaInicio, horaInicio, fechaFin, horaFin, responsableId, participantes, evento?.id]);
  const conflictos = useConflictos(consultaConflictos);

  const profesionales = catalogos?.profesionales ?? [];
  const opcionesCausas = useMemo(() => {
    const lista = (causas.data?.datos ?? []).map((c) => ({
      valor: c.id,
      texto: `${c.numero_expediente ? `${c.numero_expediente} · ` : ''}${c.caratula}`,
    }));
    // Si el evento cuelga de una causa que no está entre las 100 primeras, igual se muestra.
    if (evento?.causa_id && !lista.some((o) => o.valor === evento.causa_id)) {
      lista.unshift({ valor: evento.causa_id, texto: evento.caratula ?? 'Expediente actual' });
    }
    return lista;
  }, [causas.data, evento]);

  function alternarParticipante(id: string) {
    setParticipantes((actuales) => (actuales.includes(id) ? actuales.filter((p) => p !== id) : [...actuales, id]));
    limpiarCampo('participantes');
  }

  function alternarRecordatorio(minutos: number) {
    const actuales = recordatoriosEfectivos;
    setRecordatorios(
      actuales.includes(minutos) ? actuales.filter((m) => m !== minutos) : [...actuales, minutos].sort((a, b) => b - a),
    );
  }

  async function enviar(ev: SubmitEvent) {
    ev.preventDefault();
    if (guardar.isPending) return;
    limpiar();
    const datos: DatosEvento = {
      titulo,
      tipo,
      prioridad,
      todo_el_dia: todoElDia,
      fecha_inicio: fechaInicio,
      hora_inicio: todoElDia ? undefined : horaInicio,
      fecha_fin: fechaFin && fechaFin !== fechaInicio ? fechaFin : undefined,
      hora_fin: todoElDia ? undefined : horaFin || undefined,
      causa_id: causaId || undefined,
      persona_id: personaId || undefined,
      responsable_id: responsableId || undefined,
      participantes: visibilidad === 'PERSONAL' ? [] : participantes.filter((p) => p !== responsableId),
      lugar: lugar || undefined,
      enlace_virtual: enlace || undefined,
      descripcion: descripcion || undefined,
      observaciones: observaciones || undefined,
      visibilidad,
      recordatorios: recordatoriosEfectivos,
    };
    try {
      const respuesta = await guardar.mutateAsync(datos);
      avisar(evento ? 'Evento actualizado.' : 'Evento creado.');
      if (respuesta.conflictos.length > 0 || respuesta.ocultos > 0) {
        avisar('Quedó guardado, pero se superpone con otro compromiso.', 'info');
      }
      alGuardar?.(respuesta.evento);
      alCerrar();
    } catch (fallo) {
      registrar(fallo, 'No se pudo guardar el evento. Revisá tu conexión e intentá de nuevo.');
    }
  }

  const choques = conflictos.data;
  const hayChoques = Boolean(choques && (choques.conflictos.length > 0 || choques.ocultos > 0));
  const ayudaVisibilidad = VISIBILIDADES.find((v) => v.valor === visibilidad)?.ayuda;

  return (
    <Modal
      abierto={abierto}
      alCerrar={alCerrar}
      ancho
      titulo={evento ? 'Editar evento' : 'Nuevo evento'}
      descripcion={causaFija ? causaFija.caratula : evento ? fechaLargaDia(evento.fecha_inicio) : undefined}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardar.isPending}>
            Cancelar
          </Boton>
          <Boton variante="primario" type="submit" form="formulario-evento" cargando={guardar.isPending}>
            {evento ? 'Guardar cambios' : 'Crear evento'}
          </Boton>
        </>
      }
    >
      <form id="formulario-evento" onSubmit={enviar} noValidate className="formulario-evento">
        {errorGeneral && (
          <div className="aviso aviso--peligro formulario-evento__aviso" role="alert">
            <span className="aviso__cuerpo">{errorGeneral}</span>
          </div>
        )}

        <div className="formulario-evento__columna">
          <CampoTexto
            etiqueta="Título"
            value={titulo}
            onChange={(e) => {
              setTitulo(e.target.value);
              limpiarCampo('titulo');
            }}
            placeholder="Audiencia de conciliación"
            error={errores.titulo?.[0]}
            maxLength={200}
            obligatorio
            autoFocus
          />
          <div className="formulario-evento__fila">
            <CampoSelect
              etiqueta="Tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoEvento)}
              opciones={TIPOS_EVENTO_OPCIONES}
              error={errores.tipo?.[0]}
            />
            <CampoSelect
              etiqueta="Prioridad"
              value={prioridad}
              onChange={(e) => setPrioridad(e.target.value as PrioridadEvento)}
              opciones={PRIORIDADES_TAREA}
            />
          </div>

          <fieldset className="formulario-evento__grupo">
            <legend className="formulario-evento__leyenda">Cuándo</legend>
            <div className="formulario-evento__fila formulario-evento__fila--horario">
              <CampoTexto
                etiqueta={todoElDia ? 'Desde' : 'Fecha'}
                type="date"
                value={fechaInicio}
                onChange={(e) => {
                  const valor = e.target.value;
                  // La fecha de fin acompaña al inicio mientras no se haya separado.
                  if (fechaFin === fechaInicio || fechaFin < valor) setFechaFin(valor);
                  setFechaInicio(valor);
                  limpiarCampo('fecha_inicio');
                }}
                error={errores.fecha_inicio?.[0]}
                obligatorio
              />
              {todoElDia ? (
                <CampoTexto
                  etiqueta="Hasta"
                  type="date"
                  value={fechaFin}
                  min={fechaInicio}
                  onChange={(e) => {
                    setFechaFin(e.target.value);
                    limpiarCampo('fecha_fin');
                  }}
                  error={errores.fecha_fin?.[0]}
                />
              ) : (
                <>
                  <CampoTexto
                    etiqueta="Desde"
                    type="time"
                    value={horaInicio}
                    onChange={(e) => {
                      const valor = e.target.value;
                      if (valor && (!horaFin || horaFin <= valor)) setHoraFin(horaMas(valor, 60));
                      setHoraInicio(valor);
                      limpiarCampo('hora_inicio');
                    }}
                    error={errores.hora_inicio?.[0]}
                    obligatorio
                  />
                  <CampoTexto
                    etiqueta="Hasta"
                    type="time"
                    value={horaFin}
                    onChange={(e) => {
                      setHoraFin(e.target.value);
                      limpiarCampo('hora_fin');
                    }}
                    error={errores.hora_fin?.[0] ?? errores.fecha_fin?.[0]}
                  />
                </>
              )}
            </div>
            <CampoCasilla
              etiqueta="Todo el día"
              checked={todoElDia}
              onChange={(e) => {
                setTodoElDia(e.target.checked);
                if (!e.target.checked) setFechaFin(fechaInicio);
              }}
            />
            {!todoElDia && fechaFin !== fechaInicio && (
              <p className="campo__ayuda">Termina el {fechaLargaDia(fechaFin)}.</p>
            )}
            {!todoElDia && fechaFin === fechaInicio && (
              <button type="button" className="enlace-boton" onClick={() => setFechaFin(sumarDias(fechaInicio, 1))}>
                Termina otro día
              </button>
            )}
          </fieldset>

          {hayChoques && choques && (
            <div className="aviso aviso--alerta" role="status">
              <AlertTriangle size={16} aria-hidden />
              <span className="aviso__cuerpo">
                <strong>Se superpone con otro compromiso.</strong>{' '}
                {choques.conflictos
                  .slice(0, 3)
                  .map((c) => `${c.titulo} (${horaDe(c.inicio)}–${horaDe(c.fin)})`)
                  .join('; ')}
                {choques.ocultos > 0 &&
                  `${choques.conflictos.length ? ' y ' : ''}${choques.ocultos} ${choques.ocultos === 1 ? 'compromiso' : 'compromisos'} que no podés ver`}
                . Podés guardarlo igual.
              </span>
            </div>
          )}

          <div className="formulario-evento__fila">
            <CampoTexto
              etiqueta="Lugar"
              value={lugar}
              onChange={(e) => setLugar(e.target.value)}
              placeholder="Juzgado, sala o domicilio"
              maxLength={200}
              error={errores.lugar?.[0]}
            />
            <CampoTexto
              etiqueta="Enlace de reunión virtual"
              type="url"
              value={enlace}
              onChange={(e) => {
                setEnlace(e.target.value);
                limpiarCampo('enlace_virtual');
              }}
              placeholder="https://"
              maxLength={500}
              error={errores.enlace_virtual?.[0]}
            />
          </div>

          <CampoArea
            etiqueta="Descripción"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Lo que necesita saber quien asista."
            maxLength={2000}
            error={errores.descripcion?.[0]}
          />
        </div>

        <div className="formulario-evento__columna formulario-evento__columna--lateral">
          {causaFija ? (
            <div className="campo">
              <span className="campo__etiqueta">Expediente</span>
              <p className="formulario-evento__fijo">{causaFija.caratula}</p>
            </div>
          ) : (
            <CampoSelect
              etiqueta="Expediente"
              value={causaId}
              onChange={(e) => {
                setCausaId(e.target.value);
                limpiarCampo('causa_id');
              }}
              opciones={opcionesCausas}
              vacio="Sin expediente"
              error={errores.causa_id?.[0]}
            />
          )}
          {causaId ? (
            <CampoSelect
              etiqueta="Cliente o parte"
              value={personaId}
              onChange={(e) => {
                setPersonaId(e.target.value);
                limpiarCampo('persona_id');
              }}
              opciones={partes.map((p) => ({ valor: p.persona_id, texto: `${p.nombre_completo} · ${p.caracter.toLowerCase()}` }))}
              vacio={detalleCausa.isPending ? 'Cargando partes…' : 'Ninguna'}
              error={errores.persona_id?.[0]}
            />
          ) : null}

          <CampoSelect
            etiqueta="Responsable"
            value={responsableId}
            onChange={(e) => {
              setResponsableId(e.target.value);
              limpiarCampo('responsable_id');
            }}
            opciones={profesionales.map((p) => ({ valor: p.id, texto: p.id === usuario?.id ? `${p.nombre} (vos)` : p.nombre }))}
            error={errores.responsable_id?.[0]}
          />

          {visibilidad !== 'PERSONAL' && (
            <div className="campo">
              <span className="campo__etiqueta" id="etiqueta-participantes">
                Participantes
              </span>
              <div className="pastillas" role="group" aria-labelledby="etiqueta-participantes">
                {profesionales
                  .filter((p) => p.id !== responsableId)
                  .map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="pastilla"
                      aria-pressed={participantes.includes(p.id)}
                      onClick={() => alternarParticipante(p.id)}
                    >
                      {p.nombre}
                    </button>
                  ))}
              </div>
              {errores.participantes?.[0] && <p className="campo__error">{errores.participantes[0]}</p>}
            </div>
          )}

          <div className="campo">
            <span className="campo__etiqueta" id="etiqueta-recordatorios">
              Recordatorios
            </span>
            <div className="pastillas" role="group" aria-labelledby="etiqueta-recordatorios">
              {OPCIONES_RECORDATORIO.map((minutos) => (
                <button
                  key={minutos}
                  type="button"
                  className="pastilla"
                  aria-pressed={recordatoriosEfectivos.includes(minutos)}
                  onClick={() => alternarRecordatorio(minutos)}
                >
                  {textoAnticipacion(minutos)}
                </button>
              ))}
            </div>
            <p className="campo__ayuda">Le llegan al responsable y a los participantes, según sus preferencias.</p>
          </div>

          <CampoSelect
            etiqueta="Visibilidad"
            value={visibilidad}
            onChange={(e) => {
              setVisibilidad(e.target.value as VisibilidadEvento);
              limpiarCampo('participantes');
            }}
            opciones={VISIBILIDADES.map((v) => ({ valor: v.valor, texto: v.texto }))}
            ayuda={ayudaVisibilidad}
          />

          <details className="formulario-evento__mas" open={Boolean(observaciones)}>
            <summary>Observaciones internas</summary>
            <CampoArea
              etiqueta="Observaciones"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              maxLength={2000}
              error={errores.observaciones?.[0]}
            />
          </details>
        </div>
      </form>
    </Modal>
  );
}
