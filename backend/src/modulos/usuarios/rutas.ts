import { Router, type Request, type Response } from 'express';
import { requierePermiso } from '../../middlewares/autenticacion';
import { validarCuerpo } from '../../middlewares/validacion';
import { idDeRuta } from '../../comun/ruta';
import { registrar } from '../auditoria/servicio';
import * as servicio from './servicio';
import {
  esquemaAltaUsuario,
  esquemaCambioPropio,
  esquemaEdicionUsuario,
  esquemaNuevaPassword,
  type DatosAltaUsuario,
  type DatosEdicionUsuario,
} from './servicio';

/**
 * Administración de integrantes (`/api/usuarios`, permisos `usuario.*`, que
 * por defecto solo tiene el rol Administrador) y la cuenta propia
 * (`/api/cuenta`, cualquier usuario con sesión).
 *
 * Un cambio de rol se aplica en el próximo access token (hasta 15 minutos):
 * los permisos viajan en el token para no consultar la base en cada petición.
 * Una baja, en cambio, corta las sesiones en el acto.
 */

export const rutasUsuarios = Router();

rutasUsuarios.get('/', requierePermiso('usuario.ver'), async (_req: Request, res: Response) => {
  res.json({ datos: await servicio.listar() });
});

rutasUsuarios.get('/roles', requierePermiso('usuario.ver'), async (_req: Request, res: Response) => {
  res.json({ datos: await servicio.roles() });
});

rutasUsuarios.post(
  '/',
  requierePermiso('usuario.crear'),
  validarCuerpo(esquemaAltaUsuario),
  async (req: Request, res: Response) => {
    const usuario = await servicio.crear(req.body as DatosAltaUsuario);
    await registrar(req, { entidad: 'usuario', entidadId: usuario.id, accion: 'CREAR', datosDespues: usuario });
    res.status(201).json({ usuario });
  },
);

rutasUsuarios.put(
  '/:id',
  requierePermiso('usuario.editar'),
  validarCuerpo(esquemaEdicionUsuario),
  async (req: Request, res: Response) => {
    const { antes, despues } = await servicio.editar(
      idDeRuta(req, 'integrante'),
      req.body as DatosEdicionUsuario,
      req.sesion!.id,
    );
    await registrar(req, {
      entidad: 'usuario',
      entidadId: despues.id,
      accion: 'ACTUALIZAR',
      datosAntes: antes,
      datosDespues: despues,
    });
    res.json({ usuario: despues });
  },
);

rutasUsuarios.post(
  '/:id/password',
  requierePermiso('usuario.editar'),
  validarCuerpo(esquemaNuevaPassword),
  async (req: Request, res: Response) => {
    const { password } = req.body as { password: string };
    const usuario = await servicio.restablecerPassword(idDeRuta(req, 'integrante'), password);
    // Se audita el hecho, nunca el valor.
    await registrar(req, {
      entidad: 'usuario',
      entidadId: usuario.id,
      accion: 'ACTUALIZAR',
      datosDespues: { contraseña: 'restablecida por un administrador' },
    });
    res.json({ usuario });
  },
);

export const rutasCuenta = Router();

rutasCuenta.post('/password', validarCuerpo(esquemaCambioPropio), async (req: Request, res: Response) => {
  const { actual, nueva } = req.body as { actual: string; nueva: string };
  await servicio.cambiarPasswordPropia(req.sesion!.id, actual, nueva);
  await registrar(req, {
    entidad: 'usuario',
    entidadId: req.sesion!.id,
    accion: 'ACTUALIZAR',
    datosDespues: { contraseña: 'cambiada por su titular' },
  });
  res.json({ ok: true });
});
