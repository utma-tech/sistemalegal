import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * Almacenamiento de archivos.
 *
 * La base guarda metadatos, nunca el binario (`documento.ruta_almacenamiento`
 * es la clave del objeto). Dos destinos:
 *
 *  - **Supabase Storage**, si están SUPABASE_URL y SUPABASE_SERVICE_KEY. Es el
 *    de producción: el disco de Render gratis se borra en cada despliegue.
 *  - **Disco local** (`ALMACENAMIENTO_DIR`, por defecto `backend/almacenamiento`)
 *    para desarrollo y para la demo sin conexión.
 *
 * La clave del servicio de Supabase da acceso total al bucket: vive solo en el
 * backend y el navegador nunca habla con Storage directamente. Las descargas
 * pasan por la API, que verifica el permiso `documento.ver` antes de servir.
 */

export interface Almacenamiento {
  nombre: string;
  guardar(clave: string, contenido: Buffer, tipo: string): Promise<void>;
  leer(clave: string): Promise<Buffer>;
  borrar(clave: string): Promise<void>;
}

function supabase(url: string, claveServicio: string, bucket: string): Almacenamiento {
  const base = `${url.replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(bucket)}`;
  // La clave clásica `service_role` es un JWT y va también como Bearer; las
  // claves nuevas (`sb_secret_…`) no son JWT y solo se aceptan en `apikey`.
  const esJwt = claveServicio.startsWith('eyJ');
  const cabeceras: Record<string, string> = esJwt
    ? { Authorization: `Bearer ${claveServicio}`, apikey: claveServicio }
    : { apikey: claveServicio };
  const ruta = (clave: string) => `${base}/${clave.split('/').map(encodeURIComponent).join('/')}`;

  async function exigirOk(respuesta: Response, accion: string): Promise<void> {
    if (respuesta.ok) return;
    const detalle = await respuesta.text().catch(() => '');
    // El detalle va al log, no al usuario: puede nombrar el bucket o el proyecto.
    throw new Error(`[almacenamiento] Supabase rechazó ${accion} (${respuesta.status}): ${detalle.slice(0, 300)}`);
  }

  return {
    nombre: 'supabase',
    async guardar(clave, contenido, tipo) {
      const respuesta = await fetch(ruta(clave), {
        method: 'POST',
        headers: { ...cabeceras, 'Content-Type': tipo, 'x-upsert': 'false' },
        body: new Uint8Array(contenido),
      });
      await exigirOk(respuesta, 'la subida');
    },
    async leer(clave) {
      const respuesta = await fetch(ruta(clave), { headers: cabeceras });
      await exigirOk(respuesta, 'la descarga');
      return Buffer.from(await respuesta.arrayBuffer());
    },
    async borrar(clave) {
      const respuesta = await fetch(ruta(clave), { method: 'DELETE', headers: cabeceras });
      if (respuesta.status !== 404) await exigirOk(respuesta, 'el borrado');
    },
  };
}

function disco(directorio: string): Almacenamiento {
  const raiz = resolve(directorio);
  /** La clave la arma el backend, pero igual se impide salir del directorio. */
  const ruta = (clave: string) => {
    const destino = resolve(join(raiz, clave));
    if (!destino.startsWith(raiz + sep)) throw new Error('[almacenamiento] clave fuera del directorio');
    return destino;
  };

  return {
    nombre: 'disco',
    async guardar(clave, contenido) {
      const destino = ruta(clave);
      await mkdir(dirname(destino), { recursive: true });
      await writeFile(destino, contenido, { flag: 'wx' });
    },
    leer: (clave) => readFile(ruta(clave)),
    borrar: (clave) => rm(ruta(clave), { force: true }),
  };
}

let instancia: Almacenamiento | undefined;

export function almacenamiento(): Almacenamiento {
  if (!instancia) {
    const url = process.env.SUPABASE_URL;
    const clave = process.env.SUPABASE_SERVICE_KEY;
    instancia =
      url && clave
        ? supabase(url, clave, process.env.SUPABASE_BUCKET ?? 'documentos')
        : disco(process.env.ALMACENAMIENTO_DIR ?? join(__dirname, '..', '..', '..', 'almacenamiento'));
  }
  return instancia;
}
