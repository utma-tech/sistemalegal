import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config as cargarEnv } from 'dotenv';

/**
 * Carga de variables de entorno.
 *
 * El proyecto tiene un único .env en la raíz del repositorio —es el que
 * documenta .env.example y el que lee docker compose—, pero `npm run dev` y
 * `npm test` se ejecutan desde backend/, donde dotenv no lo encuentra. Por eso
 * se busca primero en el directorio actual y después en la raíz.
 *
 * dotenv no pisa lo que ya está definido, así que una variable del entorno real
 * (Render, el workflow de CI) sigue teniendo prioridad sobre cualquier archivo.
 */
cargarEnv();
cargarEnv({ path: join(__dirname, '..', '..', '.env') });

/**
 * Configuración del servicio, leída una sola vez desde variables de entorno.
 *
 * Nada sensible vive en el repositorio (ver docs/arquitectura.md, sección 6).
 * `urlBaseDatos` puede faltar a propósito: la API tiene que poder arrancar y
 * responder /health incluso con la base mal configurada, para que el problema
 * se vea en el endpoint en lugar de en un contenedor que no levanta.
 */

function entero(nombre: string, porDefecto: number): number {
  const valor = process.env[nombre];
  if (!valor) return porDefecto;
  const numero = Number.parseInt(valor, 10);
  if (Number.isNaN(numero)) {
    throw new Error(`La variable ${nombre} debe ser un número entero, llegó "${valor}"`);
  }
  return numero;
}

function lista(nombre: string): string[] {
  return (process.env[nombre] ?? '')
    .split(',')
    .map((origen) => origen.trim())
    .filter((origen) => origen.length > 0);
}

/**
 * Secreto de firma de los access token.
 *
 * En producción es obligatorio y el servicio no arranca sin él: un secreto por
 * defecto en un binario publicado equivale a no tener firma, porque cualquiera
 * que lea el repositorio puede emitirse un token de administrador.
 *
 * En desarrollo se genera uno efímero. La consecuencia —las sesiones se caen
 * al reiniciar el servidor— es deliberada: molesta lo justo para que nadie se
 * acostumbre a trabajar sin configurar la variable, y nunca deja un secreto
 * conocido en una máquina de desarrollo.
 */
function secretoJwt(): string {
  const declarado = process.env.JWT_SECRET;
  if (declarado && declarado.length >= 32) return declarado;

  const entorno = process.env.NODE_ENV ?? 'development';
  if (entorno === 'production') {
    throw new Error(
      'Falta JWT_SECRET o es demasiado corto (mínimo 32 caracteres). ' +
        'Generá uno con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    );
  }
  if (declarado) {
    console.warn('[config] JWT_SECRET tiene menos de 32 caracteres: se ignora y se usa uno efímero.');
  }
  return randomBytes(48).toString('base64url');
}

export const config = {
  entorno: process.env.NODE_ENV ?? 'development',
  puerto: entero('PORT', 4000),
  urlBaseDatos: process.env.DATABASE_URL,

  /** Secreto de firma de los access token. Ver secretoJwt(). */
  secretoJwt: secretoJwt(),

  /**
   * Vida del access token. Corta a propósito: el token viaja en cada petición y
   * vive en memoria del navegador, así que si se filtra, la ventana de abuso es
   * de minutos. La continuidad de la sesión la da el refresh token.
   */
  minutosAccessToken: entero('MINUTOS_ACCESS_TOKEN', 15),

  /** Vida del refresh token, en días. Define cada cuánto hay que volver a entrar. */
  diasRefreshToken: entero('DIAS_REFRESH_TOKEN', 7),

  /**
   * Intentos de login permitidos por ventana, por IP. Frena la prueba de
   * contraseñas por fuerza bruta sin castigar a quien se equivoca una vez.
   */
  intentosLogin: entero('INTENTOS_LOGIN', 10),
  minutosVentanaLogin: entero('MINUTOS_VENTANA_LOGIN', 15),

  /**
   * Intentos fallidos permitidos por cuenta (correo) en la misma ventana. No
   * depende de la IP, que detrás de proxies se puede falsificar. Ver
   * modulos/auth/rutas.ts.
   */
  intentosLoginPorCuenta: entero('INTENTOS_LOGIN_POR_CUENTA', 10),

  /**
   * SameSite de la cookie del refresh token en producción. `lax` cuando el
   * frontend reenvía /api con el proxy de Vercel (la cookie es de primera
   * parte); `none` solo si la API se consume desde otro sitio.
   */
  cookieSameSite: process.env.COOKIE_SAMESITE === 'none' ? ('none' as const) : ('lax' as const),

  /**
   * Cuántos proxies hay delante de Express. En Render es 1 (su balanceador);
   * con el proxy de Vercel delante son 2. Si el número queda corto, req.ip es
   * la IP de Vercel y el límite de intentos de login castiga a todos juntos.
   */
  saltosProxy: entero('SALTOS_PROXY', 1),

  /** Tamaño máximo de un archivo subido, en megabytes. */
  megasMaximoArchivo: entero('MEGAS_MAXIMO_ARCHIVO', 10),

  /**
   * URL del microservicio de extracción de texto de PDF. Si falta, los PDF se
   * guardan igual y su texto queda pendiente: la extracción es una mejora, no
   * una condición para subir un documento.
   */
  urlServicioPdf: process.env.PDF_SERVICE_URL?.replace(/\/+$/, '') || undefined,

  /** Orígenes autorizados a consumir la API, separados por coma. */
  origenesPermitidos: lista('CORS_ORIGIN'),

  /**
   * Vercel publica cada preview en un dominio distinto
   * (sistemalegal-abc123-equipo.vercel.app), así que la allowlist no puede ser
   * una URL fija. Se autoriza por prefijo del proyecto, no cualquier *.vercel.app.
   */
  prefijoPreviewVercel: process.env.CORS_PREFIJO_PREVIEW ?? 'sistemalegal',

  /**
   * Slug del equipo de Vercel (lo que va al final del subdominio de un preview:
   * sistemalegal-abc123-<slug>.vercel.app). El prefijo solo no alcanza: el
   * nombre del proyecto lo elige cualquiera, así que cualquier cuenta de Vercel
   * puede publicar un `sistemalegal-loquesea.vercel.app`. El slug del equipo,
   * en cambio, solo lo genera Vercel para los despliegues del equipo.
   *
   * Si está definido, un preview tiene que terminar en `-<slug>`. Si falta, se
   * mantiene el criterio anterior (solo prefijo) y en producción se avisa en el log.
   */
  sufijoEquipoVercel: process.env.CORS_SUFIJO_EQUIPO?.trim().toLowerCase() || undefined,

  /** Tope de filas que devuelve el listado, para no traer la base entera. */
  limiteListados: entero('LIMITE_LISTADOS', 50),

  /**
   * Zona horaria operativa del estudio. Decide qué día es "hoy" para el cómputo
   * de alertas y en qué hora de pared se muestran y programan los eventos. No
   * se toma de la zona del servidor: Render corre en UTC y a las 21 h de
   * Argentina ya sería mañana.
   */
  zonaHoraria: zonaHoraria(),

  /** URL pública de la aplicación, para los enlaces de los correos. */
  urlAplicacion: process.env.APP_URL?.trim().replace(/\/+$/, '') || undefined,

  /**
   * Secreto del programador externo que llama a /api/interno/programador. Sin
   * él (o con menos de 32 caracteres) el endpoint responde 503: nunca queda
   * abierto sin protección.
   */
  secretoProgramador: secretoProgramador(),

  correo: configuracionCorreo(),
} as const;

function zonaHoraria(): string {
  const zona = process.env.ZONA_HORARIA?.trim() || 'America/Argentina/Buenos_Aires';
  try {
    new Intl.DateTimeFormat('es-AR', { timeZone: zona });
  } catch {
    throw new Error(`ZONA_HORARIA no es una zona horaria IANA válida: "${zona}"`);
  }
  return zona;
}

function secretoProgramador(): string | undefined {
  const secreto = process.env.CRON_SECRET?.trim();
  if (!secreto) return undefined;
  if (secreto.length < 32) {
    console.warn('[config] CRON_SECRET tiene menos de 32 caracteres: el programador queda deshabilitado.');
    return undefined;
  }
  return secreto;
}

export type ModoCorreo = 'deshabilitado' | 'simulado' | 'real';

/**
 * Correo electrónico.
 *
 * Tres modos (CORREO_MODO):
 *  - deshabilitado (por defecto): no se envía nada; los avisos por correo que
 *    llegan a su hora se cancelan, así que habilitarlo después no dispara una
 *    tanda de correos viejos.
 *  - simulado: el mensaje se arma completo y se registra, pero no sale.
 *  - real: se envía por el proveedor (hoy Resend). Si falta la clave, el
 *    remitente o APP_URL, se comporta como deshabilitado y lo avisa.
 *
 * En pruebas (NODE_ENV=test) el modo real se degrada a simulado: una corrida
 * de tests nunca puede mandar correo a un destinatario real.
 */
function configuracionCorreo() {
  const pedido = (process.env.CORREO_MODO?.trim().toLowerCase() || 'deshabilitado') as string;
  const modos: ModoCorreo[] = ['deshabilitado', 'simulado', 'real'];
  if (!modos.includes(pedido as ModoCorreo)) {
    throw new Error(`CORREO_MODO debe ser deshabilitado, simulado o real; llegó "${pedido}"`);
  }
  const proveedor = process.env.CORREO_PROVEEDOR?.trim().toLowerCase() || 'resend';
  const remitente = process.env.CORREO_REMITENTE?.trim() || undefined;
  const claveResend = process.env.RESEND_API_KEY?.trim() || undefined;
  const urlAplicacion = process.env.APP_URL?.trim() || undefined;

  let modo = pedido as ModoCorreo;
  const faltantes: string[] = [];
  if (modo === 'real') {
    if (proveedor !== 'resend') faltantes.push('CORREO_PROVEEDOR (solo se admite resend)');
    if (!claveResend) faltantes.push('RESEND_API_KEY');
    if (!remitente) faltantes.push('CORREO_REMITENTE');
    if (!urlAplicacion) faltantes.push('APP_URL');
    if ((process.env.NODE_ENV ?? '') === 'test') modo = 'simulado';
    else if (faltantes.length > 0) {
      console.warn(`[config] CORREO_MODO=real sin ${faltantes.join(', ')}: el correo queda deshabilitado.`);
      modo = 'deshabilitado';
    }
  }

  return {
    modoPedido: pedido as ModoCorreo,
    modo,
    proveedor,
    remitente: remitente ?? 'SistemaLegal <avisos@sistemalegal.invalid>',
    claveResend,
    faltantes,
  };
}

const DOMINIO_VERCEL = '.vercel.app';

export function origenAutorizado(origen: string): boolean {
  if (config.origenesPermitidos.includes(origen)) return true;
  if (config.entorno === 'development' && esLocal(origen)) return true;
  return esPreviewDeVercel(origen, config.prefijoPreviewVercel, config.sufijoEquipoVercel);
}

/**
 * En desarrollo, cualquier puerto de esta misma máquina. Vite cambia de puerto
 * si el suyo está ocupado y la gente abre `127.0.0.1` tanto como `localhost`:
 * exigir la coincidencia exacta solo producía logins rotos sin explicación.
 * Nunca aplica en producción.
 */
function esLocal(origen: string): boolean {
  try {
    const url = new URL(origen);
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/**
 * Autoriza los previews del proyecto en Vercel.
 *
 * Se compara el host ya parseado en lugar de armar un regex con el prefijo
 * interpolado: un prefijo con metacaracteres ensancharía la allowlist sin que
 * se note, y un punto mal escapado convierte `.vercel.app` en un comodín que
 * matchea cualquier carácter.
 */
export function esPreviewDeVercel(origen: string, prefijo: string, sufijoEquipo?: string): boolean {
  let url: URL;
  try {
    url = new URL(origen);
  } catch {
    return false;
  }

  // Solo https y sin puerto: un origen es esquema + host + puerto.
  if (url.protocol !== 'https:' || url.port !== '') return false;
  if (!url.hostname.endsWith(DOMINIO_VERCEL)) return false;

  const subdominio = url.hostname.slice(0, -DOMINIO_VERCEL.length);
  // Un solo nivel: descarta cosas como sistemalegal.ajeno.vercel.app.
  if (subdominio.length === 0 || subdominio.includes('.')) return false;

  if (subdominio === prefijo) return true;
  if (!subdominio.startsWith(`${prefijo}-`)) return false;
  if (!sufijoEquipo) return true;

  // prefijo-<algo>-<slug>: el tramo del medio no puede quedar vacío, o
  // "sistemalegal-utma" pasaría como preview sin serlo.
  const resto = subdominio.slice(prefijo.length + 1);
  return resto.length > sufijoEquipo.length + 1 && resto.endsWith(`-${sufijoEquipo}`);
}

if (config.entorno === 'production' && !config.sufijoEquipoVercel) {
  console.warn(
    `[config] CORS_SUFIJO_EQUIPO no está definida: se autoriza cualquier ${config.prefijoPreviewVercel}-*.vercel.app, ` +
      'incluso proyectos de otras cuentas de Vercel. Definila con el slug del equipo.',
  );
}
