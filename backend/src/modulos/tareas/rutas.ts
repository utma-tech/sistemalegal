import { Router, type Request, type Response } from 'express';
import { requierePermiso } from '../../middlewares/autenticacion';
import { consultaValidada, validarConsulta, validarCuerpo } from '../../middlewares/validacion';
import { idDeRuta } from '../../comun/ruta';
import { alcancePorRegistro, puedeAccederACausa, usuarioAcotado } from '../../comun/alcance';
import { registrar } from '../auditoria/servicio';
import * as servicio from './servicio';
import {
  esquemaEstadoTarea,
  esquemaFiltrosTarea,
  esquemaTarea,
  type DatosEstadoTarea,
  type DatosTarea,
  type FiltrosTarea,
} from './esquemas';

/**
 * Rutas de tareas, montadas en `/api/tareas`.
 *
 * Los controladores son funciones async sin try/catch: Express 5 pasa al
 * manejador central cualquier promesa rechazada, así que el error llega igual
 * que con `next(error)`.
 */

export const rutasTareas = Router();

// Alcance: una tarea se ve si es de un expediente propio, si no cuelga de
// ninguno o si se la delegaron a quien pide (comun/alcance.ts).
rutasTareas.param(
  'id',
  alcancePorRegistro(
    'SELECT CASE WHEN asignada_a = $2::uuid THEN NULL ELSE causa_id END AS causa_id FROM tarea WHERE id = $1',
    'No encontramos esa tarea.',
  ),
);

rutasTareas.get(
  '/',
  requierePermiso('tarea.ver'),
  validarConsulta(esquemaFiltrosTarea),
  async (req: Request, res: Response) => {
    res.json(await servicio.listar(consultaValidada<FiltrosTarea>(req), usuarioAcotado(req)));
  },
);

rutasTareas.get('/:id', requierePermiso('tarea.ver'), async (req: Request, res: Response) => {
  res.json({ tarea: await servicio.exigir(idDeRuta(req, 'tarea')) });
});

rutasTareas.post(
  '/',
  requierePermiso('tarea.crear'),
  validarCuerpo(esquemaTarea),
  async (req: Request, res: Response) => {
    const tarea = await servicio.crear(req.body as DatosTarea, req.sesion!.id, (causa) =>
      puedeAccederACausa(req, causa),
    );
    await registrar(req, { entidad: 'tarea', entidadId: tarea.id, accion: 'CREAR', datosDespues: tarea });
    res.status(201).json({ tarea });
  },
);

rutasTareas.put(
  '/:id',
  requierePermiso('tarea.editar'),
  validarCuerpo(esquemaTarea),
  async (req: Request, res: Response) => {
    const { antes, despues } = await servicio.editar(idDeRuta(req, 'tarea'), req.body as DatosTarea, (causa) =>
      puedeAccederACausa(req, causa),
    );
    await registrar(req, {
      entidad: 'tarea',
      entidadId: despues.id,
      accion: 'ACTUALIZAR',
      datosAntes: antes,
      datosDespues: despues,
    });
    res.json({ tarea: despues });
  },
);

rutasTareas.post(
  '/:id/estado',
  requierePermiso('tarea.editar'),
  validarCuerpo(esquemaEstadoTarea),
  async (req: Request, res: Response) => {
    const { estado } = req.body as DatosEstadoTarea;
    const { antes, despues } = await servicio.cambiarEstado(idDeRuta(req, 'tarea'), estado);
    await registrar(req, {
      entidad: 'tarea',
      entidadId: despues.id,
      accion: 'ACTUALIZAR',
      datosAntes: antes,
      datosDespues: despues,
    });
    res.json({ tarea: despues });
  },
);

rutasTareas.delete('/:id', requierePermiso('tarea.eliminar'), async (req: Request, res: Response) => {
  const tarea = await servicio.eliminar(idDeRuta(req, 'tarea'));
  await registrar(req, { entidad: 'tarea', entidadId: tarea.id, accion: 'ELIMINAR', datosAntes: tarea });
  res.json({ tarea });
});
