import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requierePermiso } from '../../middlewares/autenticacion';
import { consultaValidada, validarConsulta } from '../../middlewares/validacion';
import { armarPagina, desplazamiento, esquemaPaginacion } from '../../comun/paginacion';
import { obtenerPool } from '../../db';

/**
 * Consulta de la auditoría (`/api/auditoria`, permiso `auditoria.ver`).
 *
 * Solo lectura: la tabla se escribe desde `registrar()` en cada operación y no
 * existe ninguna ruta que la modifique o la borre.
 */

const esquemaFiltros = esquemaPaginacion.extend({
  entidad: z.string().trim().max(50).optional(),
  accion: z.enum(['CREAR', 'ACTUALIZAR', 'ELIMINAR', 'CONSULTAR', 'EXPORTAR', 'LOGIN', 'LOGOUT', 'LOGIN_FALLIDO', 'CAMBIO_PERMISOS']).optional(),
  usuario: z.uuid().optional(),
  desde: z.iso.date().optional(),
  hasta: z.iso.date().optional(),
});

type Filtros = z.infer<typeof esquemaFiltros>;

export const rutasAuditoria = Router();

rutasAuditoria.get(
  '/',
  requierePermiso('auditoria.ver'),
  validarConsulta(esquemaFiltros),
  async (req: Request, res: Response) => {
    const f = consultaValidada<Filtros>(req);
    const partes = ['TRUE'];
    const valores: unknown[] = [];
    const agregar = (sql: (n: number) => string, valor: unknown) => {
      valores.push(valor);
      partes.push(sql(valores.length));
    };
    if (f.entidad) agregar((n) => `a.entidad = $${n}`, f.entidad);
    if (f.accion) agregar((n) => `a.accion = $${n}`, f.accion);
    if (f.usuario) agregar((n) => `a.usuario_id = $${n}`, f.usuario);
    if (f.desde) agregar((n) => `a.ocurrido_en >= $${n}::date`, f.desde);
    // `hasta` incluye el día entero.
    if (f.hasta) agregar((n) => `a.ocurrido_en < ($${n}::date + 1)`, f.hasta);
    const donde = partes.join(' AND ');

    const pool = obtenerPool();
    const [datos, total, entidades] = await Promise.all([
      pool.query(
        `SELECT a.id, a.ocurrido_en AS fecha, a.entidad, a.entidad_id, a.accion, a.datos_antes, a.datos_despues,
                a.ip::text AS ip, (u.nombre || ' ' || u.apellido) AS usuario
           FROM auditoria a LEFT JOIN usuario u ON u.id = a.usuario_id
          WHERE ${donde}
          ORDER BY a.ocurrido_en DESC
          LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
        [...valores, f.tamano, desplazamiento(f)],
      ),
      pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM auditoria a WHERE ${donde}`, valores),
      pool.query<{ entidad: string }>('SELECT DISTINCT entidad FROM auditoria ORDER BY entidad'),
    ]);

    res.json({
      ...armarPagina(datos.rows, total.rows[0]?.total ?? 0, f),
      entidades: entidades.rows.map((fila) => fila.entidad),
    });
  },
);
