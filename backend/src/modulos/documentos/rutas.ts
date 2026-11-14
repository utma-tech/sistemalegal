import express, { Router, type Request, type Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requierePermiso } from '../../middlewares/autenticacion';
import { consultaValidada, validarConsulta } from '../../middlewares/validacion';
import { idDeRuta } from '../../comun/ruta';
import { ErrorConflicto, ErrorHttp, ErrorNoEncontrado, ErrorSolicitud } from '../../comun/errores';
import { config } from '../../config';
import { obtenerPool } from '../../db';
import { registrar } from '../auditoria/servicio';
import { almacenamiento } from './almacenamiento';
import { detectarTipo } from './tipos-archivo';
import { extraerTexto } from './extraccion';

/**
 * Documentos de un expediente.
 *
 * La subida viaja como **cuerpo binario** (no multipart): el navegador manda el
 * archivo tal cual y los metadatos en la query string. Evita una dependencia
 * de parseo de multipart y su superficie de ataque, y el tamaño lo corta
 * `express.raw` antes de que el archivo entre entero a memoria.
 *
 * Qué es el archivo lo decide su **contenido** (los primeros bytes), no la
 * extensión ni el Content-Type que manda el cliente, que se pueden falsear.
 */

const esquemaSubida = z.object({
  nombre: z.string().trim().min(1, 'Falta el nombre del archivo.').max(255),
  tipo_documento_id: z
    .uuid('Tipo de documento inválido.')
    .optional()
    .or(z.literal(''))
    .transform((v) => v || undefined),
  descripcion: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => v || undefined),
});

const esquemaBusqueda = z.object({
  q: z.string().trim().min(2, 'Escribí al menos dos letras.').max(100),
  causa: z.uuid().optional(),
});

/** Nombre seguro para guardar y para Content-Disposition: sin rutas ni caracteres de control. */
function sanear(nombre: string): string {
  const base = nombre.split(/[\\/]/).pop() ?? 'archivo';
  return base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '_').slice(0, 200) || 'archivo';
}

interface DocumentoFila {
  id: string;
  causa_id: string;
  nombre_original: string;
  mime_type: string;
  tamano_bytes: string;
  ruta_almacenamiento: string;
  estado_extraccion: string;
}

async function exigirDocumento(id: string): Promise<DocumentoFila> {
  const { rows } = await obtenerPool().query<DocumentoFila>(
    `SELECT d.id, d.causa_id, d.nombre_original, d.mime_type, d.tamano_bytes::text AS tamano_bytes,
            d.ruta_almacenamiento, d.estado_extraccion
       FROM documento d JOIN causa c ON c.id = d.causa_id AND c.eliminado_en IS NULL
      WHERE d.id = $1 AND d.eliminado_en IS NULL`,
    [id],
  );
  if (!rows[0]) throw new ErrorNoEncontrado('No encontramos ese documento.');
  return rows[0];
}

/**
 * Corre la extracción y guarda el resultado.
 *
 * Se llama sin esperar la respuesta (la subida no se demora por el PDF) y nunca
 * lanza: cualquier problema queda en `estado_extraccion = ERROR` con el motivo
 * en `documento_texto.mensaje_error`, que la pantalla muestra.
 */
async function procesarExtraccion(id: string, contenido: Buffer): Promise<void> {
  const pool = obtenerPool();
  try {
    await pool.query(`UPDATE documento SET estado_extraccion = 'PROCESANDO' WHERE id = $1`, [id]);
    const resultado = await extraerTexto(contenido);
    await pool.query(
      `INSERT INTO documento_texto (documento_id, texto, cantidad_paginas, motor_extraccion, mensaje_error)
       VALUES ($1, $2, $3, 'pdfplumber', NULL)
       ON CONFLICT (documento_id) DO UPDATE
         SET texto = EXCLUDED.texto, cantidad_paginas = EXCLUDED.cantidad_paginas,
             fecha_extraccion = now(), mensaje_error = NULL`,
      [id, resultado.texto, resultado.paginas > 0 ? resultado.paginas : null],
    );
    await pool.query(`UPDATE documento SET estado_extraccion = 'COMPLETADA' WHERE id = $1`, [id]);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'Falló la extracción.';
    console.error('[documentos] extracción fallida', id, mensaje);
    await pool
      .query(
        `INSERT INTO documento_texto (documento_id, texto, mensaje_error) VALUES ($1, NULL, $2)
         ON CONFLICT (documento_id) DO UPDATE SET mensaje_error = EXCLUDED.mensaje_error, fecha_extraccion = now()`,
        [id, mensaje.slice(0, 500)],
      )
      .catch(() => undefined);
    await pool
      .query(`UPDATE documento SET estado_extraccion = 'ERROR' WHERE id = $1`, [id])
      .catch(() => undefined);
  }
}

export const rutasDocumentosDeCausa = Router({ mergeParams: true });

rutasDocumentosDeCausa.post(
  '/documentos',
  requierePermiso('documento.crear'),
  express.raw({ type: () => true, limit: `${config.megasMaximoArchivo}mb` }),
  validarConsulta(esquemaSubida),
  async (req: Request, res: Response) => {
    const causaId = idDeRuta(req, 'expediente');
    const datos = consultaValidada<z.infer<typeof esquemaSubida>>(req);
    const contenido = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    if (contenido.length === 0) throw new ErrorSolicitud('El archivo está vacío.');

    const nombre = sanear(datos.nombre);
    const tipo = detectarTipo(contenido, nombre);
    if (!tipo) {
      throw new ErrorSolicitud(
        'Ese tipo de archivo no se admite. Se aceptan PDF, imágenes (JPG, PNG), Word (.docx) y texto.',
      );
    }

    const pool = obtenerPool();
    const { rows: causa } = await pool.query(
      'SELECT 1 FROM causa WHERE id = $1 AND eliminado_en IS NULL',
      [causaId],
    );
    if (!causa[0]) throw new ErrorNoEncontrado('No encontramos ese expediente.');

    const hash = createHash('sha256').update(contenido).digest('hex');
    const { rows: repetido } = await pool.query<{ caratula: string }>(
      `SELECT c.caratula FROM documento d JOIN causa c ON c.id = d.causa_id
        WHERE d.hash_sha256 = $1 AND d.eliminado_en IS NULL`,
      [hash],
    );
    if (repetido[0]) {
      throw new ErrorConflicto(`Ese archivo ya está cargado, en «${repetido[0].caratula}».`);
    }

    // La clave no usa el nombre original: dos archivos con el mismo nombre no
    // chocan y el nombre no puede inyectar rutas en el almacenamiento.
    const id = randomUUID();
    const clave = `causas/${causaId}/${id}.${tipo.extension}`;
    await almacenamiento().guardar(clave, contenido, tipo.mime);

    try {
      await pool.query(
        `INSERT INTO documento (id, causa_id, tipo_documento_id, nombre_archivo, nombre_original, mime_type,
                                tamano_bytes, ruta_almacenamiento, hash_sha256, estado_extraccion,
                                descripcion, subido_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          id,
          causaId,
          datos.tipo_documento_id ?? null,
          `${id}.${tipo.extension}`,
          nombre,
          tipo.mime,
          contenido.length,
          clave,
          hash,
          tipo.extension === 'pdf' ? 'PENDIENTE' : 'NO_APLICA',
          datos.descripcion ?? null,
          req.sesion!.id,
        ],
      );
    } catch (error) {
      // Sin fila en la base el archivo quedaría huérfano en el almacenamiento.
      await almacenamiento().borrar(clave).catch(() => undefined);
      if ((error as { code?: string }).code === '23503') {
        throw new ErrorSolicitud('Ese tipo de documento no existe.');
      }
      throw error;
    }

    if (tipo.extension === 'pdf' && config.urlServicioPdf) void procesarExtraccion(id, contenido);

    const documento = { id, causa_id: causaId, nombre_original: nombre, mime_type: tipo.mime, tamano_bytes: contenido.length };
    await registrar(req, { entidad: 'documento', entidadId: id, accion: 'CREAR', datosDespues: documento });
    res.status(201).json({ documento });
  },
);

export const rutasDocumentos = Router();

/**
 * Búsqueda en el texto de los PDF.
 *
 * La consulta normaliza igual que el índice (`fn_sin_acentos` + diccionario
 * español), o el índice no se usaría y las tildes volverían a romper la
 * búsqueda. `websearch_to_tsquery` acepta lo que escribe una persona
 * ("contestación demanda", "-reconvención") sin errores de sintaxis.
 */
rutasDocumentos.get(
  '/buscar',
  requierePermiso('documento.ver'),
  validarConsulta(esquemaBusqueda),
  async (req: Request, res: Response) => {
    const { q, causa } = consultaValidada<z.infer<typeof esquemaBusqueda>>(req);
    const { rows } = await obtenerPool().query(
      `SELECT d.id, d.causa_id, c.caratula, c.numero_expediente, d.nombre_original,
              ts_headline('spanish', dt.texto, websearch_to_tsquery('spanish', fn_sin_acentos($1)),
                          'MaxWords=30, MinWords=12, MaxFragments=2, StartSel=«, StopSel=»') AS fragmento,
              ts_rank(to_tsvector('spanish', fn_sin_acentos(coalesce(dt.texto, ''))),
                      websearch_to_tsquery('spanish', fn_sin_acentos($1))) AS relevancia
         FROM documento_texto dt
         JOIN documento d ON d.id = dt.documento_id AND d.eliminado_en IS NULL
         JOIN causa c     ON c.id = d.causa_id AND c.eliminado_en IS NULL
        WHERE to_tsvector('spanish', fn_sin_acentos(coalesce(dt.texto, '')))
              @@ websearch_to_tsquery('spanish', fn_sin_acentos($1))
          AND ($2::uuid IS NULL OR d.causa_id = $2::uuid)
        ORDER BY relevancia DESC
        LIMIT 30`,
      [q, causa ?? null],
    );
    res.json({ datos: rows });
  },
);

rutasDocumentos.get('/:id/archivo', requierePermiso('documento.ver'), async (req: Request, res: Response) => {
  const documento = await exigirDocumento(idDeRuta(req, 'documento'));
  let contenido: Buffer;
  try {
    contenido = await almacenamiento().leer(documento.ruta_almacenamiento);
  } catch (error) {
    console.error('[documentos] no se pudo leer', documento.id, error);
    throw new ErrorHttp(
      502,
      'ALMACENAMIENTO_NO_DISPONIBLE',
      'El archivo no está disponible en el almacenamiento. Si se subió antes de configurar Supabase Storage, hay que volver a cargarlo.',
    );
  }

  await registrar(req, { entidad: 'documento', entidadId: documento.id, accion: 'CONSULTAR' });

  // attachment + nosniff: el navegador lo descarga y nunca lo interpreta como
  // HTML, aunque alguien haya logrado subir algo con forma de página.
  res.setHeader('Content-Type', documento.mime_type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${documento.nombre_original.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(documento.nombre_original)}`,
  );
  res.send(contenido);
});

rutasDocumentos.get('/:id/texto', requierePermiso('documento.ver'), async (req: Request, res: Response) => {
  const documento = await exigirDocumento(idDeRuta(req, 'documento'));
  const { rows } = await obtenerPool().query(
    `SELECT texto, cantidad_paginas, fecha_extraccion, mensaje_error FROM documento_texto WHERE documento_id = $1`,
    [documento.id],
  );
  res.json({ estado: documento.estado_extraccion, ...(rows[0] ?? { texto: null }) });
});

rutasDocumentos.post('/:id/extraer', requierePermiso('documento.editar'), async (req: Request, res: Response) => {
  const documento = await exigirDocumento(idDeRuta(req, 'documento'));
  if (documento.mime_type !== 'application/pdf') {
    throw new ErrorConflicto('Solo se extrae texto de los PDF.');
  }
  if (!config.urlServicioPdf) {
    throw new ErrorConflicto('El servicio de extracción de PDF no está configurado (PDF_SERVICE_URL).');
  }
  const contenido = await almacenamiento().leer(documento.ruta_almacenamiento);
  await procesarExtraccion(documento.id, contenido);
  const { rows } = await obtenerPool().query<{ estado_extraccion: string }>(
    'SELECT estado_extraccion FROM documento WHERE id = $1',
    [documento.id],
  );
  res.json({ estado: rows[0]?.estado_extraccion });
});

/**
 * Baja lógica. El archivo se conserva en el almacenamiento: un documento de un
 * expediente es prueba, y borrarlo por un clic equivocado no tiene vuelta.
 */
rutasDocumentos.delete('/:id', requierePermiso('documento.eliminar'), async (req: Request, res: Response) => {
  const documento = await exigirDocumento(idDeRuta(req, 'documento'));
  await obtenerPool().query('UPDATE documento SET eliminado_en = now() WHERE id = $1', [documento.id]);
  await registrar(req, { entidad: 'documento', entidadId: documento.id, accion: 'ELIMINAR', datosAntes: documento });
  res.json({ documento });
});
