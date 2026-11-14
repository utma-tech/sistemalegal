import { config } from '../../config';

/**
 * Cliente del microservicio de extracción de texto (`pdf-service/`, Python +
 * FastAPI + pdfplumber).
 *
 * Es un servicio aparte porque pdfplumber es la mejor herramienta para PDF
 * judiciales (respeta columnas y tablas) y no tiene equivalente en Node. El
 * backend le manda los bytes y recibe el texto; si el servicio no responde, el
 * documento queda guardado igual y la extracción se puede reintentar.
 *
 * El token compartido evita que cualquiera use el servicio público de Render
 * como extractor gratuito.
 */

export interface ResultadoExtraccion {
  texto: string;
  paginas: number;
}

/** El servicio gratuito de Render puede tardar cerca de un minuto en despertar. */
const TIMEOUT_MS = 90_000;

export async function extraerTexto(contenido: Buffer): Promise<ResultadoExtraccion> {
  if (!config.urlServicioPdf) throw new Error('El servicio de extracción no está configurado.');

  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIMEOUT_MS);
  try {
    const respuesta = await fetch(`${config.urlServicioPdf}/extraer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        ...(process.env.PDF_SERVICE_TOKEN ? { 'X-Servicio-Token': process.env.PDF_SERVICE_TOKEN } : {}),
      },
      body: new Uint8Array(contenido),
      signal: control.signal,
    });

    const cuerpo = (await respuesta.json().catch(() => undefined)) as
      | { texto?: string; paginas?: number; detail?: string }
      | undefined;

    if (!respuesta.ok) {
      throw new Error(cuerpo?.detail ?? `El servicio de extracción respondió ${respuesta.status}.`);
    }
    return { texto: cuerpo?.texto ?? '', paginas: cuerpo?.paginas ?? 0 };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('El servicio de extracción no respondió a tiempo.');
    }
    throw error;
  } finally {
    clearTimeout(reloj);
  }
}
