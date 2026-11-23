import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requierePermiso } from '../../middlewares/autenticacion';
import { causasAsignadas, usuarioAcotado } from '../../comun/alcance';
import { consultaValidada, validarConsulta } from '../../middlewares/validacion';
import { idDeRuta } from '../../comun/ruta';
import * as servicio from './servicio';

/**
 * Alertas de vencimiento (`/api/alertas`) y bandeja de notificaciones
 * (`/api/notificaciones`).
 */

export const rutasAlertas = Router();

const esquemaFiltros = z.object({
  /** 'mias' = solo los plazos de los que soy responsable. */
  alcance: z.enum(['todas', 'mias']).default('todas'),
});

rutasAlertas.get(
  '/',
  requierePermiso('alerta.ver'),
  validarConsulta(esquemaFiltros),
  async (req: Request, res: Response) => {
    const { alcance } = consultaValidada<z.infer<typeof esquemaFiltros>>(req);
    let datos = await servicio.vigentes(alcance === 'mias' ? req.sesion!.id : undefined);
    // La evaluación se calcula una vez para todo el estudio (y se cachea); el
    // alcance por expediente se aplica después, sobre el resultado.
    const usuario = usuarioAcotado(req);
    if (usuario) {
      const propias = await causasAsignadas(usuario);
      datos = datos.filter((a) => a.responsable_id === usuario || propias.has(a.causa_id));
    }
    res.json({
      datos,
      resumen: {
        CRITICA: datos.filter((a) => a.nivel === 'CRITICA').length,
        IMPORTANTE: datos.filter((a) => a.nivel === 'IMPORTANTE').length,
        INFORMATIVA: datos.filter((a) => a.nivel === 'INFORMATIVA').length,
      },
    });
  },
);

/** Evaluación a pedido: para un cron externo o para el botón "actualizar". */
rutasAlertas.post('/evaluar', requierePermiso('alerta.editar'), async (_req: Request, res: Response) => {
  servicio.invalidarEvaluacion();
  const creadas = await servicio.evaluarYRegistrar();
  res.json({ notificaciones_creadas: creadas });
});

/**
 * La bandeja es de cada usuario: no exige más permiso que tener sesión, y solo
 * muestra y modifica las notificaciones propias.
 */
export const rutasNotificaciones = Router();

rutasNotificaciones.get('/', async (req: Request, res: Response) => {
  await servicio.evaluarSiCorresponde();
  res.json(await servicio.bandeja(req.sesion!.id));
});

rutasNotificaciones.post('/leer-todas', async (req: Request, res: Response) => {
  res.json({ marcadas: await servicio.marcarTodasLeidas(req.sesion!.id) });
});

rutasNotificaciones.post('/:id/leer', async (req: Request, res: Response) => {
  const marcada = await servicio.marcarLeida(req.sesion!.id, idDeRuta(req, 'aviso'));
  res.json({ marcada });
});
