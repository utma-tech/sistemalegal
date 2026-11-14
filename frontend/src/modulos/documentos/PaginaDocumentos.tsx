import { Link, useSearchParams } from 'react-router-dom';
import { FileSearch } from 'lucide-react';
import { useBuscarDocumentos } from '../../servicios/consultasOperacion';
import { CabeceraPagina } from '../../componentes/ui/CabeceraPagina';
import { Tarjeta } from '../../componentes/ui/Tarjeta';
import { Buscador } from '../../componentes/ui/Buscador';
import { ErrorCarga, EsqueletoLista, Vacio } from '../../componentes/ui/Estados';

/**
 * Búsqueda en el contenido de los documentos.
 *
 * Busca dentro del texto extraído de los PDF de todos los expedientes, con el
 * índice de texto completo en español de la base: "notificacion" encuentra
 * "NOTIFICACIÓN", y "contestar demanda" encuentra "contestación de la demanda".
 * Los documentos se cargan desde cada expediente.
 */

/** El fragmento llega con «» marcando las coincidencias; se resaltan sin interpretar HTML. */
function Fragmento({ texto }: { texto: string }) {
  const partes = texto.split(/(«[^»]*»)/g);
  return (
    <span className="lista__meta">
      {partes.map((parte, i) =>
        parte.startsWith('«') ? <mark key={i}>{parte.slice(1, -1)}</mark> : <span key={i}>{parte}</span>,
      )}
    </span>
  );
}

export function PaginaDocumentos() {
  const [parametros, setParametros] = useSearchParams();
  const q = parametros.get('q') ?? '';

  const { data, isFetching, isError, error } = useBuscarDocumentos(q);

  return (
    <>
      <CabeceraPagina
        titulo="Documentos"
        descripcion="Buscá dentro del texto de los PDF de todos los expedientes del estudio."
      />

      <Tarjeta>
        <Buscador
          valor={q}
          alCambiar={(texto) => setParametros(texto ? { q: texto } : {}, { replace: true })}
          autoFoco
          marcador="Palabras del escrito: «cédula traslado», «perito contador»…"
          etiqueta="Buscar en los documentos"
        />
      </Tarjeta>

      {q.trim().length < 2 && (
        <Tarjeta>
          <Vacio
            titulo="Escribí al menos dos letras"
            texto="La búsqueda ignora tildes y mayúsculas, y encuentra variantes de la misma palabra."
            icono={<FileSearch size={20} aria-hidden />}
          />
        </Tarjeta>
      )}

      {q.trim().length >= 2 && (
        <Tarjeta sinRelleno titulo={data ? `${data.length} ${data.length === 1 ? 'documento' : 'documentos'}` : undefined}>
          {isFetching && !data && <EsqueletoLista />}
          {isError && <ErrorCarga error={error} />}
          {data?.length === 0 && (
            <Vacio
              titulo="Sin resultados"
              texto="Solo se busca en PDF con texto extraído. Un escaneo sin texto no aparece."
              icono={<FileSearch size={20} aria-hidden />}
            />
          )}
          {data && data.length > 0 && (
            <div className="lista">
              {data.map((r) => (
                <Link key={r.id} to={`/expedientes/${r.causa_id}?pestana=documentos`} className="lista__item">
                  <span className="lista__cuerpo">
                    <span className="lista__titulo">{r.nombre_original}</span>
                    <span className="lista__meta">
                      {r.caratula}
                      {r.numero_expediente && ` · Expte. ${r.numero_expediente}`}
                    </span>
                    {r.fragmento && <Fragmento texto={r.fragmento} />}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Tarjeta>
      )}
    </>
  );
}
