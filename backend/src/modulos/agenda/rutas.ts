import { Router, type Request, type Response } from 'express';
import { puede, requierePermiso } from '../../middlewares/autenticacion';
import { consultaValidada, validarConsulta, validarCuerpo } from '../../middlewares/validacion';
import { idDeRuta } from '../../comun/ruta';
import { ErrorAutorizacion } from '../../comun/errores';
import { registrar } from '../auditoria/servicio';
import * as servicio from './servicio';
import {
  esquemaConflictos,
  esquemaEstadoEvento,
  esquemaEvento,
  esquemaFiltrosAgenda,
  type DatosConflictos,
  type DatosEstadoEvento,
  type DatosEvento,
  type FiltrosAgenda,
} from './esquemas';

/**
 * Agenda jurídica, montada en `/api/agenda`.
 *
 *   GET   /                          vista unificada de un rango (eventos, plazos, tareas, inhábiles)
 *   GET   /conflictos                superposiciones de horario (advertencia, no bloqueo)
 *   GET   /recordatorios             anticipaciones por defecto de cada tipo
 *   POST  /eventos                   alta
 *   GET   /eventos/:id               detalle
 *   PUT   /eventos/:id               edición y reprogramación
 *   PATCH /eventos/:id/estado        confirmar, completar, cancelar, reabrir
 *   GET   /eventos/:id/historial     cambios del evento
 *
 * Permisos (qué): agenda.ver / crear / editar / cancelar. Alcance (sobre qué):
 * visibilidad del evento + expedientes asignados, aplicado en el servicio.
 */

export const rutasAgenda = Router();

rutasAgenda.get(
  '/',
  requierePermiso('agenda.ver'),
  validarConsulta(esquemaFiltrosAgenda),
  async (req: Request, res: Response) => {
    res.json(await servicio.listar(consultaValidada<FiltrosAgenda>(req), req.sesion!));
  },
);

rutasAgenda.get(
  '/conflictos',
  requierePermiso('agenda.ver'),
  validarConsulta(esquemaConflictos),
  async (req: Request, res: Response) => {
    res.json(await servicio.conflictos(consultaValidada<DatosConflictos>(req), req.sesion!));
  },
);

rutasAgenda.get('/recordatorios', requierePermiso('agenda.ver'), async (_req: Request, res: Response) => {
  res.json({ porTipo: await servicio.reglasPorTipo() });
});

rutasAgenda.post(
  '/eventos',
  requierePermiso('agenda.crear'),
  validarCuerpo(esquemaEvento),
  async (req: Request, res: Response) => {
    const datos = req.body as DatosEvento;
    const id = await servicio.crear(datos, req.sesion!);
    const evento = await servicio.detalle(id, req.sesion!);
    await registrar(req, { entidad: 'evento', entidadId: id, accion: 'CREAR', datosDespues: evento });
    const advertencias = await servicio.conflictos(
      { ...datos, fecha_fin: datos.fecha_fin, responsable: datos.responsable_id, excluir: id, todo_el_dia: datos.todo_el_dia },
      req.sesion!,
    );
    res.status(201).json({ evento, ...advertencias });
  },
);

rutasAgenda.get('/eventos/:id', requierePermiso('agenda.ver'), async (req: Request, res: Response) => {
  res.json({ evento: await servicio.detalle(idDeRuta(req, 'evento'), req.sesion!) });
});

rutasAgenda.put(
  '/eventos/:id',
  requierePermiso('agenda.editar'),
  validarCuerpo(esquemaEvento),
  async (req: Request, res: Response) => {
    const datos = req.body as DatosEvento;
    const { antes, id } = await servicio.editar(idDeRuta(req, 'evento'), datos, req.sesion!);
    const evento = await servicio.detalle(id, req.sesion!);
    await registrar(req, { entidad: 'evento', entidadId: id, accion: 'ACTUALIZAR', datosAntes: antes, datosDespues: evento });
    const advertencias = await servicio.conflictos(
      { ...datos, responsable: datos.responsable_id, excluir: id, todo_el_dia: datos.todo_el_dia },
      req.sesion!,
    );
    res.json({ evento, ...advertencias });
  },
);

rutasAgenda.patch(
  '/eventos/:id/estado',
  requierePermiso('agenda.editar'),
  validarCuerpo(esquemaEstadoEvento),
  async (req: Request, res: Response) => {
    const datos = req.body as DatosEstadoEvento;
    if (datos.estado === 'CANCELADO' && !puede(req, 'agenda.cancelar')) {
      throw new ErrorAutorizacion('No tenés permiso para cancelar eventos.');
    }
    const id = idDeRuta(req, 'evento');
    const evento = await servicio.cambiarEstado(id, datos, req.sesion!);
    await registrar(req, {
      entidad: 'evento',
      entidadId: id,
      accion: 'ACTUALIZAR',
      datosDespues: { estado: evento.estado, motivo: datos.motivo ?? null },
    });
    res.json({ evento });
  },
);

rutasAgenda.get('/eventos/:id/historial', requierePermiso('agenda.ver'), async (req: Request, res: Response) => {
  res.json({ datos: await servicio.historial(idDeRuta(req, 'evento'), req.sesion!) });
});
