import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { requierePermiso } from '../../middlewares/autenticacion';
import { consultaValidada, validarConsulta, validarCuerpo } from '../../middlewares/validacion';
import { esquemaPaginacion, armarPagina, desplazamiento } from '../../comun/paginacion';
import { fechaOpcional, idDeRuta, textoOpcional } from '../../comun/ruta';
import { ErrorConflicto, ErrorNoEncontrado, ErrorSolicitud } from '../../comun/errores';
import { enTransaccion, obtenerPool } from '../../db';
import { registrar } from '../auditoria/servicio';
import { alcancePorRegistro, sqlCausaEnAlcance, usuarioAcotado } from '../../comun/alcance';

/**
 * Costas y cobros (`/api/costas`, y el alta bajo `/api/causas/:id/costas`).
 *
 * Una costa es lo devengado; un cobro, lo percibido. El saldo sale de la vista
 * `vw_costa_saldo`, que suma los cobros reales, y `costa.estado_cobro` se
 * recalcula en la misma transacción de cada cobro para que el tablero de
 * cobranza (que filtra por ese campo indexado) nunca contradiga a la suma.
 *
 * Los importes viajan como texto con dos decimales: son NUMERIC en la base y
 * pasarlos por un número de JavaScript introduciría errores de redondeo.
 */

const A_CARGO = ['ESTUDIO', 'CLIENTE', 'CONTRARIA'] as const;
const ESTADOS = ['PENDIENTE', 'PARCIAL', 'COBRADO', 'INCOBRABLE'] as const;
const MEDIOS = ['EFECTIVO', 'TRANSFERENCIA', 'CHEQUE', 'TARJETA', 'OTRO'] as const;

/** Importe positivo con hasta dos decimales. Acepta coma decimal, que es lo que escribe un usuario argentino. */
const importe = z
  .union([z.string(), z.number()])
  .transform((v) => {
    const texto = String(v).trim();
    // "1.234,50" → "1234.50"; "1234.50" queda igual.
    return texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto;
  })
  .pipe(
    z
      .string()
      .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Indicá un importe válido, con hasta dos decimales.')
      .refine((v) => Number(v) > 0, 'El importe tiene que ser mayor que cero.'),
  );

const esquemaCosta = z
  .object({
    concepto_costa_id: z.uuid('Elegí un concepto.'),
    descripcion: textoOpcional(300),
    monto: importe,
    fecha_devengamiento: z.iso.date('Indicá la fecha.'),
    fecha_vencimiento_pago: fechaOpcional('Fecha inválida.'),
    a_cargo_de: z.enum(A_CARGO, 'Indicá quién soporta el gasto.'),
    comprobante: textoOpcional(100),
  })
  .refine((d) => !d.fecha_vencimiento_pago || d.fecha_vencimiento_pago >= d.fecha_devengamiento, {
    message: 'El vencimiento del pago no puede ser anterior al devengamiento.',
    path: ['fecha_vencimiento_pago'],
  });

const esquemaCobro = z.object({
  monto: importe,
  fecha: z.iso.date('Indicá la fecha del cobro.'),
  medio_pago: z.enum(MEDIOS, 'Indicá el medio de pago.'),
  comprobante: textoOpcional(100),
  observaciones: textoOpcional(300),
});

const esquemaIncobrable = z.object({ incobrable: z.boolean() });

const esquemaFiltros = esquemaPaginacion.extend({
  causa: z.uuid().optional(),
  estado: z.enum(ESTADOS).optional(),
  a_cargo_de: z.enum(A_CARGO).optional(),
  /** Rango de devengamiento, para el reporte de gastos por período. */
  desde: z.iso.date().optional(),
  hasta: z.iso.date().optional(),
  /** 'pendientes' = con saldo por cobrar (PENDIENTE o PARCIAL). */
  vigencia: z.enum(['todas', 'pendientes']).default('todas'),
});

type DatosCosta = z.infer<typeof esquemaCosta>;
type DatosCobro = z.infer<typeof esquemaCobro>;
type FiltrosCosta = z.infer<typeof esquemaFiltros>;

export interface CostaFila {
  costa_id: string;
  causa_id: string;
  numero_expediente: string | null;
  caratula: string;
  concepto_costa_id: string;
  concepto: string;
  descripcion: string | null;
  monto: string;
  moneda: string;
  fecha_devengamiento: string;
  fecha_vencimiento_pago: string | null;
  a_cargo_de: string;
  estado_cobro: string;
  comprobante: string | null;
  total_cobrado: string;
  saldo_pendiente: string;
}

const COLUMNAS = `
  v.costa_id, v.causa_id, v.numero_expediente, v.caratula, co.concepto_costa_id, v.concepto,
  v.descripcion, v.monto::text AS monto, v.moneda,
  to_char(v.fecha_devengamiento, 'YYYY-MM-DD') AS fecha_devengamiento,
  to_char(v.fecha_vencimiento_pago, 'YYYY-MM-DD') AS fecha_vencimiento_pago,
  v.a_cargo_de, v.estado_cobro, co.comprobante,
  v.total_cobrado::text AS total_cobrado, v.saldo_pendiente::text AS saldo_pendiente`;

const ORIGEN = `FROM vw_costa_saldo v JOIN costa co ON co.id = v.costa_id`;

function condiciones(f: FiltrosCosta, alcance: string | null): { sql: string; valores: unknown[] } {
  const partes = ['TRUE'];
  const valores: unknown[] = [];
  const agregar = (sql: (n: number) => string, valor: unknown) => {
    valores.push(valor);
    partes.push(sql(valores.length));
  };
  // Alcance por expediente (comun/alcance.ts). Va también en los totales y en
  // la exportación: los dos usan estas mismas condiciones.
  if (alcance) agregar((n) => sqlCausaEnAlcance('v.causa_id', `$${n}`), alcance);
  if (f.causa) agregar((n) => `v.causa_id = $${n}`, f.causa);
  if (f.estado) agregar((n) => `v.estado_cobro = $${n}`, f.estado);
  if (f.a_cargo_de) agregar((n) => `v.a_cargo_de = $${n}`, f.a_cargo_de);
  if (f.desde) agregar((n) => `v.fecha_devengamiento >= $${n}::date`, f.desde);
  if (f.hasta) agregar((n) => `v.fecha_devengamiento <= $${n}::date`, f.hasta);
  if (f.vigencia === 'pendientes') partes.push(`v.estado_cobro IN ('PENDIENTE', 'PARCIAL')`);
  return { sql: partes.join(' AND '), valores };
}

async function exigirCosta(id: string): Promise<CostaFila> {
  const { rows } = await obtenerPool().query<CostaFila>(`SELECT ${COLUMNAS} ${ORIGEN} WHERE v.costa_id = $1`, [id]);
  if (!rows[0]) throw new ErrorNoEncontrado('No encontramos esa costa.');
  return rows[0];
}

/**
 * Recalcula el estado de cobro a partir de la suma real de cobros.
 * Una costa marcada INCOBRABLE se respeta: es una decisión, no un cálculo.
 */
async function recalcularEstado(cliente: PoolClient, costaId: string): Promise<void> {
  await cliente.query(
    `UPDATE costa co
        SET estado_cobro = CASE
              WHEN co.estado_cobro = 'INCOBRABLE' THEN 'INCOBRABLE'
              WHEN s.cobrado <= 0 THEN 'PENDIENTE'
              WHEN s.cobrado < co.monto THEN 'PARCIAL'
              ELSE 'COBRADO'
            END
       FROM (SELECT COALESCE(SUM(monto), 0) AS cobrado FROM cobro WHERE costa_id = $1) s
      WHERE co.id = $1`,
    [costaId],
  );
}

/** Campos del CSV, en el orden del reporte. */
const COLUMNAS_CSV: [keyof CostaFila, string][] = [
  ['numero_expediente', 'Expediente'],
  ['caratula', 'Carátula'],
  ['concepto', 'Concepto'],
  ['descripcion', 'Descripción'],
  ['fecha_devengamiento', 'Devengada'],
  ['fecha_vencimiento_pago', 'Vence el pago'],
  ['a_cargo_de', 'A cargo de'],
  ['estado_cobro', 'Estado'],
  ['monto', 'Monto'],
  ['total_cobrado', 'Cobrado'],
  ['saldo_pendiente', 'Saldo'],
  ['comprobante', 'Comprobante'],
];

/**
 * Celda CSV. Se escapan las comillas y, además, se neutralizan los valores que
 * empiezan con = + - @: Excel los interpretaría como fórmula (inyección CSV).
 * Los importes no pasan por acá con signo, así que no se alteran.
 */
function celda(valor: unknown): string {
  let texto = valor === null || valor === undefined ? '' : String(valor);
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return `"${texto.replace(/"/g, '""')}"`;
}

export const rutasCostas = Router();

// Alcance: una costa (y sus cobros) solo es visible desde su expediente.
rutasCostas.param(
  'id',
  alcancePorRegistro(
    'SELECT causa_id FROM costa WHERE id = $1 AND $2::uuid IS NOT NULL',
    'No encontramos esa costa.',
  ),
);

rutasCostas.get(
  '/',
  requierePermiso('costa.ver'),
  validarConsulta(esquemaFiltros),
  async (req: Request, res: Response) => {
    const filtros = consultaValidada<FiltrosCosta>(req);
    const { sql, valores } = condiciones(filtros, usuarioAcotado(req));
    const pool = obtenerPool();

    const [datos, totales] = await Promise.all([
      pool.query<CostaFila>(
        `SELECT ${COLUMNAS} ${ORIGEN} WHERE ${sql}
          ORDER BY v.fecha_devengamiento DESC, v.caratula
          LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
        [...valores, filtros.tamano, desplazamiento(filtros)],
      ),
      pool.query<{ cantidad: string; monto: string; cobrado: string; saldo: string }>(
        `SELECT count(*)::text AS cantidad,
                COALESCE(SUM(v.monto), 0)::text AS monto,
                COALESCE(SUM(v.total_cobrado), 0)::text AS cobrado,
                COALESCE(SUM(v.saldo_pendiente) FILTER (WHERE v.estado_cobro <> 'INCOBRABLE'), 0)::text AS saldo
           ${ORIGEN} WHERE ${sql}`,
        valores,
      ),
    ]);

    const t = totales.rows[0]!;
    res.json({
      ...armarPagina(datos.rows, Number(t.cantidad), filtros),
      totales: { monto: t.monto, cobrado: t.cobrado, saldo: t.saldo },
    });
  },
);

rutasCostas.get(
  '/exportar',
  requierePermiso('costa.exportar'),
  validarConsulta(esquemaFiltros),
  async (req: Request, res: Response) => {
    const filtros = consultaValidada<FiltrosCosta>(req);
    const { sql, valores } = condiciones(filtros, usuarioAcotado(req));
    const { rows } = await obtenerPool().query<CostaFila>(
      `SELECT ${COLUMNAS} ${ORIGEN} WHERE ${sql} ORDER BY v.fecha_devengamiento, v.caratula LIMIT 10000`,
      valores,
    );

    await registrar(req, {
      entidad: 'costa',
      accion: 'EXPORTAR',
      datosDespues: { filtros, filas: rows.length },
    });

    const lineas = [
      COLUMNAS_CSV.map(([, titulo]) => celda(titulo)).join(';'),
      ...rows.map((fila) => COLUMNAS_CSV.map(([clave]) => celda(fila[clave])).join(';')),
    ];
    // BOM + punto y coma: es lo que Excel en español abre sin asistente.
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="costas.csv"');
    res.send(`﻿${lineas.join('\r\n')}\r\n`);
  },
);

rutasCostas.get('/:id', requierePermiso('costa.ver'), async (req: Request, res: Response) => {
  const costa = await exigirCosta(idDeRuta(req, 'costa'));
  const { rows: cobros } = await obtenerPool().query(
    `SELECT cb.id, cb.monto::text AS monto, to_char(cb.fecha, 'YYYY-MM-DD') AS fecha, cb.medio_pago,
            cb.comprobante, cb.observaciones, (u.nombre || ' ' || u.apellido) AS registrado_por
       FROM cobro cb LEFT JOIN usuario u ON u.id = cb.registrado_por
      WHERE cb.costa_id = $1
      ORDER BY cb.fecha DESC, cb.creado_en DESC`,
    [costa.costa_id],
  );
  res.json({ costa, cobros });
});

rutasCostas.put(
  '/:id',
  requierePermiso('costa.editar'),
  validarCuerpo(esquemaCosta),
  async (req: Request, res: Response) => {
    const id = idDeRuta(req, 'costa');
    const datos = req.body as DatosCosta;
    const antes = await exigirCosta(id);

    if (Number(datos.monto) < Number(antes.total_cobrado)) {
      throw new ErrorSolicitud('Revisá los datos del formulario.', {
        monto: [`Ya se cobraron ${antes.total_cobrado}: el monto no puede ser menor.`],
      });
    }

    await enTransaccion(async (cliente) => {
      await cliente.query(
        `UPDATE costa SET concepto_costa_id = $2, descripcion = $3, monto = $4::numeric,
                fecha_devengamiento = $5, fecha_vencimiento_pago = $6, a_cargo_de = $7, comprobante = $8
          WHERE id = $1`,
        [
          id,
          datos.concepto_costa_id,
          datos.descripcion ?? null,
          datos.monto,
          datos.fecha_devengamiento,
          datos.fecha_vencimiento_pago ?? null,
          datos.a_cargo_de,
          datos.comprobante ?? null,
        ],
      );
      await recalcularEstado(cliente, id);
    });

    const despues = await exigirCosta(id);
    await registrar(req, { entidad: 'costa', entidadId: id, accion: 'ACTUALIZAR', datosAntes: antes, datosDespues: despues });
    res.json({ costa: despues });
  },
);

rutasCostas.post(
  '/:id/incobrable',
  requierePermiso('costa.editar'),
  validarCuerpo(esquemaIncobrable),
  async (req: Request, res: Response) => {
    const id = idDeRuta(req, 'costa');
    const { incobrable } = req.body as { incobrable: boolean };
    const antes = await exigirCosta(id);

    await enTransaccion(async (cliente) => {
      await cliente.query(
        `UPDATE costa SET estado_cobro = $2 WHERE id = $1`,
        [id, incobrable ? 'INCOBRABLE' : 'PENDIENTE'],
      );
      if (!incobrable) await recalcularEstado(cliente, id);
    });

    const despues = await exigirCosta(id);
    await registrar(req, { entidad: 'costa', entidadId: id, accion: 'ACTUALIZAR', datosAntes: antes, datosDespues: despues });
    res.json({ costa: despues });
  },
);

rutasCostas.delete('/:id', requierePermiso('costa.eliminar'), async (req: Request, res: Response) => {
  const id = idDeRuta(req, 'costa');
  const costa = await exigirCosta(id);
  // Los cobros se van con la costa (ON DELETE CASCADE); la auditoría conserva ambos.
  await obtenerPool().query('DELETE FROM costa WHERE id = $1', [id]);
  await registrar(req, { entidad: 'costa', entidadId: id, accion: 'ELIMINAR', datosAntes: costa });
  res.json({ costa });
});

rutasCostas.post(
  '/:id/cobros',
  requierePermiso('costa.editar'),
  validarCuerpo(esquemaCobro),
  async (req: Request, res: Response) => {
    const id = idDeRuta(req, 'costa');
    const datos = req.body as DatosCobro;
    const costa = await exigirCosta(id);

    if (costa.estado_cobro === 'INCOBRABLE') {
      throw new ErrorConflicto('La costa está marcada como incobrable. Revertilo antes de registrar un cobro.');
    }
    if (Number(datos.monto) > Number(costa.saldo_pendiente)) {
      throw new ErrorSolicitud('Revisá los datos del formulario.', {
        monto: [`El saldo pendiente es ${costa.saldo_pendiente}: el cobro no puede superarlo.`],
      });
    }

    const cobro = await enTransaccion(async (cliente) => {
      // Bloquea la costa: dos cobros simultáneos no pueden pasar ambos el control de saldo.
      await cliente.query('SELECT 1 FROM costa WHERE id = $1 FOR UPDATE', [id]);
      const { rows } = await cliente.query<{ id: string }>(
        `INSERT INTO cobro (costa_id, monto, fecha, medio_pago, comprobante, observaciones, registrado_por)
         VALUES ($1, $2::numeric, $3, $4, $5, $6, $7) RETURNING id`,
        [id, datos.monto, datos.fecha, datos.medio_pago, datos.comprobante ?? null, datos.observaciones ?? null, req.sesion!.id],
      );
      await recalcularEstado(cliente, id);
      return { id: rows[0]!.id, ...datos };
    });

    await registrar(req, { entidad: 'cobro', entidadId: cobro.id, accion: 'CREAR', datosDespues: cobro });
    res.status(201).json({ cobro, costa: await exigirCosta(id) });
  },
);

rutasCostas.delete(
  '/:id/cobros/:cobroId',
  requierePermiso('costa.eliminar'),
  async (req: Request, res: Response) => {
    const id = idDeRuta(req, 'costa');
    const cobroId = idDeRuta(req, 'cobro', 'cobroId');

    const borrado = await enTransaccion(async (cliente) => {
      const { rows } = await cliente.query(
        `DELETE FROM cobro WHERE id = $1 AND costa_id = $2
         RETURNING id, monto::text AS monto, to_char(fecha, 'YYYY-MM-DD') AS fecha, medio_pago`,
        [cobroId, id],
      );
      if (rows[0]) await recalcularEstado(cliente, id);
      return rows[0];
    });
    if (!borrado) throw new ErrorNoEncontrado('Ese cobro no existe en esta costa.');

    await registrar(req, { entidad: 'cobro', entidadId: cobroId, accion: 'ELIMINAR', datosAntes: borrado });
    res.json({ cobro: borrado, costa: await exigirCosta(id) });
  },
);

/** Se monta en `/api/causas/:id`: el alta de una costa cuelga de su expediente. */
export const rutasCostasDeCausa = Router({ mergeParams: true });

rutasCostasDeCausa.post(
  '/costas',
  requierePermiso('costa.crear'),
  validarCuerpo(esquemaCosta),
  async (req: Request, res: Response) => {
    const causaId = idDeRuta(req, 'expediente');
    const datos = req.body as DatosCosta;

    const { rows: causa } = await obtenerPool().query(
      'SELECT 1 FROM causa WHERE id = $1 AND eliminado_en IS NULL',
      [causaId],
    );
    if (!causa[0]) throw new ErrorNoEncontrado('No encontramos ese expediente.');

    const { rows } = await obtenerPool()
      .query<{ id: string }>(
        `INSERT INTO costa (causa_id, concepto_costa_id, descripcion, monto, fecha_devengamiento,
                            fecha_vencimiento_pago, a_cargo_de, comprobante, registrado_por)
         VALUES ($1, $2, $3, $4::numeric, $5, $6, $7, $8, $9) RETURNING id`,
        [
          causaId,
          datos.concepto_costa_id,
          datos.descripcion ?? null,
          datos.monto,
          datos.fecha_devengamiento,
          datos.fecha_vencimiento_pago ?? null,
          datos.a_cargo_de,
          datos.comprobante ?? null,
          req.sesion!.id,
        ],
      )
      .catch((error: { code?: string }) => {
        if (error.code === '23503') {
          throw new ErrorSolicitud('Revisá los datos del formulario.', {
            concepto_costa_id: ['Ese concepto no existe.'],
          });
        }
        throw error;
      });

    const costa = await exigirCosta(rows[0]!.id);
    await registrar(req, { entidad: 'costa', entidadId: costa.costa_id, accion: 'CREAR', datosDespues: costa });
    res.status(201).json({ costa });
  },
);
