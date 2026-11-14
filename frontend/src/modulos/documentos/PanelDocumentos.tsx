import { useEffect, useRef, useState } from 'react';
import { Download, FileText, Paperclip, RefreshCw, ScanText, Trash2, Upload } from 'lucide-react';
import { useCatalogos, useDocumentosCausa } from '../../servicios/consultas';
import {
  descargarArchivo,
  useEliminarDocumento,
  useReintentarExtraccion,
  useSubirDocumento,
  useTextoDocumento,
} from '../../servicios/consultasOperacion';
import type { DocumentoCausa } from '../../tipos/api';
import { useSesion } from '../auth/ContextoSesion';
import { fecha, tamanoArchivo } from '../../lib/formato';
import { useAvisos } from '../../componentes/ui/Avisos';
import { Tarjeta } from '../../componentes/ui/Tarjeta';
import { Boton } from '../../componentes/ui/Boton';
import { Modal } from '../../componentes/ui/Modal';
import { FiltroSelect } from '../../componentes/ui/Campo';
import { DialogoConfirmar } from '../../componentes/ui/DialogoConfirmar';
import { Etiqueta, type Tono } from '../../componentes/ui/Etiqueta';
import { Cargando, ErrorCarga, EsqueletoLista, Vacio } from '../../componentes/ui/Estados';

/**
 * Pestaña Documentos del expediente.
 *
 * El archivo se puede soltar sobre la zona o elegir con el botón. Los PDF pasan
 * por la extracción de texto, que corre en segundo plano: la lista muestra en
 * qué estado está y se puede reintentar si falló.
 */

const MEGAS_MAXIMO = 10;
const ACEPTADOS = '.pdf,.png,.jpg,.jpeg,.docx,.txt';

const TONO_EXTRACCION: Record<string, Tono> = {
  COMPLETADA: 'exito',
  ERROR: 'peligro',
  PROCESANDO: 'info',
  PENDIENTE: 'alerta',
  NO_APLICA: 'neutral',
};
const TEXTO_EXTRACCION: Record<string, string> = {
  COMPLETADA: 'Texto extraído',
  ERROR: 'Falló la extracción',
  PROCESANDO: 'Extrayendo texto…',
  PENDIENTE: 'Texto pendiente',
  NO_APLICA: 'Sin texto',
};

export function PanelDocumentos({ causaId }: { causaId: string }) {
  const { puede } = useSesion();
  const { avisar } = useAvisos();
  const { data: catalogos } = useCatalogos();
  const documentos = useDocumentosCausa(causaId, true);
  const subir = useSubirDocumento(causaId);
  const reintentar = useReintentarExtraccion(causaId);
  const eliminar = useEliminarDocumento(causaId);
  const selector = useRef<HTMLInputElement>(null);
  const [tipo, setTipo] = useState('');
  const [arrastrando, setArrastrando] = useState(false);
  const [viendoTexto, setViendoTexto] = useState<DocumentoCausa>();
  const [aEliminar, setAEliminar] = useState<DocumentoCausa>();
  const [errorBaja, setErrorBaja] = useState<string>();

  // Mientras haya un PDF procesándose, la lista se vuelve a pedir sola.
  const procesando = documentos.data?.some((d) => d.estado_extraccion === 'PROCESANDO') ?? false;
  const { refetch } = documentos;
  useEffect(() => {
    if (!procesando) return;
    const reloj = setInterval(() => void refetch(), 3000);
    return () => clearInterval(reloj);
  }, [procesando, refetch]);

  async function cargar(archivos: FileList | null) {
    for (const archivo of Array.from(archivos ?? [])) {
      if (archivo.size > MEGAS_MAXIMO * 1024 * 1024) {
        avisar(`«${archivo.name}» supera los ${MEGAS_MAXIMO} MB.`, 'error');
        continue;
      }
      try {
        await subir.mutateAsync({ archivo, tipoDocumentoId: tipo || undefined });
        avisar(`«${archivo.name}» cargado.`);
      } catch (fallo) {
        avisar(fallo instanceof Error ? `${archivo.name}: ${fallo.message}` : 'No se pudo cargar el archivo.', 'error');
      }
    }
    if (selector.current) selector.current.value = '';
  }

  async function bajar(documento: DocumentoCausa) {
    try {
      await descargarArchivo(`/api/documentos/${documento.id}/archivo`, documento.nombre_original);
    } catch (fallo) {
      avisar(fallo instanceof Error ? fallo.message : 'No se pudo descargar.', 'error');
    }
  }

  async function confirmarBaja() {
    if (!aEliminar) return;
    setErrorBaja(undefined);
    try {
      await eliminar.mutateAsync(aEliminar.id);
      avisar('Documento quitado del expediente.');
      setAEliminar(undefined);
    } catch (fallo) {
      setErrorBaja(fallo instanceof Error ? fallo.message : 'No se pudo quitar.');
    }
  }

  return (
    <Tarjeta titulo="Documentos" sinRelleno>
      {puede('documento.crear') && (
        <div style={{ padding: 'var(--esp-4)' }} className="pila">
          <div
            className="zona-carga"
            data-arrastrando={arrastrando ? 'si' : 'no'}
            onDragOver={(e) => {
              e.preventDefault();
              setArrastrando(true);
            }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={(e) => {
              e.preventDefault();
              setArrastrando(false);
              void cargar(e.dataTransfer.files);
            }}
            onClick={() => selector.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && selector.current?.click()}
            aria-label="Cargar documentos"
          >
            <Upload size={20} aria-hidden />
            <span>
              {subir.isPending ? 'Cargando…' : 'Soltá los archivos acá o hacé clic para elegirlos'}
            </span>
            <span className="texto-pequeno texto-tenue">PDF, JPG, PNG, Word (.docx) o texto · hasta {MEGAS_MAXIMO} MB</span>
          </div>
          <input
            ref={selector}
            type="file"
            accept={ACEPTADOS}
            multiple
            hidden
            onChange={(e) => void cargar(e.target.files)}
          />
          <FiltroSelect
            etiqueta="Tipo de los documentos a cargar"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            opciones={(catalogos?.tiposDocumento ?? []).map((t) => ({ valor: t.id, texto: t.nombre }))}
            vacio="Sin clasificar"
          />
        </div>
      )}

      {documentos.isPending && <EsqueletoLista />}
      {documentos.isError && <ErrorCarga error={documentos.error} reintentar={() => void documentos.refetch()} />}
      {documentos.data?.length === 0 && (
        <Vacio titulo="Sin documentos" texto="Todavía no se cargó nada en este expediente." icono={<Paperclip size={20} aria-hidden />} />
      )}
      {documentos.data && documentos.data.length > 0 && (
        <div className="lista">
          {documentos.data.map((documento) => (
            <div key={documento.id} className="lista__item">
              <span className="indicador__icono" style={{ width: 30, height: 30 }} aria-hidden>
                <FileText size={15} />
              </span>
              <span className="lista__cuerpo">
                <span className="lista__titulo">{documento.nombre_original}</span>
                <span className="lista__meta">
                  {documento.tipo_documento ?? 'Sin clasificar'} · {tamanoArchivo(documento.tamano_bytes)} ·{' '}
                  {fecha(documento.fecha_subida)}
                  {documento.subido_por && ` · ${documento.subido_por}`}
                </span>
              </span>
              <span className="lista__lateral">
                <Etiqueta tono={TONO_EXTRACCION[documento.estado_extraccion] ?? 'neutral'}>
                  {TEXTO_EXTRACCION[documento.estado_extraccion] ?? documento.estado_extraccion}
                </Etiqueta>
                {documento.estado_extraccion === 'COMPLETADA' && (
                  <Boton
                    pequeno
                    variante="sutil"
                    icono={<ScanText size={14} aria-hidden />}
                    title="Ver el texto extraído"
                    aria-label={`Ver el texto de ${documento.nombre_original}`}
                    onClick={() => setViendoTexto(documento)}
                  />
                )}
                {(documento.estado_extraccion === 'ERROR' || documento.estado_extraccion === 'PENDIENTE') &&
                  puede('documento.editar') && (
                    <Boton
                      pequeno
                      variante="sutil"
                      icono={<RefreshCw size={14} aria-hidden />}
                      title="Reintentar la extracción"
                      aria-label={`Reintentar la extracción de ${documento.nombre_original}`}
                      cargando={reintentar.isPending && reintentar.variables === documento.id}
                      onClick={() =>
                        void reintentar
                          .mutateAsync(documento.id)
                          .then((r) => avisar(r.estado === 'COMPLETADA' ? 'Texto extraído.' : 'La extracción volvió a fallar.'))
                          .catch((f: unknown) => avisar(f instanceof Error ? f.message : 'No se pudo reintentar.', 'error'))
                      }
                    />
                  )}
                <Boton
                  pequeno
                  variante="sutil"
                  icono={<Download size={14} aria-hidden />}
                  title="Descargar"
                  aria-label={`Descargar ${documento.nombre_original}`}
                  onClick={() => void bajar(documento)}
                />
                {puede('documento.eliminar') && (
                  <Boton
                    pequeno
                    variante="sutil"
                    icono={<Trash2 size={14} aria-hidden />}
                    title="Quitar"
                    aria-label={`Quitar ${documento.nombre_original}`}
                    onClick={() => setAEliminar(documento)}
                  />
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {viendoTexto && <DialogoTexto documento={viendoTexto} alCerrar={() => setViendoTexto(undefined)} />}

      <DialogoConfirmar
        abierto={Boolean(aEliminar)}
        titulo="Quitar el documento"
        mensaje={
          <>
            <strong>{aEliminar?.nombre_original}</strong> deja de verse en el expediente. El archivo no se borra del
            almacenamiento y la baja queda en la auditoría.
          </>
        }
        textoConfirmar="Quitar"
        cargando={eliminar.isPending}
        error={errorBaja}
        alConfirmar={() => void confirmarBaja()}
        alCerrar={() => setAEliminar(undefined)}
      />
    </Tarjeta>
  );
}

function DialogoTexto({ documento, alCerrar }: { documento: DocumentoCausa; alCerrar: () => void }) {
  const { data, isPending, isError, error } = useTextoDocumento(documento.id);
  return (
    <Modal
      abierto
      alCerrar={alCerrar}
      titulo={documento.nombre_original}
      descripcion={data?.cantidad_paginas ? `${data.cantidad_paginas} páginas · texto extraído` : 'Texto extraído'}
      ancho
    >
      {isPending && <Cargando />}
      {isError && <ErrorCarga error={error} />}
      {data && (
        <div className="texto-extraido">
          {data.texto?.trim() || 'El PDF no tiene texto seleccionable (probablemente es un escaneo).'}
        </div>
      )}
    </Modal>
  );
}
