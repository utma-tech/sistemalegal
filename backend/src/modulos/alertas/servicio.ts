import { obtenerPool } from '../../db';
import { hoy } from '../../comun/ruta';
import {
  habilesRestantes,
  mensajeAlerta,
  nivelVigente,
  reglasDe,
  reglasDisparadas,
  sumarDias,
  type Nivel,
  type Regla,
} from './evaluacion';

/**
 * Alertas y notificaciones.
 *
 * **No hay un proceso programado.** En Render gratis el servicio se duerme y un
 * cron interno no correría; uno externo es una pieza más que mantener. En su
 * lugar las alertas se evalúan cuando alguien las consulta —la bandeja de
 * notificaciones se pide al abrir la aplicación—, y el resultado se guarda en
 * `alerta` y `notificacion` de forma idempotente (índice único plazo + regla):
 * evaluar dos veces no duplica nada.
 *
 * Si más adelante se quiere un aviso por correo a hora fija, alcanza con que un
 * cron llame a la misma `evaluarYRegistrar()`.
 */

/** Horizonte de evaluación: ninguna regla razonable avisa con más de dos meses. */
const HORIZONTE_DIAS = 60;

export interface AlertaVigente {
  plazo_id: string;
  causa_id: string;
  caratula: string;
  numero_expediente: string | null;
  descripcion: string;
  fecha_vencimiento: string;
  responsable_id: string | null;
  responsable: string | null;
  habiles_restantes: number;
  nivel: Nivel;
  mensaje: string;
}

interface PlazoAbierto {
  id: string;
  causa_id: string;
  caratula: string;
  numero_expediente: string | null;
  descripcion: string;
  fecha_vencimiento: string;
  tipo_plazo_id: string | null;
  jurisdiccion_id: string;
  responsable_id: string | null;
  responsable: string | null;
}

interface Evaluacion {
  plazo: PlazoAbierto;
  habiles: number;
  reglas: Regla[];
}

async function evaluar(): Promise<Evaluacion[]> {
  const pool = obtenerPool();
  const fechaHoy = hoy();
  const tope = sumarDias(fechaHoy, HORIZONTE_DIAS);

  // Solo plazos pendientes: uno suspendido no corre, y avisar sobre él sería ruido.
  const [plazos, reglas, inhabiles] = await Promise.all([
    pool.query<PlazoAbierto>(
      `SELECT p.id, p.causa_id, c.caratula, c.numero_expediente, p.descripcion,
              to_char(p.fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
              p.tipo_plazo_id, f.jurisdiccion_id, p.responsable_id,
              (u.nombre || ' ' || u.apellido) AS responsable
         FROM plazo p
         JOIN causa c ON c.id = p.causa_id AND c.eliminado_en IS NULL
         JOIN fuero f ON f.id = c.fuero_id
         LEFT JOIN usuario u ON u.id = p.responsable_id
        WHERE p.estado = 'PENDIENTE'
          AND p.fecha_vencimiento <= $1::date
        ORDER BY p.fecha_vencimiento`,
      [tope],
    ),
    pool.query<Regla>(
      `SELECT id, tipo_plazo_id, dias_anticipacion, nivel FROM regla_alerta WHERE activa`,
    ),
    pool.query<{ jurisdiccion_id: string; fecha: string }>(
      `SELECT jurisdiccion_id, to_char(fecha, 'YYYY-MM-DD') AS fecha
         FROM dia_inhabil WHERE fecha BETWEEN $1::date AND $2::date`,
      [fechaHoy, tope],
    ),
  ]);

  const inhabilesPorJurisdiccion = new Map<string, Set<string>>();
  for (const fila of inhabiles.rows) {
    let conjunto = inhabilesPorJurisdiccion.get(fila.jurisdiccion_id);
    if (!conjunto) inhabilesPorJurisdiccion.set(fila.jurisdiccion_id, (conjunto = new Set()));
    conjunto.add(fila.fecha);
  }

  return plazos.rows.map((plazo) => ({
    plazo,
    habiles: habilesRestantes(
      fechaHoy,
      plazo.fecha_vencimiento,
      inhabilesPorJurisdiccion.get(plazo.jurisdiccion_id) ?? new Set(),
    ),
    reglas: reglasDe(plazo.tipo_plazo_id, reglas.rows),
  }));
}

const GRAVEDAD: Record<Nivel, number> = { CRITICA: 0, IMPORTANTE: 1, INFORMATIVA: 2 };

/** Alertas vigentes, de la más grave a la más leve. */
export async function vigentes(soloDe?: string): Promise<AlertaVigente[]> {
  const evaluaciones = await evaluar();
  const alertas: AlertaVigente[] = [];

  for (const { plazo, habiles, reglas } of evaluaciones) {
    if (soloDe && plazo.responsable_id !== soloDe) continue;
    const nivel = nivelVigente(habiles, reglas);
    if (!nivel) continue;
    alertas.push({
      plazo_id: plazo.id,
      causa_id: plazo.causa_id,
      caratula: plazo.caratula,
      numero_expediente: plazo.numero_expediente,
      descripcion: plazo.descripcion,
      fecha_vencimiento: plazo.fecha_vencimiento,
      responsable_id: plazo.responsable_id,
      responsable: plazo.responsable,
      habiles_restantes: habiles,
      nivel,
      mensaje: mensajeAlerta(plazo.descripcion, plazo.caratula, habiles),
    });
  }

  return alertas.sort(
    (a, b) => GRAVEDAD[a.nivel] - GRAVEDAD[b.nivel] || a.habiles_restantes - b.habiles_restantes,
  );
}

const TITULOS: Record<Nivel, string> = {
  CRITICA: 'Vencimiento crítico',
  IMPORTANTE: 'Vencimiento próximo',
  INFORMATIVA: 'Vencimiento a la vista',
};

/**
 * Registra las alertas disparadas y notifica al responsable.
 *
 * Por cada regla disparada se inserta una fila en `alerta` (una sola vez por
 * plazo y regla). Al responsable se le manda **una** notificación por
 * evaluación —la del nivel más grave entre las alertas nuevas—, para que un
 * plazo cargado con un día de margen no genere tres avisos juntos.
 *
 * Devuelve cuántas notificaciones creó.
 */
export async function evaluarYRegistrar(): Promise<number> {
  const evaluaciones = await evaluar();
  const pool = obtenerPool();
  const fechaHoy = hoy();
  let creadas = 0;

  for (const { plazo, habiles, reglas } of evaluaciones) {
    const disparadas = reglasDisparadas(habiles, reglas);
    if (disparadas.length === 0) continue;

    const mensaje = mensajeAlerta(plazo.descripcion, plazo.caratula, habiles);
    const nuevas: { id: string; nivel: Nivel }[] = [];

    for (const regla of disparadas) {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO alerta (plazo_id, regla_alerta_id, nivel, fecha_programada, mensaje,
                             estado, disparada_en)
         VALUES ($1, $2, $3, $4::date, $5, 'DISPARADA', now())
         ON CONFLICT (plazo_id, regla_alerta_id) WHERE regla_alerta_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [plazo.id, regla.id, regla.nivel, fechaHoy, mensaje],
      );
      if (rows[0]) nuevas.push({ id: rows[0].id, nivel: regla.nivel });
    }

    if (nuevas.length === 0 || !plazo.responsable_id) continue;
    const masGrave = nuevas.sort((a, b) => GRAVEDAD[a.nivel] - GRAVEDAD[b.nivel])[0]!;

    await pool.query(
      `INSERT INTO notificacion (usuario_id, alerta_id, titulo, mensaje, canal, enviada_en)
       VALUES ($1, $2, $3, $4, 'IN_APP', now())`,
      [plazo.responsable_id, masGrave.id, TITULOS[masGrave.nivel], mensaje],
    );
    creadas += 1;
  }

  return creadas;
}

/**
 * Evaluación con un mínimo intervalo entre corridas.
 *
 * La bandeja se pide en cada carga de la aplicación; recorrer todos los plazos
 * en cada una sería trabajo repetido. Con cinco minutos entre evaluaciones un
 * aviso nuevo tarda, como mucho, eso en aparecer.
 */
let ultimaEvaluacion = 0;
let evaluacionEnCurso: Promise<unknown> | undefined;
const INTERVALO_MS = 5 * 60 * 1000;

export async function evaluarSiCorresponde(): Promise<void> {
  if (Date.now() - ultimaEvaluacion < INTERVALO_MS) return;
  evaluacionEnCurso ??= evaluarYRegistrar()
    .then(() => {
      ultimaEvaluacion = Date.now();
    })
    .catch((error: unknown) => {
      // Una falla al evaluar no tiene que dejar sin bandeja al usuario.
      console.error('[alertas] no se pudo evaluar', error);
    })
    .finally(() => {
      evaluacionEnCurso = undefined;
    });
  await evaluacionEnCurso;
}

/** Fuerza la próxima evaluación. Lo usan las pruebas y el alta de un plazo. */
export function invalidarEvaluacion(): void {
  ultimaEvaluacion = 0;
}

export interface Notificacion {
  id: string;
  titulo: string;
  mensaje: string;
  nivel: Nivel | null;
  causa_id: string | null;
  leida_en: string | null;
  creado_en: string;
}

export async function bandeja(usuarioId: string): Promise<{ datos: Notificacion[]; no_leidas: number }> {
  const pool = obtenerPool();
  const [datos, conteo] = await Promise.all([
    pool.query<Notificacion>(
      `SELECT n.id, n.titulo, n.mensaje, a.nivel, p.causa_id, n.leida_en, n.creado_en
         FROM notificacion n
         LEFT JOIN alerta a ON a.id = n.alerta_id
         LEFT JOIN plazo  p ON p.id = a.plazo_id
        WHERE n.usuario_id = $1
        ORDER BY (n.leida_en IS NULL) DESC, n.creado_en DESC
        LIMIT 30`,
      [usuarioId],
    ),
    pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM notificacion WHERE usuario_id = $1 AND leida_en IS NULL`,
      [usuarioId],
    ),
  ]);
  return { datos: datos.rows, no_leidas: conteo.rows[0]?.total ?? 0 };
}

/** Marca como leída una notificación propia. Las de otro usuario no se tocan. */
export async function marcarLeida(usuarioId: string, id: string): Promise<boolean> {
  const { rowCount } = await obtenerPool().query(
    `UPDATE notificacion SET leida_en = now()
      WHERE id = $1 AND usuario_id = $2 AND leida_en IS NULL`,
    [id, usuarioId],
  );
  return (rowCount ?? 0) > 0;
}

export async function marcarTodasLeidas(usuarioId: string): Promise<number> {
  const { rowCount } = await obtenerPool().query(
    `UPDATE notificacion SET leida_en = now() WHERE usuario_id = $1 AND leida_en IS NULL`,
    [usuarioId],
  );
  return rowCount ?? 0;
}
