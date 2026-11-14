/**
 * Reconocimiento del tipo de archivo por su contenido ("magic bytes").
 *
 * El Content-Type y la extensión los decide quien sube el archivo; los
 * primeros bytes, no. Un ejecutable renombrado a .pdf no empieza con %PDF-.
 */

export interface TipoArchivo {
  mime: string;
  extension: string;
}

function empiezaCon(contenido: Buffer, firma: number[]): boolean {
  return firma.every((byte, i) => contenido[i] === byte);
}

/** Texto plano: UTF-8 válido y sin bytes nulos en el primer bloque. */
function pareceTexto(contenido: Buffer): boolean {
  const muestra = contenido.subarray(0, 8192);
  if (muestra.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(muestra.subarray(0, muestra.length - 4));
    return true;
  } catch {
    return false;
  }
}

export function detectarTipo(contenido: Buffer, nombre: string): TipoArchivo | undefined {
  if (empiezaCon(contenido, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: 'application/pdf', extension: 'pdf' };
  if (empiezaCon(contenido, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', extension: 'png' };
  if (empiezaCon(contenido, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', extension: 'jpg' };

  // .docx es un ZIP. Se exige además la extensión: un ZIP cualquiera no es un escrito.
  if (empiezaCon(contenido, [0x50, 0x4b, 0x03, 0x04]) && /\.docx$/i.test(nombre)) {
    return {
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'docx',
    };
  }

  if (/\.(txt|md|csv)$/i.test(nombre) && pareceTexto(contenido)) {
    return { mime: 'text/plain; charset=utf-8', extension: 'txt' };
  }

  return undefined;
}
