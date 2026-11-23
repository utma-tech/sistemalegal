import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../../config';
import { requiereSesion } from '../../middlewares/autenticacion';
import { validarCuerpo } from '../../middlewares/validacion';
import { esquemaLogin } from './esquemas';
import { getPerfil, postLogin, postLogout, postRefrescar } from './controlador';

export const rutasAuth = Router();

/**
 * Límite de intentos de login por IP.
 *
 * Sin esto, el formulario de login es un oráculo para probar contraseñas a
 * velocidad de red. El límite cuenta solo los intentos fallidos, así que quien
 * entra bien no consume cupo.
 */
const limiteLogin = rateLimit({
  windowMs: config.minutosVentanaLogin * 60_000,
  limit: config.intentosLogin,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Demasiados intentos de inicio de sesión. Esperá unos minutos y volvé a probar.',
    codigo: 'DEMASIADOS_INTENTOS',
  },
});

/**
 * Límite de intentos fallidos por cuenta.
 *
 * El límite por IP solo sirve si la IP es confiable, y no siempre lo es: quien
 * llama a Render directo (sin pasar por Vercel) controla una de las entradas de
 * X-Forwarded-For que Express toma como propia, y con eso rota de "IP" en cada
 * intento. El correo, en cambio, no se falsifica con cabeceras: probar
 * contraseñas contra una cuenta queda acotado igual.
 *
 * Va después de validarCuerpo para usar el correo ya normalizado (sin espacios,
 * en minúsculas): si no, "Admin@x" y "admin@x" contarían por separado. Aplica
 * igual exista o no la cuenta, así que el 429 no revela qué correos tienen
 * usuario.
 */
const limiteCuenta = rateLimit({
  windowMs: config.minutosVentanaLogin * 60_000,
  limit: config.intentosLoginPorCuenta,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `cuenta:${(req.body as { email: string }).email}`,
  message: {
    error: 'Demasiados intentos fallidos para esta cuenta. Esperá unos minutos y volvé a probar.',
    codigo: 'DEMASIADOS_INTENTOS',
  },
});

rutasAuth.post('/login', limiteLogin, validarCuerpo(esquemaLogin), limiteCuenta, postLogin);
rutasAuth.post('/refrescar', postRefrescar);
rutasAuth.post('/logout', postLogout);
rutasAuth.get('/perfil', requiereSesion, getPerfil);
