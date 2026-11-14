import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { useCatalogos } from '../../servicios/consultas';
import { useGuardarTarea } from '../../servicios/consultasOperacion';
import type { Tarea } from '../../tipos/api';
import { PRIORIDADES_TAREA } from '../../lib/vocabulario';
import { useErroresFormulario } from '../../lib/formulario';
import { useAvisos } from '../../componentes/ui/Avisos';
import { Modal } from '../../componentes/ui/Modal';
import { Boton } from '../../componentes/ui/Boton';
import { CampoArea, CampoSelect, CampoTexto } from '../../componentes/ui/Campo';

/**
 * Alta y edición de una tarea.
 *
 * Desde el expediente llega con la causa fija; desde el tablero de tareas, la
 * tarea puede no colgar de ningún expediente (las administrativas).
 */

interface Props {
  abierto: boolean;
  alCerrar: () => void;
  /** Si se edita, la tarea; si no, se crea una nueva. */
  tarea?: Tarea;
  causaId?: string;
  caratula?: string;
}

export function DialogoTarea({ abierto, alCerrar, tarea, causaId, caratula }: Props) {
  const guardar = useGuardarTarea(tarea?.id);
  const { data: catalogos } = useCatalogos();
  const { avisar } = useAvisos();
  const { errores, errorGeneral, limpiar, limpiarCampo, registrar } = useErroresFormulario();

  const [titulo, setTitulo] = useState(tarea?.titulo ?? '');
  const [descripcion, setDescripcion] = useState(tarea?.descripcion ?? '');
  const [asignada, setAsignada] = useState(tarea?.asignada_a_id ?? '');
  const [prioridad, setPrioridad] = useState<'ALTA' | 'MEDIA' | 'BAJA'>(tarea?.prioridad ?? 'MEDIA');
  const [vence, setVence] = useState(tarea?.fecha_vencimiento ?? '');

  const causa = tarea?.causa_id ?? causaId;

  async function enviar(evento: SubmitEvent) {
    evento.preventDefault();
    limpiar();
    try {
      await guardar.mutateAsync({
        titulo,
        descripcion: descripcion || undefined,
        causa_id: causa ?? undefined,
        plazo_id: tarea?.plazo_id ?? undefined,
        asignada_a: asignada || undefined,
        prioridad,
        fecha_vencimiento: vence || undefined,
      });
      avisar(tarea ? 'Tarea actualizada.' : 'Tarea creada.');
      alCerrar();
    } catch (fallo) {
      registrar(fallo, 'No se pudo guardar la tarea. Revisá tu conexión e intentá de nuevo.');
    }
  }

  return (
    <Modal
      abierto={abierto}
      alCerrar={alCerrar}
      titulo={tarea ? 'Editar tarea' : 'Nueva tarea'}
      descripcion={tarea?.caratula ?? caratula ?? 'Tarea del estudio, sin expediente'}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardar.isPending}>
            Cancelar
          </Boton>
          <Boton variante="primario" type="submit" form="formulario-tarea" cargando={guardar.isPending}>
            {tarea ? 'Guardar' : 'Crear tarea'}
          </Boton>
        </>
      }
    >
      <form id="formulario-tarea" onSubmit={enviar} noValidate className="pila">
        {errorGeneral && (
          <div className="aviso aviso--peligro" role="alert">
            <span className="aviso__cuerpo">{errorGeneral}</span>
          </div>
        )}

        <CampoTexto
          etiqueta="Qué hay que hacer"
          value={titulo}
          onChange={(e) => {
            setTitulo(e.target.value);
            limpiarCampo('titulo');
          }}
          placeholder="Preparar la contestación de demanda"
          error={errores.titulo?.[0]}
          maxLength={200}
          obligatorio
          autoFocus
        />

        <div className="datos">
          <CampoSelect
            etiqueta="Asignada a"
            value={asignada}
            onChange={(e) => {
              setAsignada(e.target.value);
              limpiarCampo('asignada_a');
            }}
            opciones={(catalogos?.profesionales ?? []).map((p) => ({ valor: p.id, texto: p.nombre }))}
            vacio="Sin asignar"
            error={errores.asignada_a?.[0]}
          />
          <CampoSelect
            etiqueta="Prioridad"
            value={prioridad}
            onChange={(e) => setPrioridad(e.target.value as typeof prioridad)}
            opciones={PRIORIDADES_TAREA}
          />
          <CampoTexto
            etiqueta="Para cuándo"
            type="date"
            value={vence}
            onChange={(e) => {
              setVence(e.target.value);
              limpiarCampo('fecha_vencimiento');
            }}
            error={errores.fecha_vencimiento?.[0]}
          />
        </div>

        <CampoArea
          etiqueta="Detalle"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          error={errores.descripcion?.[0]}
          placeholder="Lo que necesita saber quien la tome."
        />
        {errores.causa_id?.[0] && <p className="campo__error">{errores.causa_id[0]}</p>}
      </form>
    </Modal>
  );
}
