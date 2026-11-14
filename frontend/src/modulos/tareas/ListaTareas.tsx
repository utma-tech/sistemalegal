import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Check, ListChecks, Pencil, Play, RotateCcw, Trash2 } from 'lucide-react';
import { useCambiarEstadoTarea, useEliminarTarea } from '../../servicios/consultasOperacion';
import type { Tarea } from '../../tipos/api';
import { useSesion } from '../auth/ContextoSesion';
import { enDias, fecha } from '../../lib/formato';
import { useAvisos } from '../../componentes/ui/Avisos';
import { Boton } from '../../componentes/ui/Boton';
import { DialogoConfirmar } from '../../componentes/ui/DialogoConfirmar';
import { EstadoTarea, Prioridad, Vencimiento } from '../../componentes/ui/Etiqueta';
import { Vacio } from '../../componentes/ui/Estados';
import { DialogoTarea } from './DialogoTarea';

/**
 * Lista de tareas con sus acciones rápidas.
 *
 * Las acciones están en la fila y no detrás de un menú: tomar, completar y
 * reabrir son lo que se hace todo el día, y cada clic de más es una tarea que
 * queda "pendiente" en el sistema aunque ya se hizo.
 */

interface Props {
  tareas: Tarea[];
  /** En el expediente no hace falta repetir la carátula en cada fila. */
  mostrarExpediente?: boolean;
  textoVacio?: string;
}

export function ListaTareas({ tareas, mostrarExpediente = true, textoVacio }: Props) {
  const { puede } = useSesion();
  const { avisar } = useAvisos();
  const cambiarEstado = useCambiarEstadoTarea();
  const eliminar = useEliminarTarea();
  const [editando, setEditando] = useState<Tarea>();
  const [aEliminar, setAEliminar] = useState<Tarea>();
  const [errorBaja, setErrorBaja] = useState<string>();

  async function mover(tarea: Tarea, estado: Tarea['estado'], mensaje: string) {
    try {
      await cambiarEstado.mutateAsync({ id: tarea.id, estado });
      avisar(mensaje);
    } catch (fallo) {
      avisar(fallo instanceof Error ? fallo.message : 'No se pudo actualizar la tarea.', 'error');
    }
  }

  async function confirmarBaja() {
    if (!aEliminar) return;
    setErrorBaja(undefined);
    try {
      await eliminar.mutateAsync(aEliminar.id);
      avisar('Tarea eliminada.');
      setAEliminar(undefined);
    } catch (fallo) {
      setErrorBaja(fallo instanceof Error ? fallo.message : 'No se pudo eliminar la tarea.');
    }
  }

  if (tareas.length === 0) {
    return <Vacio titulo="Sin tareas" texto={textoVacio} icono={<ListChecks size={20} aria-hidden />} />;
  }

  const editable = puede('tarea.editar');

  return (
    <>
      <div className="lista">
        {tareas.map((tarea) => {
          const abierta = tarea.estado === 'PENDIENTE' || tarea.estado === 'EN_CURSO';
          return (
            <div key={tarea.id} className="lista__item">
              <span className="lista__cuerpo">
                <span className="lista__titulo">{tarea.titulo}</span>
                {mostrarExpediente && tarea.causa_id && (
                  <span className="lista__meta">
                    <Link to={`/expedientes/${tarea.causa_id}?pestana=tareas`}>{tarea.caratula}</Link>
                  </span>
                )}
                <span className="lista__meta">
                  {tarea.asignada_a ?? 'Sin asignar'}
                  {tarea.fecha_vencimiento && (
                    <>
                      {' · '}
                      <CalendarDays size={12} aria-hidden style={{ display: 'inline', verticalAlign: -2 }} />{' '}
                      {fecha(tarea.fecha_vencimiento)}
                    </>
                  )}
                  {tarea.plazo && ` · Plazo: ${tarea.plazo}`}
                </span>
                {tarea.descripcion && <span className="lista__meta">{tarea.descripcion}</span>}
              </span>

              <span className="lista__lateral">
                {abierta && tarea.dias_restantes !== null && (
                  <Vencimiento dias={tarea.dias_restantes} texto={enDias(tarea.dias_restantes)} />
                )}
                <Prioridad prioridad={tarea.prioridad} />
                <EstadoTarea estado={tarea.estado} />
                {editable && tarea.estado === 'PENDIENTE' && (
                  <Boton
                    pequeno
                    variante="sutil"
                    icono={<Play size={14} aria-hidden />}
                    onClick={() => void mover(tarea, 'EN_CURSO', 'Tarea en curso.')}
                    title="Empezar"
                    aria-label={`Empezar «${tarea.titulo}»`}
                  />
                )}
                {editable && abierta && (
                  <Boton
                    pequeno
                    variante="sutil"
                    icono={<Check size={14} aria-hidden />}
                    onClick={() => void mover(tarea, 'COMPLETADA', 'Tarea completada.')}
                    title="Completar"
                    aria-label={`Completar «${tarea.titulo}»`}
                  />
                )}
                {editable && !abierta && (
                  <Boton
                    pequeno
                    variante="sutil"
                    icono={<RotateCcw size={14} aria-hidden />}
                    onClick={() => void mover(tarea, 'PENDIENTE', 'Tarea reabierta.')}
                    title="Reabrir"
                    aria-label={`Reabrir «${tarea.titulo}»`}
                  />
                )}
                {editable && (
                  <Boton
                    pequeno
                    variante="sutil"
                    icono={<Pencil size={14} aria-hidden />}
                    onClick={() => setEditando(tarea)}
                    title="Editar"
                    aria-label={`Editar «${tarea.titulo}»`}
                  />
                )}
                {puede('tarea.eliminar') && (
                  <Boton
                    pequeno
                    variante="sutil"
                    icono={<Trash2 size={14} aria-hidden />}
                    onClick={() => setAEliminar(tarea)}
                    title="Eliminar"
                    aria-label={`Eliminar «${tarea.titulo}»`}
                  />
                )}
              </span>
            </div>
          );
        })}
      </div>

      {editando && <DialogoTarea abierto alCerrar={() => setEditando(undefined)} tarea={editando} />}

      <DialogoConfirmar
        abierto={Boolean(aEliminar)}
        titulo="Eliminar la tarea"
        mensaje={
          <>
            Se borra <strong>{aEliminar?.titulo}</strong>. Si ya se hizo, conviene marcarla como completada:
            así queda el registro de quién la cerró y cuándo.
          </>
        }
        textoConfirmar="Eliminar"
        cargando={eliminar.isPending}
        error={errorBaja}
        alConfirmar={() => void confirmarBaja()}
        alCerrar={() => setAEliminar(undefined)}
      />
    </>
  );
}
