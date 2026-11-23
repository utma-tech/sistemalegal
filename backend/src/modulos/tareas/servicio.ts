import { armarPagina, type Pagina } from '../../comun/paginacion';
import { ErrorConflicto, ErrorNoEncontrado, ErrorSolicitud } from '../../comun/errores';
import * as repositorio from './repositorio';
import type { Tarea } from './repositorio';
import type { DatosTarea, FiltrosTarea } from './esquemas';

/** Reglas del módulo de tareas. */

export async function listar(filtros: FiltrosTarea, alcance: string | null): Promise<Pagina<Tarea>> {
  const [datos, total] = await Promise.all([
    repositorio.listar(filtros, alcance),
    repositorio.contar(filtros, alcance),
  ]);
  return armarPagina(datos, total, filtros);
}

export async function exigir(id: string): Promise<Tarea> {
  const tarea = await repositorio.buscarPorId(id);
  if (!tarea) throw new ErrorNoEncontrado('No encontramos esa tarea.');
  return tarea;
}

/**
 * Verifica las referencias antes de escribir.
 *
 * La base tiene las claves foráneas, pero su error es un 500 sin explicación;
 * acá se responde con el campo que hay que corregir. Un plazo de otro
 * expediente se rechaza: la tarea apareceria en un expediente y vigilaría el
 * vencimiento de otro.
 */
/** Decide si quien pide puede colgar la tarea de ese expediente (ver comun/alcance.ts). */
export type VerificadorCausa = (causaId: string) => Promise<boolean>;

async function validarReferencias(datos: DatosTarea, puedeUsarCausa: VerificadorCausa): Promise<DatosTarea> {
  const errores: Record<string, string[]> = {};
  let causaId = datos.causa_id;

  if (datos.plazo_id) {
    const causaDelPlazo = await repositorio.causaDelPlazo(datos.plazo_id);
    if (!causaDelPlazo) errores.plazo_id = ['Ese plazo no existe.'];
    else if (causaId && causaId !== causaDelPlazo) {
      errores.plazo_id = ['El plazo es de otro expediente.'];
    } else causaId = causaDelPlazo;
  }

  // Un expediente fuera del alcance responde igual que uno inexistente.
  if (causaId && (!(await repositorio.causaVigente(causaId)) || !(await puedeUsarCausa(causaId)))) {
    errores.causa_id = ['Ese expediente no existe o fue dado de baja.'];
  }

  if (datos.asignada_a && !(await repositorio.integranteActivo(datos.asignada_a))) {
    errores.asignada_a = ['Esa persona no es un integrante activo del estudio.'];
  }

  if (Object.keys(errores).length > 0) {
    throw new ErrorSolicitud('Revisá los datos del formulario.', errores);
  }

  return { ...datos, causa_id: causaId };
}

export async function crear(datos: DatosTarea, usuarioId: string, puedeUsarCausa: VerificadorCausa): Promise<Tarea> {
  const id = await repositorio.crear(await validarReferencias(datos, puedeUsarCausa), usuarioId);
  return exigir(id);
}

export async function editar(
  id: string,
  datos: DatosTarea,
  puedeUsarCausa: VerificadorCausa,
): Promise<{ antes: Tarea; despues: Tarea }> {
  const antes = await exigir(id);
  // Conservar el expediente que ya tenía no es ampliar el alcance: una tarea
  // delegada en una causa ajena se puede seguir editando.
  const verificar: VerificadorCausa = async (causa) => causa === antes.causa_id || puedeUsarCausa(causa);
  await repositorio.actualizar(id, await validarReferencias(datos, verificar));
  return { antes, despues: await exigir(id) };
}

export async function cambiarEstado(
  id: string,
  estado: string,
): Promise<{ antes: Tarea; despues: Tarea }> {
  const antes = await exigir(id);
  if (antes.estado === estado) {
    throw new ErrorConflicto('La tarea ya está en ese estado.');
  }
  await repositorio.cambiarEstado(id, estado);
  return { antes, despues: await exigir(id) };
}

export async function eliminar(id: string): Promise<Tarea> {
  const tarea = await exigir(id);
  await repositorio.eliminar(id);
  return tarea;
}
