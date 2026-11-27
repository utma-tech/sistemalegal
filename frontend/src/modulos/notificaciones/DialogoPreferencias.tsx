import { useEffect, useState } from 'react';
import type { SubmitEvent } from 'react';
import { Info } from 'lucide-react';
import { useGuardarPreferencias, usePreferencias } from '../../servicios/consultasAgenda';
import type { PreferenciasNotificacion } from '../../tipos/api';
import { useAvisos } from '../../componentes/ui/Avisos';
import { Modal } from '../../componentes/ui/Modal';
import { Boton } from '../../componentes/ui/Boton';
import { CampoCasilla } from '../../componentes/ui/Campo';
import { EsqueletoLista, ErrorCarga } from '../../componentes/ui/Estados';

/**
 * Preferencias personales de notificación ("Mi cuenta → Notificaciones").
 *
 * Gobiernan el CORREO. Los avisos dentro del sistema (la campana) llegan
 * siempre: apagar el correo nunca puede esconder un vencimiento crítico. La
 * configuración técnica del estudio (proveedor, remitente) no aparece acá: es
 * de la administración.
 */

const GRUPOS: { titulo: string; campos: { campo: keyof PreferenciasNotificacion; texto: string; ayuda?: string }[] }[] = [
  {
    titulo: 'Recordatorios de la agenda',
    campos: [
      { campo: 'recordatorio_audiencia', texto: 'Audiencias' },
      { campo: 'recordatorio_mediacion', texto: 'Mediaciones' },
      { campo: 'recordatorio_reunion', texto: 'Reuniones' },
      { campo: 'recordatorio_otros', texto: 'Otros eventos y vencimientos administrativos' },
    ],
  },
  {
    titulo: 'Avisos',
    campos: [
      { campo: 'aviso_plazos', texto: 'Plazos procesales a mi cargo', ayuda: 'Según las reglas de alerta por días hábiles.' },
      { campo: 'aviso_asignaciones', texto: 'Cuando me suman a un evento' },
      { campo: 'aviso_reprogramaciones', texto: 'Cuando se reprograma un evento' },
      { campo: 'aviso_cancelaciones', texto: 'Cuando se cancela un evento' },
    ],
  },
];

export function DialogoPreferencias({ alCerrar }: { alCerrar: () => void }) {
  const consulta = usePreferencias();
  const guardar = useGuardarPreferencias();
  const { avisar } = useAvisos();
  const [valores, setValores] = useState<PreferenciasNotificacion>();

  useEffect(() => {
    if (consulta.data && !valores) setValores(consulta.data.preferencias);
  }, [consulta.data, valores]);

  async function enviar(evento: SubmitEvent) {
    evento.preventDefault();
    if (!valores || guardar.isPending) return;
    try {
      await guardar.mutateAsync(valores);
      avisar('Preferencias guardadas.');
      alCerrar();
    } catch {
      avisar('No se pudieron guardar las preferencias. Intentá de nuevo.', 'error');
    }
  }

  const cambiar = (campo: keyof PreferenciasNotificacion, valor: boolean) =>
    setValores((previos) => (previos ? { ...previos, [campo]: valor } : previos));

  return (
    <Modal
      abierto
      alCerrar={alCerrar}
      titulo="Notificaciones por correo"
      descripcion="Elegí qué avisos te llegan también por correo electrónico."
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardar.isPending}>
            Cancelar
          </Boton>
          <Boton variante="primario" type="submit" form="formulario-preferencias" cargando={guardar.isPending} disabled={!valores}>
            Guardar
          </Boton>
        </>
      }
    >
      {consulta.isError ? (
        <ErrorCarga error={consulta.error} reintentar={() => void consulta.refetch()} />
      ) : !valores ? (
        <EsqueletoLista filas={4} />
      ) : (
        <form id="formulario-preferencias" onSubmit={enviar} className="preferencias">
          <div className="aviso aviso--info">
            <Info size={16} aria-hidden />
            <span className="aviso__cuerpo">
              Dentro del sistema vas a ver siempre todos los avisos. Estas opciones solo deciden qué te llega por correo.
              {consulta.data?.correo_del_estudio === 'inactivo' &&
                ' El correo del estudio todavía no está activado: tus elecciones se aplicarán cuando lo esté.'}
            </span>
          </div>

          <CampoCasilla
            etiqueta="Recibir avisos por correo"
            ayuda="Desactivalo para no recibir ningún correo de SistemaLegal."
            checked={valores.correo_habilitado}
            onChange={(e) => cambiar('correo_habilitado', e.target.checked)}
          />

          {GRUPOS.map((grupo) => (
            <fieldset key={grupo.titulo} className="preferencias__grupo" disabled={!valores.correo_habilitado}>
              <legend className="preferencias__titulo">{grupo.titulo}</legend>
              {grupo.campos.map(({ campo, texto, ayuda }) => (
                <CampoCasilla
                  key={campo}
                  etiqueta={texto}
                  ayuda={ayuda}
                  checked={valores[campo]}
                  onChange={(e) => cambiar(campo, e.target.checked)}
                />
              ))}
            </fieldset>
          ))}
        </form>
      )}
    </Modal>
  );
}
