import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Mail, Play, RotateCcw, Send } from 'lucide-react';
import {
  useCorreoDePrueba,
  useEstadoNotificaciones,
  useProcesarAhora,
  useReintentarEnvio,
  useVistaPreviaCorreo,
} from '../../servicios/consultasAgenda';
import { useSesion } from '../auth/ContextoSesion';
import { useAvisos } from '../../componentes/ui/Avisos';
import { CabeceraPagina } from '../../componentes/ui/CabeceraPagina';
import { Tarjeta } from '../../componentes/ui/Tarjeta';
import { Boton } from '../../componentes/ui/Boton';
import { Etiqueta } from '../../componentes/ui/Etiqueta';
import { FiltroSelect } from '../../componentes/ui/Campo';
import { ErrorCarga, EsqueletoLista, Vacio } from '../../componentes/ui/Estados';
import { fechaHora, haceCuanto } from '../../lib/formato';

/**
 * Administración de notificaciones (solo Administrador).
 *
 * Responde tres preguntas: ¿el correo está configurado?, ¿el programador
 * externo está corriendo?, ¿hay envíos trabados o fallidos? Nunca muestra la
 * clave del proveedor ni el secreto del programador: solo si están puestos.
 */

const PLANTILLAS = [
  { valor: 'RECORDATORIO_AUDIENCIA', texto: 'Recordatorio de audiencia' },
  { valor: 'RECORDATORIO_REUNION', texto: 'Recordatorio de reunión' },
  { valor: 'RECORDATORIO_MEDIACION', texto: 'Recordatorio de mediación' },
  { valor: 'PLAZO_PROXIMO', texto: 'Próximo vencimiento' },
  { valor: 'PLAZO_CRITICO', texto: 'Vencimiento crítico' },
  { valor: 'EVENTO_ASIGNADO', texto: 'Nueva asignación' },
  { valor: 'EVENTO_REPROGRAMADO', texto: 'Reprogramación' },
  { valor: 'EVENTO_CANCELADO', texto: 'Cancelación' },
  { valor: 'PRUEBA', texto: 'Correo de prueba' },
];

const MODOS = {
  deshabilitado: { texto: 'Deshabilitado', tono: 'neutral' as const, ayuda: 'No sale ningún correo. Los avisos dentro del sistema funcionan igual.' },
  simulado: { texto: 'Simulado', tono: 'info' as const, ayuda: 'Los correos se arman y se registran, pero no se envían.' },
  real: { texto: 'Activo', tono: 'exito' as const, ayuda: 'Los correos se envían por el proveedor configurado.' },
};

const TIPOS_ENVIO: Record<string, string> = {
  RECORDATORIO_EVENTO: 'Recordatorio',
  EVENTO_ASIGNADO: 'Asignación',
  EVENTO_REPROGRAMADO: 'Reprogramación',
  EVENTO_CANCELADO: 'Cancelación',
  PLAZO_ALERTA: 'Alerta de plazo',
  PRUEBA: 'Prueba',
};

function Linea({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="estado-notif__linea">
      <span className="estado-notif__etiqueta">{etiqueta}</span>
      <span className="estado-notif__valor">{children}</span>
    </div>
  );
}

export function PaginaNotificaciones() {
  const { puede } = useSesion();
  const estado = useEstadoNotificaciones();
  const procesar = useProcesarAhora();
  const prueba = useCorreoDePrueba();
  const reintentar = useReintentarEnvio();
  const { avisar } = useAvisos();
  const [plantilla, setPlantilla] = useState('RECORDATORIO_AUDIENCIA');
  const vista = useVistaPreviaCorreo(plantilla);

  if (!puede('configuracion.notificaciones')) {
    return <Vacio titulo="Sin acceso" texto="Esta sección es de la administración del estudio." />;
  }

  async function procesarAhora() {
    try {
      const { resumen } = await procesar.mutateAsync();
      avisar(`Corrida manual: ${resumen.procesados} procesados, ${resumen.aceptados} entregados.`);
    } catch (fallo) {
      avisar(fallo instanceof Error ? fallo.message : 'No se pudo procesar la cola.', 'error');
    }
  }

  async function enviarPrueba() {
    try {
      const resultado = await prueba.mutateAsync();
      if (resultado.estado === 'ACEPTADO') avisar(`Correo de prueba aceptado para ${resultado.destinatario}.`);
      else avisar(resultado.error ?? `El envío quedó en estado ${resultado.estado}.`, 'error');
    } catch (fallo) {
      avisar(fallo instanceof Error ? fallo.message : 'No se pudo enviar la prueba.', 'error');
    }
  }

  const datos = estado.data;
  const modo = datos ? MODOS[datos.correo.modo] : undefined;
  const contar = (estadoEnvio: string) =>
    (datos?.cola.por_estado ?? []).filter((f) => f.estado === estadoEnvio).reduce((total, f) => total + f.total, 0);

  return (
    <>
      <CabeceraPagina
        titulo="Notificaciones"
        descripcion="Estado del correo, del programador de avisos y de la cola de envíos."
        acciones={
          <Boton icono={<Play size={15} />} onClick={() => void procesarAhora()} cargando={procesar.isPending}>
            Procesar ahora
          </Boton>
        }
      />

      {estado.isError ? (
        <ErrorCarga error={estado.error} reintentar={() => void estado.refetch()} />
      ) : !datos || !modo ? (
        <EsqueletoLista filas={6} />
      ) : (
        <div className="rejilla-notif">
          <Tarjeta titulo="Correo electrónico" descripcion={modo.ayuda}>
            <div className="estado-notif">
              <Linea etiqueta="Estado">
                <Etiqueta tono={modo.tono} punto>
                  {modo.texto}
                </Etiqueta>
              </Linea>
              <Linea etiqueta="Proveedor">{datos.correo.modo === 'real' ? datos.correo.proveedor : '—'}</Linea>
              <Linea etiqueta="Remitente">{datos.correo.remitente_configurado ? 'Configurado' : 'Sin configurar'}</Linea>
              <Linea etiqueta="Enlace a la aplicación">{datos.correo.app_url_configurada ? 'Configurado' : 'Sin configurar'}</Linea>
              <Linea etiqueta="Zona horaria">{datos.zona_horaria}</Linea>
              {datos.correo.faltantes.length > 0 && datos.correo.modo_pedido === 'real' && (
                <div className="aviso aviso--alerta">
                  <AlertTriangle size={16} aria-hidden />
                  <span className="aviso__cuerpo">Falta configurar: {datos.correo.faltantes.join(', ')}.</span>
                </div>
              )}
            </div>
            <div className="estado-notif__acciones">
              <Boton
                pequeno
                icono={<Send size={14} />}
                onClick={() => void enviarPrueba()}
                cargando={prueba.isPending}
                disabled={datos.correo.modo === 'deshabilitado'}
              >
                Enviarme un correo de prueba
              </Boton>
            </div>
          </Tarjeta>

          <Tarjeta titulo="Programador de avisos" descripcion="Servicio externo que dispara recordatorios aunque nadie tenga la aplicación abierta.">
            <div className="estado-notif">
              <Linea etiqueta="Secreto">{datos.programador.configurado ? 'Configurado' : 'Sin configurar'}</Linea>
              <Linea etiqueta="Última ejecución">
                {datos.programador.ultima_ejecucion
                  ? `${haceCuanto(datos.programador.ultima_ejecucion.iniciado_en)} · ${
                      datos.programador.ultima_ejecucion.origen === 'MANUAL' ? 'manual' : 'automática'
                    }`
                  : 'Nunca'}
              </Linea>
              <Linea etiqueta="Última exitosa">
                {datos.programador.ultima_exitosa ? fechaHora(datos.programador.ultima_exitosa.iniciado_en) : 'Nunca'}
              </Linea>
              {!datos.programador.configurado ? (
                <div className="aviso aviso--alerta">
                  <Clock size={16} aria-hidden />
                  <span className="aviso__cuerpo">
                    Falta configurar CRON_SECRET y el programador externo. Sin él, los avisos internos llegan al abrir la
                    aplicación, pero los correos no salen solos.
                  </span>
                </div>
              ) : datos.programador.atrasado ? (
                <div className="aviso aviso--alerta">
                  <Clock size={16} aria-hidden />
                  <span className="aviso__cuerpo">
                    No hubo una corrida exitosa en los últimos {datos.programador.minutos_atraso} minutos. Los avisos internos
                    llegan igual al abrir la aplicación, pero los correos esperan al programador.
                  </span>
                </div>
              ) : (
                <div className="aviso aviso--exito">
                  <CheckCircle2 size={16} aria-hidden />
                  <span className="aviso__cuerpo">Corriendo con normalidad.</span>
                </div>
              )}
            </div>
          </Tarjeta>

          <Tarjeta titulo="Cola de envíos" descripcion="Últimos 7 días y todo lo que sigue pendiente.">
            <div className="cifras-notif">
              <div className="cifra-notif">
                <span className="cifra-notif__valor">{contar('PENDIENTE') + contar('PROCESANDO')}</span>
                <span className="cifra-notif__etiqueta">Pendientes</span>
              </div>
              <div className="cifra-notif">
                <span className="cifra-notif__valor">{contar('ACEPTADO')}</span>
                <span className="cifra-notif__etiqueta">Entregados</span>
              </div>
              <div className="cifra-notif">
                <span className="cifra-notif__valor">{contar('CANCELADO')}</span>
                <span className="cifra-notif__etiqueta">Descartados</span>
              </div>
              <div className={`cifra-notif${contar('FALLIDO') ? ' cifra-notif--peligro' : ''}`}>
                <span className="cifra-notif__valor">{contar('FALLIDO')}</span>
                <span className="cifra-notif__etiqueta">Fallidos</span>
              </div>
            </div>
            {datos.cola.vencidos_sin_procesar > 0 && (
              <p className="estado-notif__nota">
                {datos.cola.vencidos_sin_procesar} ya llegaron a su hora y esperan la próxima corrida.
              </p>
            )}
          </Tarjeta>

          <Tarjeta titulo="Envíos fallidos" descripcion="Agotaron los reintentos o el proveedor los rechazó." sinRelleno className="rejilla-notif__ancha">
            {datos.fallidos.length === 0 ? (
              <p className="subgrupo__vacio subgrupo__vacio--suelto">
                <CheckCircle2 size={15} aria-hidden /> Ningún envío fallido.
              </p>
            ) : (
              <div className="tabla-contenedor">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Canal</th>
                      <th>Destinatario</th>
                      <th>Intentos</th>
                      <th>Último error</th>
                      <th>Fecha</th>
                      <th className="columna--acciones">
                        <span className="solo-lectores">Acciones</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.fallidos.map((envio) => (
                      <tr key={envio.id}>
                        <td>{TIPOS_ENVIO[envio.tipo] ?? envio.tipo}</td>
                        <td>{envio.canal === 'EMAIL' ? <Mail size={14} aria-label="Correo" /> : 'Interno'}</td>
                        <td>{envio.destinatario}</td>
                        <td>{envio.intentos}</td>
                        <td className="estado-notif__error">{envio.ultimo_error ?? '—'}</td>
                        <td>{envio.procesado_en ? fechaHora(envio.procesado_en) : '—'}</td>
                        <td className="columna--acciones">
                          <Boton
                            pequeno
                            variante="sutil"
                            icono={<RotateCcw size={14} />}
                            onClick={() =>
                              void reintentar
                                .mutateAsync(envio.id)
                                .then(() => avisar('Envío reprogramado para la próxima corrida.'))
                                .catch(() => avisar('No se pudo reintentar.', 'error'))
                            }
                          >
                            Reintentar
                          </Boton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Tarjeta>

          <Tarjeta
            titulo="Vista previa de correos"
            descripcion="Con datos de ejemplo. Los correos reales no incluyen carátulas, nombres de clientes ni títulos de eventos."
            className="rejilla-notif__ancha"
          >
            <div className="vista-correo__selector">
              <FiltroSelect
                etiqueta="Plantilla"
                vacio="Elegí una plantilla"
                opciones={PLANTILLAS}
                value={plantilla}
                onChange={(e) => e.target.value && setPlantilla(e.target.value)}
              />
            </div>
            {vista.isPending ? (
              <EsqueletoLista filas={3} />
            ) : vista.isError ? (
              <ErrorCarga error={vista.error} reintentar={() => void vista.refetch()} />
            ) : (
              <div className="vista-correo">
                <p className="vista-correo__asunto">
                  <span>Asunto:</span> {vista.data.asunto}
                </p>
                <VistaCorreo html={vista.data.html} titulo={vista.data.asunto} />
              </div>
            )}
          </Tarjeta>
        </div>
      )}
    </>
  );
}

/**
 * Muestra el HTML de un correo dentro de la página.
 *
 * No se usa un iframe: la política de seguridad del sitio (CSP, style-src
 * 'self') también rige dentro de un iframe srcdoc y bloquearía los estilos en
 * línea del correo. En cambio se parsea el HTML con DOMParser (que no ejecuta
 * nada), se descartan scripts y atributos on*, y los estilos se aplican por
 * CSSOM, que la CSP permite. Un Shadow DOM aísla el correo de los estilos de
 * la aplicación, como lo vería un cliente de correo.
 */
function VistaCorreo({ html, titulo }: { html: string; titulo: string }) {
  const contenedor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const anfitrion = contenedor.current;
    if (!anfitrion) return;
    const raiz = anfitrion.shadowRoot ?? anfitrion.attachShadow({ mode: 'open' });
    raiz.replaceChildren();

    const documento = new DOMParser().parseFromString(html, 'text/html');
    documento.querySelectorAll('script, iframe, object, embed, link, meta, title').forEach((nodo) => nodo.remove());

    const envoltura = document.createElement('div');
    const estiloCuerpo = documento.body.getAttribute('style');
    if (estiloCuerpo) envoltura.style.cssText = estiloCuerpo;

    const estilos: [Element, string][] = [];
    documento.body.querySelectorAll('*').forEach((elemento) => {
      for (const atributo of [...elemento.attributes]) {
        if (atributo.name.startsWith('on')) elemento.removeAttribute(atributo.name);
      }
      const estilo = elemento.getAttribute('style');
      if (estilo) {
        estilos.push([elemento, estilo]);
        elemento.removeAttribute('style');
      }
      if (elemento instanceof HTMLAnchorElement) {
        elemento.target = '_blank';
        elemento.rel = 'noopener noreferrer';
      }
    });

    for (const nodo of [...documento.body.childNodes]) envoltura.appendChild(document.importNode(nodo, true));
    raiz.appendChild(envoltura);

    // importNode copia la estructura; los estilos se aplican sobre los nodos ya importados.
    const originales = [...documento.body.querySelectorAll('*')];
    const importados = [...envoltura.querySelectorAll('*')];
    for (const [elemento, estilo] of estilos) {
      const indice = originales.indexOf(elemento);
      const destino = importados[indice] as HTMLElement | undefined;
      if (destino) destino.style.cssText = estilo;
    }
  }, [html]);

  return <div ref={contenedor} className="vista-correo__marco" role="document" aria-label={`Vista previa: ${titulo}`} />;
}
