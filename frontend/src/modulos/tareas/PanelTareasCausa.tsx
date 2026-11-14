import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTareas } from '../../servicios/consultasOperacion';
import { useSesion } from '../auth/ContextoSesion';
import { Tarjeta } from '../../componentes/ui/Tarjeta';
import { Boton } from '../../componentes/ui/Boton';
import { ErrorCarga, EsqueletoLista } from '../../componentes/ui/Estados';
import { DialogoTarea } from './DialogoTarea';
import { ListaTareas } from './ListaTareas';

/** Pestaña Tareas del expediente: las abiertas primero, y el alta con la causa ya puesta. */
export function PanelTareasCausa({ causaId, caratula }: { causaId: string; caratula: string }) {
  const { puede } = useSesion();
  const [creando, setCreando] = useState(false);
  const { data, isPending, isError, error, refetch } = useTareas({
    pagina: 1,
    tamano: 100,
    causa: causaId,
    vigencia: 'todas',
  });

  return (
    <Tarjeta
      titulo="Tareas del expediente"
      sinRelleno
      accion={
        puede('tarea.crear') && (
          <Boton pequeno icono={<Plus size={15} aria-hidden />} onClick={() => setCreando(true)}>
            Nueva tarea
          </Boton>
        )
      }
    >
      {isPending && <EsqueletoLista />}
      {isError && <ErrorCarga error={error} reintentar={() => void refetch()} />}
      {data && (
        <ListaTareas
          tareas={data.datos}
          mostrarExpediente={false}
          textoVacio="Delegá acá lo que hay que hacer en este expediente: quién, qué y para cuándo."
        />
      )}
      {creando && <DialogoTarea abierto alCerrar={() => setCreando(false)} causaId={causaId} caratula={caratula} />}
    </Tarjeta>
  );
}
