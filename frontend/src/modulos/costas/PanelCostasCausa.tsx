import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useCostas } from '../../servicios/consultasOperacion';
import { useSesion } from '../auth/ContextoSesion';
import { importe } from '../../lib/formato';
import { Tarjeta } from '../../componentes/ui/Tarjeta';
import { Boton } from '../../componentes/ui/Boton';
import { ErrorCarga, EsqueletoTabla } from '../../componentes/ui/Estados';
import { DialogoCosta } from './DialogosCostas';
import { TablaCostas } from './TablaCostas';

/** Pestaña Costas del expediente: lo devengado, lo cobrado y el saldo. */
export function PanelCostasCausa({ causaId, caratula }: { causaId: string; caratula: string }) {
  const { puede } = useSesion();
  const [creando, setCreando] = useState(false);
  const { data, isPending, isError, error, refetch } = useCostas({
    pagina: 1,
    tamano: 100,
    causa: causaId,
    vigencia: 'todas',
  });

  return (
    <Tarjeta
      titulo="Costas y cobros"
      descripcion={
        data && data.total > 0
          ? `Devengado ${importe(data.totales.monto)} · cobrado ${importe(data.totales.cobrado)} · por cobrar ${importe(data.totales.saldo)}`
          : undefined
      }
      sinRelleno
      accion={
        puede('costa.crear') && (
          <Boton pequeno icono={<Plus size={15} aria-hidden />} onClick={() => setCreando(true)}>
            Registrar costa
          </Boton>
        )
      }
    >
      {isPending && <EsqueletoTabla columnas={5} />}
      {isError && <ErrorCarga error={error} reintentar={() => void refetch()} />}
      {data && <TablaCostas costas={data.datos} mostrarExpediente={false} />}
      {creando && <DialogoCosta causaId={causaId} caratula={caratula} alCerrar={() => setCreando(false)} />}
    </Tarjeta>
  );
}
