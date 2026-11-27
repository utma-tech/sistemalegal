import express, { type Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config, origenAutorizado } from './config';
import { verificarBase } from './db';
import { requiereSesion } from './middlewares/autenticacion';
import { alcanceCausaDeRuta } from './comun/alcance';
import { rutasAuth } from './modulos/auth/rutas';
import { rutasCausas } from './modulos/causas/rutas';
import { rutasPlazos, rutasPlazosDeCausa } from './modulos/plazos/rutas';
import { rutasCatalogos } from './modulos/catalogos/rutas';
import { rutasPanel } from './modulos/panel/rutas';
import { rutasPersonas } from './modulos/personas/rutas';
import { rutasTareas } from './modulos/tareas/rutas';
import { rutasCalendario } from './modulos/calendario/rutas';
import { rutasAlertas, rutasNotificaciones } from './modulos/alertas/rutas';
import { rutasCuenta, rutasUsuarios } from './modulos/usuarios/rutas';
import { rutasCostas, rutasCostasDeCausa } from './modulos/costas/rutas';
import { rutasDocumentos, rutasDocumentosDeCausa } from './modulos/documentos/rutas';
import { rutasAuditoria } from './modulos/auditoria/rutas';
import { rutasAgenda } from './modulos/agenda/rutas';
import {
  rutasAdministracionNotificaciones,
  rutasPreferencias,
  rutasProgramador,
} from './modulos/notificaciones/rutas';
import { manejadorErrores, noEncontrado } from './middlewares/manejador-errores';
import { ErrorAutorizacion } from './comun/errores';

/**
 * Construcción de la app Express, separada del arranque del servidor para
 * poder probarla sin ocupar un puerto.
 */

export function crearApp(): Express {
  const app = express();

  // Render y Vercel ponen un proxy delante: sin esto, req.ip sería siempre la
  // del proxy y el límite de intentos de login se aplicaría a todo el mundo
  // junto. Se confía en los saltos declarados (1 en Render, 2 con el proxy de
  // Vercel delante), no en toda la cadena de X-Forwarded-For.
  app.set('trust proxy', config.saltosProxy);

  app.use(
    cors({
      origin(origen, callback) {
        // Sin cabecera Origin: curl, health checks de Render, pruebas. Se permite.
        if (!origen) return callback(null, true);
        if (origenAutorizado(origen)) return callback(null, true);
        // 403 con un mensaje que se entiende en la pantalla de acceso: antes
        // era un 500 genérico y no había forma de saber que el problema era
        // la dirección desde la que se abrió la aplicación.
        return callback(
          new ErrorAutorizacion(
            `La API no acepta pedidos desde ${origen}. Abrí la aplicación desde la dirección configurada o agregala a CORS_ORIGIN.`,
          ),
        );
      },
      // El refresh token viaja en cookie: sin esto el navegador no la manda.
      credentials: true,
    }),
  );
  // Tope de tamaño: sin límite explícito, un cuerpo enorme es una forma barata
  // de tumbar el servicio. Los archivos no viajan por acá, van por subida directa.
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  /**
   * Health check de Render.
   *
   * Devuelve 200 incluso si la base no responde, y el estado real va en el
   * cuerpo. Si devolviera 500, Render reiniciaría el servicio cada vez que la
   * base se pausa en la capa gratuita, que es justo lo que no queremos.
   */
  app.get('/health', async (_req, res) => {
    const base = await verificarBase().catch((error: unknown) => ({
      conectada: false as const,
      error: error instanceof Error ? error.message : String(error),
    }));

    res.json({
      estado: 'ok',
      entorno: config.entorno,
      base: base.conectada ? 'conectada' : 'sin-conexion',
      // El mensaje de pg puede nombrar el host del pooler, el usuario o el
      // problema de TLS, y este endpoint no pide sesión: en producción el
      // detalle va solo al log, igual que en el manejador de errores.
      detalleBase: base.conectada || config.entorno === 'production' ? undefined : base.error,
      momento: new Date().toISOString(),
    });
  });

  app.use('/api/auth', rutasAuth);

  // Programador externo de avisos: no tiene sesión de usuario, lo protege su
  // propio secreto (CRON_SECRET). Ver modulos/notificaciones/rutas.ts.
  app.use('/api/interno', rutasProgramador);

  // Todo lo que sigue exige sesión. Se aplica acá y no ruta por ruta para que
  // agregar un módulo nuevo no pueda olvidarse de protegerlo.
  app.use('/api', requiereSesion);
  app.use('/api/panel', rutasPanel);
  // Alcance por expediente (comun/alcance.ts): todo lo que cuelga de
  // /api/causas/:id —el detalle y sus partes, plazos, costas, documentos—
  // pasa por acá antes de llegar a su ruta.
  app.use('/api/causas/:id', alcanceCausaDeRuta);
  app.use('/api/causas', rutasCausas);
  // Los plazos de un expediente cuelgan de el, pero viven en su propio modulo:
  // el motor de computo no tiene por que estar dentro de causas.
  app.use('/api/causas/:id', rutasPlazosDeCausa);
  app.use('/api/causas/:id', rutasCostasDeCausa);
  app.use('/api/causas/:id', rutasDocumentosDeCausa);
  app.use('/api/plazos', rutasPlazos);
  app.use('/api/personas', rutasPersonas);
  app.use('/api/catalogos', rutasCatalogos);
  app.use('/api/tareas', rutasTareas);
  app.use('/api/calendario', rutasCalendario);
  app.use('/api/agenda', rutasAgenda);
  app.use('/api/alertas', rutasAlertas);
  app.use('/api/notificaciones/administracion', rutasAdministracionNotificaciones);
  app.use('/api/notificaciones', rutasNotificaciones);
  app.use('/api/usuarios', rutasUsuarios);
  app.use('/api/cuenta/notificaciones', rutasPreferencias);
  app.use('/api/cuenta', rutasCuenta);
  app.use('/api/costas', rutasCostas);
  app.use('/api/documentos', rutasDocumentos);
  app.use('/api/auditoria', rutasAuditoria);

  app.use(noEncontrado);
  app.use(manejadorErrores);

  return app;
}
