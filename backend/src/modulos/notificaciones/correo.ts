import { randomUUID } from 'node:crypto';
import { config } from '../../config';

/**
 * Envío de correo, desacoplado del proveedor.
 *
 * La lógica de negocio (cola, recordatorios) solo conoce `ProveedorCorreo`:
 * cambiar Resend por otro servicio es escribir otra implementación de esta
 * interfaz, sin tocar nada más. No se usa el SDK de Resend: su API es un único
 * POST y `fetch` alcanza, sin sumar una dependencia.
 */

export interface MensajeCorreo {
  para: string;
  asunto: string;
  html: string;
  texto: string;
  /**
   * Viaja al proveedor como Idempotency-Key: si el proceso se cae después de
   * que el proveedor aceptó el mensaje y antes de registrarlo, el reintento no
   * lo manda de nuevo.
   */
  claveIdempotencia: string;
}

export interface ResultadoEnvio {
  idExterno: string;
}

/**
 * Error del proveedor. `transitorio` decide si se reintenta: una caída o un
 * límite de envío se reintentan; un remitente no verificado o una dirección
 * rechazada no van a andar en el próximo intento.
 *
 * El mensaje está saneado: nunca lleva la clave, el destinatario ni el cuerpo.
 */
export class ErrorProveedorCorreo extends Error {
  constructor(
    mensaje: string,
    readonly transitorio: boolean,
  ) {
    super(mensaje);
    this.name = 'ErrorProveedorCorreo';
  }
}

export interface ProveedorCorreo {
  nombre: string;
  enviar(mensaje: MensajeCorreo): Promise<ResultadoEnvio>;
}

/* --- Simulado ----------------------------------------------------------------- */

export interface CorreoSimulado extends MensajeCorreo {
  idExterno: string;
  enviadoEn: Date;
}

const simulados: CorreoSimulado[] = [];

/**
 * Arma el mensaje completo y lo guarda en memoria en lugar de mandarlo. Es el
 * modo de desarrollo y el de las pruebas. Respeta la idempotencia igual que el
 * proveedor real, para que las pruebas de reintento midan lo mismo.
 */
export function crearProveedorSimulado(): ProveedorCorreo {
  return {
    nombre: 'simulado',
    async enviar(mensaje) {
      const previo = simulados.find((c) => c.claveIdempotencia === mensaje.claveIdempotencia);
      if (previo) return { idExterno: previo.idExterno };
      const idExterno = `simulado-${randomUUID()}`;
      simulados.push({ ...mensaje, idExterno, enviadoEn: new Date() });
      if (config.entorno !== 'test') {
        console.info(`[correo] simulado: "${mensaje.asunto}" para ${ocultarDireccion(mensaje.para)}`);
      }
      return { idExterno };
    },
  };
}

export function correosSimulados(): readonly CorreoSimulado[] {
  return simulados;
}

export function vaciarCorreosSimulados(): void {
  simulados.length = 0;
}

/* --- Resend --------------------------------------------------------------------- */

const URL_RESEND = 'https://api.resend.com/emails';

export function crearProveedorResend(clave: string, remitente: string): ProveedorCorreo {
  return {
    nombre: 'resend',
    async enviar(mensaje) {
      let respuesta: Response;
      try {
        respuesta = await fetch(URL_RESEND, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${clave}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': mensaje.claveIdempotencia.slice(0, 256),
          },
          body: JSON.stringify({
            from: remitente,
            to: [mensaje.para],
            subject: mensaje.asunto,
            html: mensaje.html,
            text: mensaje.texto,
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        const causa = error instanceof Error && error.name === 'TimeoutError' ? 'tiempo agotado' : 'sin conexión';
        throw new ErrorProveedorCorreo(`No se pudo contactar al proveedor (${causa}).`, true);
      }

      if (respuesta.ok) {
        const cuerpo = (await respuesta.json().catch(() => ({}))) as { id?: unknown };
        return { idExterno: typeof cuerpo.id === 'string' ? cuerpo.id : `resend-sin-id-${randomUUID()}` };
      }

      // Del cuerpo de error solo se conserva el nombre del error (p. ej.
      // validation_error): el mensaje puede repetir la dirección del destinatario.
      const cuerpo = (await respuesta.json().catch(() => ({}))) as { name?: unknown };
      const nombre = typeof cuerpo.name === 'string' ? cuerpo.name.slice(0, 60) : 'sin detalle';
      const transitorio = respuesta.status === 429 || respuesta.status >= 500;
      throw new ErrorProveedorCorreo(`El proveedor respondió ${respuesta.status} (${nombre}).`, transitorio);
    },
  };
}

/* --- Selección ------------------------------------------------------------------ */

let proveedorDePrueba: ProveedorCorreo | null | undefined;
let simuladoUnico: ProveedorCorreo | undefined;

/**
 * Reemplaza el proveedor en las pruebas (uno que falla, uno lento…). `null`
 * simula el correo deshabilitado; `undefined` vuelve a la configuración.
 */
export function usarProveedorDePrueba(proveedor: ProveedorCorreo | null | undefined): void {
  proveedorDePrueba = proveedor;
}

/** El proveedor según CORREO_MODO, o `null` si el correo está deshabilitado. */
export function proveedorActual(): ProveedorCorreo | null {
  if (proveedorDePrueba !== undefined) return proveedorDePrueba;
  switch (config.correo.modo) {
    case 'simulado':
      return (simuladoUnico ??= crearProveedorSimulado());
    case 'real':
      return crearProveedorResend(config.correo.claveResend!, config.correo.remitente);
    default:
      return null;
  }
}

/** Para logs y pantallas: a***@dominio.com. */
export function ocultarDireccion(direccion: string): string {
  const [usuario, dominio] = direccion.split('@');
  if (!usuario || !dominio) return '***';
  return `${usuario[0]}***@${dominio}`;
}
