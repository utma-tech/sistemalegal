import type { PoolClient } from 'pg';
import { config } from '../../config';
import { enTransaccion, obtenerPool } from '../../db';
import { hoy, horaEnZona, fechaEnZona } from '../../comun/ruta';
import { rolConAlcanceGeneral, tieneAlcanceRestringido } from '../../comun/alcance';
import { ErrorAutorizacion, ErrorConflicto, ErrorNoEncontrado, ErrorSolicitud } from '../../comun/errores';
import type { SesionUsuario } from '../auth/tipos';
import { vigentes } from '../alertas/servicio';
import {
  anclaDeRecordatorio,
  cancelarPendientesDeEvento,
  encolar,
  porAmbosCanales,
  type NuevoEnvio,
  type TipoEnvio,
} from '../notificaciones/cola';
import * as repo from './repositorio';
import { intervaloLocal } from './fechas';
import type {
  DatosConflictos,
  DatosEstadoEvento,
  DatosEvento,
  EstadoEvento,
  FiltrosAgenda,
  TipoAgenda,
} from './esquemas';
import { TIPOS_EVENTO } from './esquemas';

/**
 * Agenda jurídica: eventos propios y vista unificada.
 *
 * Reglas que este archivo hace cumplir:
 *  - Un evento se lee solo si es visible (repo.buscar aplica visibilidad y
 *    alcance); fuera de eso responde 404, igual que si no existiera.
 *  - Lo modifican quien lo creó, su responsable, o Administrador / Jefe de
 *    Estudio. Un participante lo ve pero no lo cambia.
 *  - Toda vinculación se valida: el expediente tiene que estar al alcance de
 *    quien carga; el responsable y los participantes, también (convocar a
 *    alguien no le abre un expediente); la persona tiene que ser parte de la
 *    causa elegida.
 *  - El cambio y la programación de sus avisos van en la MISMA transacción. Si
 *    algo que afecta a los avisos cambia, sube la versión del evento y los
 *    recordatorios de la versión anterior se cancelan.
 *  - Los plazos y las tareas se leen de sus tablas y no se editan desde acá.
 */

const ESTADOS_ABIERTOS: EstadoEvento[] = ['PENDIENTE', 'CONFIRMADO'];

function lectorDe(sesion: SesionUsuario): repo.Lector {
  return { usuarioId: sesion.id, alcance: tieneAlcanceRestringido(sesion) ? sesion.id : null };
}

function puedeModificar(
  evento: { creado_por_id?: string | null; creado_por?: string | null; responsable_id: string | null },
  creadoPor: string | null,
  sesion: SesionUsuario,
): boolean {
  return !tieneAlcanceRestringido(sesion) || creadoPor === sesion.id || evento.responsable_id === sesion.id;
}

function unicos<T>(valores: T[]): T[] {
  return [...new Set(valores)];
}

/** A quién le llegan los avisos: el responsable (o quien lo creó, si no hay) y los participantes. */
function destinatariosDe(responsable: string | null | undefined, creador: string | null | undefined, participantes: string[]): string[] {
  return unicos([responsable ?? creador, ...participantes].filter((u): u is string => Boolean(u)));
}

/* --- Validación de vínculos ------------------------------------------------------ */

async function validarVinculos(d: DatosEvento, sesion: SesionUsuario): Promise<void> {
  const errores: Record<string, string[]> = {};

  if (d.causa_id) {
    const { rows } = await obtenerPool().query<{ existe: boolean; asignado: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM causa WHERE id = $1 AND eliminado_en IS NULL) AS existe,
              EXISTS (SELECT 1 FROM profesional_causa
                       WHERE causa_id = $1 AND usuario_id = $2 AND fecha_baja IS NULL) AS asignado`,
      [d.causa_id, sesion.id],
    );
    const fila = rows[0];
    // Fuera de alcance responde igual que inexistente: no revela qué causas hay.
    if (!fila?.existe || (tieneAlcanceRestringido(sesion) && !fila.asignado)) {
      errores.causa_id = ['No encontramos ese expediente.'];
    }
  }

  const ids = unicos([...(d.responsable_id ? [d.responsable_id] : []), ...d.participantes]);
  if (ids.length) {
    const usuarios = await repo.usuariosVinculables(ids, d.causa_id);
    const porId = new Map(usuarios.map((u) => [u.id, u]));
    for (const id of ids) {
      const campo = id === d.responsable_id ? 'responsable_id' : 'participantes';
      const usuario = porId.get(id);
      if (!usuario) (errores[campo] ??= []).push('Ese integrante no existe.');
      else if (!usuario.activo) (errores[campo] ??= []).push(`${usuario.nombre} está dado de baja.`);
      else if (d.causa_id && !rolConAlcanceGeneral(usuario.rol) && !usuario.asignado) {
        (errores[campo] ??= []).push(
          `${usuario.nombre} no está asignado a ese expediente. Asignalo a la causa antes de sumarlo al evento.`,
        );
      }
    }
  }

  if (d.persona_id) {
    const persona = await repo.personaVinculable(d.persona_id, d.causa_id);
    if (!persona.existe) errores.persona_id = ['Esa persona no existe.'];
    else if (!persona.esParte) errores.persona_id = ['Esa persona no es parte del expediente elegido.'];
  }

  if (Object.keys(errores).length) throw new ErrorSolicitud('Revisá los datos del formulario.', errores);
}

/* --- Programación de avisos ------------------------------------------------------ */

interface Guardado {
  id: string;
  version: number;
  fecha_inicio: Date;
  todo_el_dia: boolean;
}

async function programarRecordatorios(
  cliente: PoolClient,
  evento: Guardado,
  usuarios: string[],
  minutos: number[],
): Promise<void> {
  const ancla = anclaDeRecordatorio(evento.fecha_inicio, evento.todo_el_dia).getTime();
  const ahora = Date.now();
  const envios: NuevoEnvio[] = [];
  for (const m of minutos) {
    const instante = ancla - m * 60_000;
    // Un recordatorio cuya hora ya pasó no se programa (un evento cargado con
    // menos anticipación que el aviso): avisar tarde de algo inminente confunde.
    if (instante <= ahora) continue;
    for (const usuario of usuarios) {
      envios.push(
        ...porAmbosCanales(
          {
            usuarioId: usuario,
            tipo: 'RECORDATORIO_EVENTO',
            eventoId: evento.id,
            versionOrigen: evento.version,
            minutosAntes: m,
            programadoPara: new Date(instante),
          },
          `REC:${evento.id}:v${evento.version}:${usuario}:${m}`,
        ),
      );
    }
  }
  await encolar(cliente, envios);
}

async function avisar(
  cliente: PoolClient,
  tipo: TipoEnvio,
  evento: Guardado,
  usuarios: string[],
  datos: Record<string, unknown> = {},
): Promise<void> {
  const envios = usuarios.flatMap((usuario) =>
    porAmbosCanales(
      { usuarioId: usuario, tipo, eventoId: evento.id, versionOrigen: evento.version, datos },
      `${tipo}:${evento.id}:v${evento.version}:${usuario}`,
    ),
  );
  await encolar(cliente, envios);
}

/* --- Lectura ---------------------------------------------------------------------- */

export interface EventoDetalle extends Omit<repo.FilaEvento, 'instante_inicio'> {
  participantes: { id: string; nombre: string }[];
  recordatorios: number[];
  puede_editar: boolean;
  puede_cancelar: boolean;
}

export async function detalle(id: string, sesion: SesionUsuario): Promise<EventoDetalle> {
  const pool = obtenerPool();
  const fila = await repo.buscar(pool, id, lectorDe(sesion));
  if (!fila) throw new ErrorNoEncontrado('No encontramos ese evento.');
  const [participantes, recordatorios] = await Promise.all([
    repo.participantesDe(pool, [id]),
    repo.recordatoriosDe(pool, id),
  ]);
  const { instante_inicio: _instante, ...resto } = fila;
  const modificable = puedeModificar(fila, fila.creado_por_id, sesion);
  return {
    ...resto,
    participantes: participantes.get(id) ?? [],
    recordatorios,
    puede_editar: modificable && sesion.permisos.includes('agenda.editar'),
    puede_cancelar:
      modificable && sesion.permisos.includes('agenda.cancelar') && ESTADOS_ABIERTOS.includes(fila.estado),
  };
}

export async function historial(id: string, sesion: SesionUsuario): Promise<repo.EntradaHistorial[]> {
  const visible = await repo.buscar(obtenerPool(), id, lectorDe(sesion));
  if (!visible) throw new ErrorNoEncontrado('No encontramos ese evento.');
  return repo.historial(id);
}

/* --- Escritura -------------------------------------------------------------------- */

export async function crear(datos: DatosEvento, sesion: SesionUsuario): Promise<string> {
  // Todo evento tiene un responsable: si no se indica, es quien lo carga.
  const d: DatosEvento = { ...datos, responsable_id: datos.responsable_id ?? sesion.id };
  await validarVinculos(d, sesion);
  const intervalo = intervaloLocal(d);

  return enTransaccion(async (cliente) => {
    const evento = await repo.insertar(cliente, d, intervalo, sesion.id);
    await repo.reemplazarParticipantes(cliente, evento.id, d.participantes);
    const minutos = unicos(d.recordatorios ?? (await repo.reglasRecordatorio(cliente, d.tipo)));
    await repo.reemplazarRecordatorios(cliente, evento.id, minutos);
    await repo.registrarHistorial(cliente, evento.id, sesion.id, 'CREADO', {
      tipo: d.tipo,
      inicio: intervalo.inicio.slice(0, 16),
      fin: intervalo.fin.slice(0, 16),
    });

    const destinatarios = destinatariosDe(d.responsable_id, sesion.id, d.participantes);
    await programarRecordatorios(cliente, evento, destinatarios, minutos);
    await avisar(
      cliente,
      'EVENTO_ASIGNADO',
      evento,
      destinatarios.filter((u) => u !== sesion.id),
    );
    return evento.id;
  });
}

function mismoConjunto(a: (number | string)[], b: (number | string)[]): boolean {
  const x = new Set(a);
  return x.size === new Set(b).size && [...x].every((v) => b.includes(v));
}

export interface ResultadoEdicion {
  antes: EventoDetalle;
  id: string;
}

export async function editar(id: string, datos: DatosEvento, sesion: SesionUsuario): Promise<ResultadoEdicion> {
  const antesDetalle = await detalle(id, sesion);
  const d: DatosEvento = { ...datos, responsable_id: datos.responsable_id ?? antesDetalle.creado_por_id ?? sesion.id };
  await validarVinculos(d, sesion);
  const intervalo = intervaloLocal(d);

  await enTransaccion(async (cliente) => {
    const antes = await repo.buscar(cliente, id, lectorDe(sesion), true);
    if (!antes) throw new ErrorNoEncontrado('No encontramos ese evento.');
    if (!puedeModificar(antes, antes.creado_por_id, sesion)) {
      throw new ErrorAutorizacion('Solo quien creó el evento, su responsable o la dirección del estudio pueden modificarlo.');
    }
    if (!ESTADOS_ABIERTOS.includes(antes.estado)) {
      throw new ErrorConflicto('El evento está cerrado. Reabrilo para poder editarlo.');
    }

    const participantesAntes = ((await repo.participantesDe(cliente, [id])).get(id) ?? []).map((p) => p.id);
    const recordatoriosAntes = await repo.recordatoriosDe(cliente, id);
    const minutos = unicos(d.recordatorios ?? recordatoriosAntes);

    const inicioAntes = antes.todo_el_dia ? `${antes.fecha_inicio} 00:00` : `${antes.fecha_inicio} ${antes.hora_inicio}`;
    const finAntes = antes.todo_el_dia ? `${antes.fecha_fin} 23:59` : `${antes.fecha_fin} ${antes.hora_fin}`;
    const reprogramado =
      antes.todo_el_dia !== d.todo_el_dia ||
      inicioAntes !== intervalo.inicio.slice(0, 16) ||
      finAntes !== intervalo.fin.slice(0, 16);
    const responsableCambio = (antes.responsable_id ?? null) !== (d.responsable_id ?? null);
    const participantesCambio = !mismoConjunto(participantesAntes, d.participantes);
    const recordatoriosCambio = !mismoConjunto(recordatoriosAntes, minutos);
    const relevante =
      reprogramado || responsableCambio || participantesCambio || recordatoriosCambio || antes.tipo !== d.tipo;

    const evento = await repo.actualizar(cliente, id, d, intervalo, sesion.id, antes.version + (relevante ? 1 : 0));
    await repo.reemplazarParticipantes(cliente, id, d.participantes);
    await repo.reemplazarRecordatorios(cliente, id, minutos);

    if (reprogramado) {
      await repo.registrarHistorial(cliente, id, sesion.id, 'REPROGRAMADO', {
        antes: { inicio: inicioAntes, fin: finAntes, todo_el_dia: antes.todo_el_dia },
        despues: { inicio: intervalo.inicio.slice(0, 16), fin: intervalo.fin.slice(0, 16), todo_el_dia: d.todo_el_dia },
      });
    } else {
      const campos = (
        [
          ['titulo', antes.titulo !== d.titulo],
          ['tipo', antes.tipo !== d.tipo],
          ['prioridad', antes.prioridad !== d.prioridad],
          ['responsable', responsableCambio],
          ['participantes', participantesCambio],
          ['recordatorios', recordatoriosCambio],
          ['expediente', (antes.causa_id ?? null) !== (d.causa_id ?? null)],
          ['lugar', (antes.lugar ?? null) !== (d.lugar ?? null) || (antes.enlace_virtual ?? null) !== (d.enlace_virtual ?? null)],
          ['visibilidad', antes.visibilidad !== d.visibilidad],
          ['descripcion', (antes.descripcion ?? null) !== (d.descripcion ?? null) || (antes.observaciones ?? null) !== (d.observaciones ?? null)],
        ] as const
      )
        .filter(([, cambio]) => cambio)
        .map(([campo]) => campo);
      await repo.registrarHistorial(cliente, id, sesion.id, 'EDITADO', { campos });
    }

    if (!relevante) return;

    const destinatariosAntes = destinatariosDe(antes.responsable_id, antes.creado_por_id, participantesAntes);
    const destinatarios = destinatariosDe(d.responsable_id, antes.creado_por_id, d.participantes);

    await cancelarPendientesDeEvento(cliente, id, 'OBSOLETO', ['RECORDATORIO_EVENTO', 'EVENTO_ASIGNADO', 'EVENTO_REPROGRAMADO']);
    await programarRecordatorios(cliente, evento, destinatarios, minutos);

    const nuevos = destinatarios.filter((u) => !destinatariosAntes.includes(u) && u !== sesion.id);
    await avisar(cliente, 'EVENTO_ASIGNADO', evento, nuevos);

    if (reprogramado) {
      const siguen = destinatarios.filter((u) => destinatariosAntes.includes(u) && u !== sesion.id);
      await avisar(cliente, 'EVENTO_REPROGRAMADO', evento, siguen, {
        fecha_anterior: antes.fecha_inicio,
        hora_anterior: antes.todo_el_dia ? null : antes.hora_inicio,
      });
    }
  });

  return { antes: antesDetalle, id };
}

export async function cambiarEstado(
  id: string,
  { estado, motivo }: DatosEstadoEvento,
  sesion: SesionUsuario,
): Promise<EventoDetalle> {
  await enTransaccion(async (cliente) => {
    const antes = await repo.buscar(cliente, id, lectorDe(sesion), true);
    if (!antes) throw new ErrorNoEncontrado('No encontramos ese evento.');
    if (!puedeModificar(antes, antes.creado_por_id, sesion)) {
      throw new ErrorAutorizacion('Solo quien creó el evento, su responsable o la dirección del estudio pueden modificarlo.');
    }
    if (antes.estado === estado) throw new ErrorConflicto('El evento ya está en ese estado.');

    const estabaAbierto = ESTADOS_ABIERTOS.includes(antes.estado);
    const quedaAbierto = ESTADOS_ABIERTOS.includes(estado);
    if (estado === 'CONFIRMADO' && !estabaAbierto) {
      throw new ErrorConflicto('Reabrí el evento antes de confirmarlo.');
    }
    if (!quedaAbierto && !estabaAbierto) {
      throw new ErrorConflicto('El evento ya está cerrado. Reabrilo primero.');
    }

    // Cerrar o reabrir cambia qué avisos valen: sube la versión.
    const cambiaAvisos = estabaAbierto !== quedaAbierto;
    const evento = await repo.cambiarEstado(cliente, id, estado, motivo, sesion.id, antes.version + (cambiaAvisos ? 1 : 0));

    const accion: repo.AccionHistorial =
      estado === 'CANCELADO'
        ? 'CANCELADO'
        : estado === 'COMPLETADO'
          ? 'COMPLETADO'
          : estado === 'CONFIRMADO'
            ? 'CONFIRMADO'
            : estabaAbierto
              ? 'EDITADO'
              : 'REABIERTO';
    await repo.registrarHistorial(cliente, id, sesion.id, accion, { estado_anterior: antes.estado, estado }, motivo);

    const participantes = ((await repo.participantesDe(cliente, [id])).get(id) ?? []).map((p) => p.id);
    const destinatarios = destinatariosDe(antes.responsable_id, antes.creado_por_id, participantes);

    if (!quedaAbierto) {
      await cancelarPendientesDeEvento(cliente, id, estado === 'CANCELADO' ? 'EVENTO_CANCELADO' : 'EVENTO_COMPLETADO');
      if (estado === 'CANCELADO') {
        await avisar(cliente, 'EVENTO_CANCELADO', evento, destinatarios.filter((u) => u !== sesion.id));
      }
    } else if (!estabaAbierto) {
      await programarRecordatorios(cliente, evento, destinatarios, await repo.recordatoriosDe(cliente, id));
    }
  });
  return detalle(id, sesion);
}

/* --- Conflictos de horario ---------------------------------------------------------- */

export async function conflictos(
  d: DatosConflictos,
  sesion: SesionUsuario,
): Promise<{ conflictos: Omit<repo.Conflicto, 'visible'>[]; ocultos: number }> {
  if (d.todo_el_dia || !d.hora_inicio) return { conflictos: [], ocultos: 0 };
  const usuarios = unicos([d.responsable ?? sesion.id, ...d.participantes]);
  const intervalo = intervaloLocal({ ...d, todo_el_dia: false });
  const filas = await repo.conflictos(intervalo, usuarios, d.excluir, lectorDe(sesion));
  // De un evento que no puede ver, quien consulta solo sabe que hay "otro compromiso".
  return {
    conflictos: filas.filter((f) => f.visible).map(({ visible: _v, ...resto }) => resto),
    ocultos: filas.filter((f) => !f.visible).length,
  };
}

/* --- Vista unificada -------------------------------------------------------------- */

export interface ItemAgenda {
  clave: string;
  origen: 'EVENTO' | 'PLAZO' | 'TAREA' | 'DIA_INHABIL';
  id: string;
  tipo: TipoAgenda;
  titulo: string;
  /** `YYYY-MM-DDTHH:mm` si tiene hora; `YYYY-MM-DD` si es de día completo. */
  inicio: string;
  fin: string;
  todo_el_dia: boolean;
  estado: string;
  prioridad: string | null;
  responsable_id: string | null;
  responsable: string | null;
  causa_id: string | null;
  caratula: string | null;
  numero_expediente: string | null;
  lugar: string | null;
  /** Gravedad de la alerta vigente de un plazo (por días hábiles), si tiene. */
  nivel: string | null;
  ruta: string;
  editable: boolean;
}

function estadosEventos(f: FiltrosAgenda): string[] {
  if (f.estado) return [f.estado];
  return [...ESTADOS_ABIERTOS, ...(f.completados ? ['COMPLETADO'] : []), ...(f.cancelados ? ['CANCELADO'] : [])];
}

function estadosPlazos(f: FiltrosAgenda): string[] {
  const abiertos = ['PENDIENTE', 'VENCIDO', 'SUSPENDIDO'];
  if (f.estado === 'PENDIENTE') return abiertos;
  if (f.estado === 'COMPLETADO') return ['CUMPLIDO'];
  if (f.estado === 'CANCELADO') return ['CANCELADO'];
  if (f.estado === 'CONFIRMADO') return [];
  return [...abiertos, ...(f.completados ? ['CUMPLIDO'] : []), ...(f.cancelados ? ['CANCELADO'] : [])];
}

function estadosTareas(f: FiltrosAgenda): string[] {
  const abiertas = ['PENDIENTE', 'EN_CURSO'];
  if (f.estado === 'PENDIENTE') return abiertas;
  if (f.estado === 'COMPLETADO') return ['COMPLETADA'];
  if (f.estado === 'CANCELADO') return ['CANCELADA'];
  if (f.estado === 'CONFIRMADO') return [];
  return [...abiertas, ...(f.completados ? ['COMPLETADA'] : []), ...(f.cancelados ? ['CANCELADA'] : [])];
}

export interface RespuestaAgenda {
  desde: string;
  hasta: string;
  hoy: string;
  ahora: string;
  zona: string;
  datos: ItemAgenda[];
}

export async function listar(f: FiltrosAgenda, sesion: SesionUsuario): Promise<RespuestaAgenda> {
  const lector = lectorDe(sesion);
  const parametros: repo.ParametrosRango = {
    desde: f.desde,
    hasta: f.hasta,
    lector,
    responsable: f.responsable,
    causa: f.causa,
    prioridad: f.prioridad,
    soloMios: f.alcance === 'mios',
  };
  const tiposEvento = f.tipos.filter((t) => (TIPOS_EVENTO as readonly string[]).includes(t));
  const verPlazos = f.tipos.includes('PLAZO') && sesion.permisos.includes('plazo.ver') && !f.prioridad;
  const verTareas = f.tipos.includes('TAREA') && sesion.permisos.includes('tarea.ver');
  // Los días inhábiles son contexto: se muestran mientras no se filtre por algo que no tienen.
  const verInhabiles =
    f.tipos.includes('INHABIL') && !f.responsable && !f.causa && !f.estado && !f.prioridad && f.alcance === 'estudio';

  const [eventos, plazos, tareas, inhabiles] = await Promise.all([
    repo.eventosEnRango(parametros, tiposEvento, estadosEventos(f)),
    verPlazos ? repo.plazosEnRango(parametros, estadosPlazos(f)) : [],
    verTareas ? repo.tareasEnRango(parametros, estadosTareas(f)) : [],
    verInhabiles ? repo.inhabilesEnRango(f.desde, f.hasta) : [],
  ]);

  const niveles = new Map<string, string>();
  if (plazos.length) {
    for (const alerta of await vigentes()) niveles.set(alerta.plazo_id, alerta.nivel);
  }

  const puedeEditar = sesion.permisos.includes('agenda.editar');
  const datos: ItemAgenda[] = [
    ...eventos.map<ItemAgenda>((e) => ({
      clave: `EVENTO:${e.id}`,
      origen: 'EVENTO',
      id: e.id,
      tipo: e.tipo,
      titulo: e.titulo,
      inicio: e.todo_el_dia ? e.fecha_inicio : e.inicio,
      fin: e.todo_el_dia ? e.fecha_fin : e.fin,
      todo_el_dia: e.todo_el_dia,
      estado: e.estado,
      prioridad: e.prioridad,
      responsable_id: e.responsable_id,
      responsable: e.responsable,
      causa_id: e.causa_id,
      caratula: e.caratula,
      numero_expediente: e.numero_expediente,
      lugar: e.lugar,
      nivel: null,
      ruta: `/agenda?evento=${e.id}`,
      editable: puedeEditar && ESTADOS_ABIERTOS.includes(e.estado) && puedeModificar(e, e.creado_por, sesion),
    })),
    ...plazos.map<ItemAgenda>((p) => ({
      clave: `PLAZO:${p.id}`,
      origen: 'PLAZO',
      id: p.id,
      tipo: 'PLAZO',
      titulo: p.titulo,
      inicio: p.fecha,
      fin: p.fecha,
      todo_el_dia: true,
      estado: p.estado,
      prioridad: null,
      responsable_id: p.responsable_id,
      responsable: p.responsable,
      causa_id: p.causa_id,
      caratula: p.caratula,
      numero_expediente: p.numero_expediente,
      lugar: null,
      nivel: niveles.get(p.id) ?? null,
      ruta: `/expedientes/${p.causa_id}?pestana=plazos`,
      editable: false,
    })),
    ...tareas.map<ItemAgenda>((t) => ({
      clave: `TAREA:${t.id}`,
      origen: 'TAREA',
      id: t.id,
      tipo: 'TAREA',
      titulo: t.titulo,
      inicio: t.fecha,
      fin: t.fecha,
      todo_el_dia: true,
      estado: t.estado,
      prioridad: t.prioridad,
      responsable_id: t.responsable_id,
      responsable: t.responsable,
      causa_id: t.causa_id,
      caratula: t.caratula,
      numero_expediente: t.numero_expediente,
      lugar: null,
      nivel: null,
      ruta: '/tareas',
      editable: false,
    })),
    ...inhabiles.map<ItemAgenda>((d) => ({
      clave: `DIA_INHABIL:${d.id}`,
      origen: 'DIA_INHABIL',
      id: d.id,
      tipo: 'INHABIL',
      titulo: d.motivo,
      inicio: d.fecha,
      fin: d.fecha,
      todo_el_dia: true,
      estado: d.tipo,
      prioridad: null,
      responsable_id: null,
      responsable: null,
      causa_id: null,
      caratula: null,
      numero_expediente: null,
      lugar: null,
      nivel: null,
      ruta: '/calendario',
      editable: false,
    })),
  ];

  datos.sort((a, b) => a.inicio.localeCompare(b.inicio) || a.titulo.localeCompare(b.titulo));

  const ahora = new Date();
  return {
    desde: f.desde,
    hasta: f.hasta,
    hoy: hoy(ahora),
    ahora: `${fechaEnZona(ahora, config.zonaHoraria)}T${horaEnZona(ahora, config.zonaHoraria)}`,
    zona: config.zonaHoraria,
    datos,
  };
}

export { reglasPorTipo } from './repositorio';
