import { compare, hash } from 'bcryptjs';
import { z } from 'zod';
import { enTransaccion, obtenerPool } from '../../db';
import { ErrorConflicto, ErrorNoEncontrado, ErrorSolicitud } from '../../comun/errores';
import { textoOpcional } from '../../comun/ruta';

/**
 * Integrantes del estudio: alta, edición, baja y contraseñas.
 *
 * Reglas que protegen al estudio de quedarse afuera de su propio sistema:
 *  - siempre tiene que quedar al menos un Administrador activo;
 *  - nadie puede darse de baja ni quitarse el rol de Administrador a sí mismo
 *    (lo tiene que hacer otro administrador, que es quien ve el efecto);
 *  - dar de baja a alguien o cambiarle la contraseña cierra todas sus sesiones.
 */

/** Costo de bcrypt. 12 tarda ~250 ms: imperceptible al entrar, caro para un ataque. */
const COSTO_BCRYPT = 12;

export const esquemaPassword = z
  .string()
  .min(8, 'La contraseña tiene que tener al menos 8 caracteres.')
  .max(72, 'Máximo 72 caracteres.')
  .refine((v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v), 'Usá al menos una letra y un número.');

const ROLES = ['ADMIN', 'JEFE_ESTUDIO', 'EMPLEADO'] as const;

const datosPersonales = {
  nombre: z.string().trim().min(1, 'Indicá el nombre.').max(80, 'Máximo 80 caracteres.'),
  apellido: z.string().trim().min(1, 'Indicá el apellido.').max(80, 'Máximo 80 caracteres.'),
  matricula: textoOpcional(50),
  telefono: textoOpcional(30),
  rol: z.enum(ROLES, 'Elegí un rol.'),
};

export const esquemaAltaUsuario = z.object({
  ...datosPersonales,
  email: z
    .string()
    .trim()
    .min(1, 'Indicá el correo.')
    .max(150, 'Máximo 150 caracteres.')
    .pipe(z.email('Ese correo no parece válido.'))
    .transform((v) => v.toLowerCase()),
  password: esquemaPassword,
});

export const esquemaEdicionUsuario = z.object({
  ...datosPersonales,
  activo: z.boolean(),
});

export const esquemaNuevaPassword = z.object({ password: esquemaPassword });

export const esquemaCambioPropio = z.object({
  actual: z.string().min(1, 'Escribí tu contraseña actual.'),
  nueva: esquemaPassword,
});

export type DatosAltaUsuario = z.infer<typeof esquemaAltaUsuario>;
export type DatosEdicionUsuario = z.infer<typeof esquemaEdicionUsuario>;

export interface UsuarioListado {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  matricula: string | null;
  telefono: string | null;
  rol: string;
  rol_nombre: string;
  activo: boolean;
  ultimo_acceso_en: string | null;
  creado_en: string;
}

const COLUMNAS = `u.id, u.email, u.nombre, u.apellido, u.matricula, u.telefono,
                  r.codigo AS rol, r.nombre AS rol_nombre, u.activo,
                  u.ultimo_acceso_en, u.creado_en`;

export async function listar(): Promise<UsuarioListado[]> {
  const { rows } = await obtenerPool().query<UsuarioListado>(
    `SELECT ${COLUMNAS} FROM usuario u JOIN rol r ON r.id = u.rol_id
      ORDER BY u.activo DESC, r.jerarquia, u.apellido, u.nombre`,
  );
  return rows;
}

export async function roles(): Promise<{ codigo: string; nombre: string; descripcion: string | null }[]> {
  const { rows } = await obtenerPool().query(
    'SELECT codigo, nombre, descripcion FROM rol ORDER BY jerarquia',
  );
  return rows;
}

export async function exigir(id: string): Promise<UsuarioListado> {
  const { rows } = await obtenerPool().query<UsuarioListado>(
    `SELECT ${COLUMNAS} FROM usuario u JOIN rol r ON r.id = u.rol_id WHERE u.id = $1`,
    [id],
  );
  if (!rows[0]) throw new ErrorNoEncontrado('No encontramos a ese integrante.');
  return rows[0];
}

async function emailEnUso(email: string, exceptoId?: string): Promise<boolean> {
  const { rows } = await obtenerPool().query(
    'SELECT 1 FROM usuario WHERE lower(email) = lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid)',
    [email, exceptoId ?? null],
  );
  return rows.length > 0;
}

export async function crear(datos: DatosAltaUsuario): Promise<UsuarioListado> {
  if (await emailEnUso(datos.email)) {
    throw new ErrorConflicto('Ya hay un integrante con ese correo.', {
      email: ['Ya hay un integrante con ese correo.'],
    });
  }

  const passwordHash = await hash(datos.password, COSTO_BCRYPT);
  const { rows } = await obtenerPool().query<{ id: string }>(
    `INSERT INTO usuario (rol_id, email, password_hash, nombre, apellido, matricula, telefono)
     SELECT r.id, $2, $3, $4, $5, $6, $7 FROM rol r WHERE r.codigo = $1
     RETURNING id`,
    [
      datos.rol,
      datos.email,
      passwordHash,
      datos.nombre,
      datos.apellido,
      datos.matricula ?? null,
      datos.telefono ?? null,
    ],
  );
  return exigir(rows[0]!.id);
}

async function administradoresActivos(exceptoId: string): Promise<number> {
  const { rows } = await obtenerPool().query<{ total: number }>(
    `SELECT count(*)::int AS total FROM usuario u JOIN rol r ON r.id = u.rol_id
      WHERE r.codigo = 'ADMIN' AND u.activo AND u.id <> $1`,
    [exceptoId],
  );
  return rows[0]?.total ?? 0;
}

export async function editar(
  id: string,
  datos: DatosEdicionUsuario,
  quienEdita: string,
): Promise<{ antes: UsuarioListado; despues: UsuarioListado }> {
  const antes = await exigir(id);
  const pierdeAdmin = antes.rol === 'ADMIN' && antes.activo && (datos.rol !== 'ADMIN' || !datos.activo);

  if (id === quienEdita && !datos.activo) {
    throw new ErrorConflicto('No podés darte de baja a vos mismo. Pedíselo a otro administrador.');
  }
  if (id === quienEdita && antes.rol === 'ADMIN' && datos.rol !== 'ADMIN') {
    throw new ErrorConflicto('No podés quitarte el rol de Administrador a vos mismo.');
  }
  if (pierdeAdmin && (await administradoresActivos(id)) === 0) {
    throw new ErrorConflicto('El estudio tiene que conservar al menos un Administrador activo.');
  }

  await enTransaccion(async (cliente) => {
    await cliente.query(
      `UPDATE usuario
          SET rol_id = (SELECT id FROM rol WHERE codigo = $2),
              nombre = $3, apellido = $4, matricula = $5, telefono = $6, activo = $7
        WHERE id = $1`,
      [id, datos.rol, datos.nombre, datos.apellido, datos.matricula ?? null, datos.telefono ?? null, datos.activo],
    );
    // Dado de baja: sus sesiones se cortan ya, no cuando venza el refresh token.
    if (!datos.activo) {
      await cliente.query(
        'UPDATE refresh_token SET revocado_en = now() WHERE usuario_id = $1 AND revocado_en IS NULL',
        [id],
      );
    }
  });

  return { antes, despues: await exigir(id) };
}

async function guardarPassword(id: string, password: string): Promise<void> {
  const passwordHash = await hash(password, COSTO_BCRYPT);
  await enTransaccion(async (cliente) => {
    await cliente.query('UPDATE usuario SET password_hash = $2 WHERE id = $1', [id, passwordHash]);
    // Quien tenía la contraseña vieja y una sesión abierta queda afuera.
    await cliente.query(
      'UPDATE refresh_token SET revocado_en = now() WHERE usuario_id = $1 AND revocado_en IS NULL',
      [id],
    );
  });
}

/** Un administrador le asigna una contraseña nueva a otro integrante. */
export async function restablecerPassword(id: string, password: string): Promise<UsuarioListado> {
  const usuario = await exigir(id);
  await guardarPassword(id, password);
  return usuario;
}

/** Cada uno cambia la propia, confirmando la actual. */
export async function cambiarPasswordPropia(id: string, actual: string, nueva: string): Promise<void> {
  const { rows } = await obtenerPool().query<{ password_hash: string }>(
    'SELECT password_hash FROM usuario WHERE id = $1 AND activo',
    [id],
  );
  const fila = rows[0];
  if (!fila || !(await compare(actual, fila.password_hash))) {
    throw new ErrorSolicitud('Revisá los datos del formulario.', {
      actual: ['La contraseña actual no es correcta.'],
    });
  }
  if (actual === nueva) {
    throw new ErrorSolicitud('Revisá los datos del formulario.', {
      nueva: ['La nueva contraseña tiene que ser distinta de la actual.'],
    });
  }
  await guardarPassword(id, nueva);
}
