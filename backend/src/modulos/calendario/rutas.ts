import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requierePermiso } from '../../middlewares/autenticacion';
import { consultaValidada, validarConsulta, validarCuerpo } from '../../middlewares/validacion';
import { idDeRuta } from '../../comun/ruta';
import { ErrorNoEncontrado, ErrorSolicitud } from '../../comun/errores';
import { obtenerPool } from '../../db';
import { registrar } from '../auditoria/servicio';

/**
 * Calendario de días inhábiles, montado en `/api/calendario`.
 *
 * Es el dato del que depende todo el cómputo de plazos: un feriado que falta
 * corre un vencimiento sin que nadie lo note. Hasta ahora solo se podía cargar
 * por SQL; esta es la pantalla para mantenerlo año a año.
 *
 * El módulo es chico y no tiene reglas propias más allá de validar fechas, así
 * que rutas, reglas y SQL viven juntos en este archivo.
 *
 * Se trabaja sobre la jurisdicción del estudio (tabla `estudio`), que es la de
 * todas sus causas en esta versión.
 */

export const TIPOS_INHABIL = [
  'FERIADO_NACIONAL',
  'FERIADO_PROVINCIAL',
  'FERIA_JUDICIAL',
  'ASUETO',
  'OTRO',
] as const;

/** Tope de días por alta: una feria de enero son 31. Un año entero es un error de carga. */
const MAXIMO_DIAS_POR_ALTA = 62;

const esquemaFiltros = z.object({
  anio: z.coerce.number().int().min(2000).max(2100).optional(),
});

const esquemaAlta = z
  .object({
    fecha_desde: z.iso.date('Indicá la fecha.'),
    /** Si se indica, se carga un día por cada fecha del rango (la feria, por ejemplo). */
    fecha_hasta: z.iso
      .date('Fecha de fin inválida.')
      .optional()
      .or(z.literal(''))
      .transform((v) => v || undefined),
    tipo: z.enum(TIPOS_INHABIL, 'Elegí el tipo de día.'),
    motivo: z.string().trim().min(1, 'Indicá el motivo.').max(200, 'Máximo 200 caracteres.'),
    /** En un rango, omitir sábados y domingos (ya son inhábiles para el cómputo). */
    omitir_fines_de_semana: z.boolean().default(false),
  })
  .refine((d) => !d.fecha_hasta || d.fecha_hasta >= d.fecha_desde, {
    message: 'El fin del rango no puede ser anterior al comienzo.',
    path: ['fecha_hasta'],
  });

const esquemaEdicion = z.object({
  tipo: z.enum(TIPOS_INHABIL, 'Elegí el tipo de día.'),
  motivo: z.string().trim().min(1, 'Indicá el motivo.').max(200, 'Máximo 200 caracteres.'),
});

const esquemaCopia = z.object({
  anio_origen: z.coerce.number().int().min(2000).max(2100),
  anio_destino: z.coerce.number().int().min(2000).max(2100),
  /** Solo los de fecha fija tienen sentido copiar; los trasladables cambian cada año. */
  tipos: z.array(z.enum(TIPOS_INHABIL)).min(1, 'Elegí al menos un tipo.').default(['FERIADO_NACIONAL']),
});

export interface DiaInhabilFila {
  id: string;
  fecha: string;
  tipo: string;
  motivo: string;
  dia_semana: number;
}

async function jurisdiccionDelEstudio(): Promise<string> {
  const { rows } = await obtenerPool().query<{ id: string }>(
    `SELECT jurisdiccion_id AS id FROM estudio
     UNION ALL
     SELECT id FROM (SELECT id FROM jurisdiccion ORDER BY codigo LIMIT 1) j
     LIMIT 1`,
  );
  const id = rows[0]?.id;
  if (!id) throw new ErrorNoEncontrado('No hay una jurisdicción configurada para el estudio.');
  return id;
}

const COLUMNAS = `id, to_char(fecha, 'YYYY-MM-DD') AS fecha, tipo, motivo,
                  EXTRACT(ISODOW FROM fecha)::int AS dia_semana`;

export const rutasCalendario = Router();

rutasCalendario.get(
  '/inhabiles',
  requierePermiso('calendario.ver'),
  validarConsulta(esquemaFiltros),
  async (req: Request, res: Response) => {
    const { anio } = consultaValidada<z.infer<typeof esquemaFiltros>>(req);
    const jurisdiccion = await jurisdiccionDelEstudio();
    const pool = obtenerPool();

    const [dias, anios] = await Promise.all([
      pool.query<DiaInhabilFila>(
        `SELECT ${COLUMNAS} FROM dia_inhabil
          WHERE jurisdiccion_id = $1
            AND ($2::int IS NULL OR EXTRACT(YEAR FROM fecha) = $2::int)
          ORDER BY fecha`,
        [jurisdiccion, anio ?? null],
      ),
      pool.query<{ anio: number; cantidad: number }>(
        `SELECT EXTRACT(YEAR FROM fecha)::int AS anio, count(*)::int AS cantidad
           FROM dia_inhabil WHERE jurisdiccion_id = $1
          GROUP BY 1 ORDER BY 1`,
        [jurisdiccion],
      ),
    ]);

    res.json({ datos: dias.rows, anios: anios.rows });
  },
);

rutasCalendario.post(
  '/inhabiles',
  requierePermiso('calendario.crear'),
  validarCuerpo(esquemaAlta),
  async (req: Request, res: Response) => {
    const datos = req.body as z.infer<typeof esquemaAlta>;
    const hasta = datos.fecha_hasta ?? datos.fecha_desde;

    const { rows: rango } = await obtenerPool().query<{ dias: number }>(
      'SELECT ($2::date - $1::date + 1)::int AS dias',
      [datos.fecha_desde, hasta],
    );
    if ((rango[0]?.dias ?? 0) > MAXIMO_DIAS_POR_ALTA) {
      throw new ErrorSolicitud('Revisá los datos del formulario.', {
        fecha_hasta: [`Un rango puede tener hasta ${MAXIMO_DIAS_POR_ALTA} días.`],
      });
    }

    const jurisdiccion = await jurisdiccionDelEstudio();
    // ON CONFLICT: un día ya cargado se conserva con su motivo. Se informa
    // cuántos se omitieron para que no parezca que se pisaron.
    const { rows } = await obtenerPool().query<DiaInhabilFila>(
      `INSERT INTO dia_inhabil (jurisdiccion_id, fecha, tipo, motivo)
       SELECT $1, d::date, $4, $5
         FROM generate_series($2::date, $3::date, INTERVAL '1 day') AS d
        WHERE NOT $6::boolean OR EXTRACT(ISODOW FROM d) < 6
       ON CONFLICT (jurisdiccion_id, fecha) DO NOTHING
       RETURNING ${COLUMNAS}`,
      [jurisdiccion, datos.fecha_desde, hasta, datos.tipo, datos.motivo, datos.omitir_fines_de_semana],
    );

    const total = rango[0]?.dias ?? 1;
    await registrar(req, { entidad: 'dia_inhabil', accion: 'CREAR', datosDespues: rows });

    res.status(201).json({ creados: rows, omitidos: Math.max(0, total - rows.length) });
  },
);

/**
 * Copia los feriados de fecha fija de un año a otro.
 *
 * El 1/1, el 25/5 o el 25/12 caen igual todos los años; los trasladables no, y
 * por eso solo se copian los tipos que el usuario elige. Es lo que hace viable
 * mantener el calendario sin cargar doce filas a mano cada enero.
 */
rutasCalendario.post(
  '/inhabiles/copiar',
  requierePermiso('calendario.crear'),
  validarCuerpo(esquemaCopia),
  async (req: Request, res: Response) => {
    const datos = req.body as z.infer<typeof esquemaCopia>;
    if (datos.anio_origen === datos.anio_destino) {
      throw new ErrorSolicitud('Revisá los datos del formulario.', {
        anio_destino: ['Elegí un año distinto al de origen.'],
      });
    }

    const jurisdiccion = await jurisdiccionDelEstudio();
    // make_date falla con el 29/2 en un año no bisiesto: esos se descartan.
    const { rows } = await obtenerPool().query<DiaInhabilFila>(
      `INSERT INTO dia_inhabil (jurisdiccion_id, fecha, tipo, motivo)
       SELECT jurisdiccion_id,
              make_date($3, EXTRACT(MONTH FROM fecha)::int, EXTRACT(DAY FROM fecha)::int),
              tipo, motivo
         FROM dia_inhabil
        WHERE jurisdiccion_id = $1
          AND EXTRACT(YEAR FROM fecha) = $2
          AND tipo = ANY($4::varchar[])
          AND NOT (EXTRACT(MONTH FROM fecha) = 2 AND EXTRACT(DAY FROM fecha) = 29)
       ON CONFLICT (jurisdiccion_id, fecha) DO NOTHING
       RETURNING ${COLUMNAS}`,
      [jurisdiccion, datos.anio_origen, datos.anio_destino, datos.tipos],
    );

    await registrar(req, { entidad: 'dia_inhabil', accion: 'CREAR', datosDespues: rows });
    res.status(201).json({ creados: rows });
  },
);

rutasCalendario.put(
  '/inhabiles/:id',
  requierePermiso('calendario.editar'),
  validarCuerpo(esquemaEdicion),
  async (req: Request, res: Response) => {
    const id = idDeRuta(req, 'día');
    const datos = req.body as z.infer<typeof esquemaEdicion>;
    const pool = obtenerPool();

    const antes = await pool.query<DiaInhabilFila>(`SELECT ${COLUMNAS} FROM dia_inhabil WHERE id = $1`, [id]);
    if (!antes.rows[0]) throw new ErrorNoEncontrado('No encontramos ese día.');

    const { rows } = await pool.query<DiaInhabilFila>(
      `UPDATE dia_inhabil SET tipo = $2, motivo = $3 WHERE id = $1 RETURNING ${COLUMNAS}`,
      [id, datos.tipo, datos.motivo],
    );

    await registrar(req, {
      entidad: 'dia_inhabil',
      entidadId: id,
      accion: 'ACTUALIZAR',
      datosAntes: antes.rows[0],
      datosDespues: rows[0],
    });
    res.json({ dia: rows[0] });
  },
);

rutasCalendario.delete(
  '/inhabiles/:id',
  requierePermiso('calendario.eliminar'),
  async (req: Request, res: Response) => {
    const id = idDeRuta(req, 'día');
    const { rows } = await obtenerPool().query<DiaInhabilFila>(
      `DELETE FROM dia_inhabil WHERE id = $1 RETURNING ${COLUMNAS}`,
      [id],
    );
    if (!rows[0]) throw new ErrorNoEncontrado('No encontramos ese día.');
    await registrar(req, { entidad: 'dia_inhabil', entidadId: id, accion: 'ELIMINAR', datosAntes: rows[0] });
    res.json({ dia: rows[0] });
  },
);

