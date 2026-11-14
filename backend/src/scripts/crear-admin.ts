import { cerrarPool, obtenerPool } from '../db';
import { crear, esquemaAltaUsuario } from '../modulos/usuarios/servicio';

/**
 * Crea el primer Administrador de una instalación real.
 *
 * Una base de producción se carga sin los datos de demostración (sin
 * `002_datos_demo.sql`), así que no existe ningún usuario y la pantalla de
 * usuarios no es alcanzable. Este script resuelve ese huevo y la gallina:
 *
 *   ADMIN_EMAIL=... ADMIN_NOMBRE=... ADMIN_APELLIDO=... ADMIN_PASSWORD=... npm run crear-admin
 *
 * En Render se corre desde la Shell del servicio con `node dist/scripts/crear-admin.js`.
 * La contraseña va por variable de entorno y no por argumento, para que no
 * quede en el historial de la terminal ni en la lista de procesos.
 *
 * Se niega a correr si ya hay un administrador activo: a partir de ahí, los
 * usuarios se crean desde la aplicación y quedan en la auditoría.
 */
async function principal(): Promise<void> {
  const { rows } = await obtenerPool().query<{ total: number }>(
    `SELECT count(*)::int AS total FROM usuario u JOIN rol r ON r.id = u.rol_id
      WHERE r.codigo = 'ADMIN' AND u.activo`,
  );
  if ((rows[0]?.total ?? 0) > 0) {
    console.error('Ya hay un Administrador activo. Creá los demás usuarios desde la aplicación.');
    process.exitCode = 1;
    return;
  }

  const datos = esquemaAltaUsuario.safeParse({
    email: process.env.ADMIN_EMAIL,
    nombre: process.env.ADMIN_NOMBRE,
    apellido: process.env.ADMIN_APELLIDO,
    password: process.env.ADMIN_PASSWORD,
    rol: 'ADMIN',
  });
  if (!datos.success) {
    console.error('Faltan datos o no son válidos (ADMIN_EMAIL, ADMIN_NOMBRE, ADMIN_APELLIDO, ADMIN_PASSWORD):');
    for (const problema of datos.error.issues) console.error(`  - ${problema.path.join('.')}: ${problema.message}`);
    process.exitCode = 1;
    return;
  }

  const usuario = await crear(datos.data);
  console.log(`Administrador creado: ${usuario.email}. Ya puede entrar a la aplicación.`);
}

principal()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => void cerrarPool());
