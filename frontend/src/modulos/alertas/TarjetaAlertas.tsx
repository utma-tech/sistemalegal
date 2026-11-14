import { Link } from 'react-router-dom';
import { BellRing } from 'lucide-react';
import { useAlertas } from '../../servicios/consultasOperacion';
import { useSesion } from '../auth/ContextoSesion';
import { fechaLarga } from '../../lib/formato';
import { Tarjeta } from '../../componentes/ui/Tarjeta';
import { Etiqueta, type Tono } from '../../componentes/ui/Etiqueta';
import { ErrorCarga, EsqueletoLista } from '../../componentes/ui/Estados';

/**
 * Alertas multinivel vigentes: crítica, importante, informativa.
 *
 * El nivel lo deciden las reglas del estudio (`regla_alerta`), contando la
 * anticipación en días hábiles. Un plazo vencido y abierto siempre es crítico.
 */

const TONO: Record<string, Tono> = { CRITICA: 'peligro', IMPORTANTE: 'alerta', INFORMATIVA: 'info' };
const TEXTO: Record<string, string> = { CRITICA: 'Crítica', IMPORTANTE: 'Importante', INFORMATIVA: 'Informativa' };

function cuando(habiles: number): string {
  if (habiles < 0) return `Venció hace ${-habiles} ${habiles === -1 ? 'día' : 'días'}`;
  if (habiles === 0) return 'Vence hoy';
  return `${habiles} ${habiles === 1 ? 'día hábil' : 'días hábiles'}`;
}

export function TarjetaAlertas({ alcance = 'todas', limite = 8 }: { alcance?: 'todas' | 'mias'; limite?: number }) {
  const { puede } = useSesion();
  const { data, isPending, isError, error, refetch } = useAlertas(alcance, puede('alerta.ver'));

  if (!puede('alerta.ver')) return null;

  const resumen = data?.resumen;
  return (
    <Tarjeta
      titulo="Alertas de vencimiento"
      descripcion={
        resumen ? (
          <span className="fila fila--envuelve" style={{ gap: 'var(--esp-2)' }}>
            <Etiqueta tono="peligro">{resumen.CRITICA} críticas</Etiqueta>
            <Etiqueta tono="alerta">{resumen.IMPORTANTE} importantes</Etiqueta>
            <Etiqueta tono="info">{resumen.INFORMATIVA} informativas</Etiqueta>
          </span>
        ) : undefined
      }
      sinRelleno
    >
      {isPending && <EsqueletoLista filas={3} />}
      {isError && <ErrorCarga error={error} reintentar={() => void refetch()} />}
      {data && data.datos.length === 0 && (
        <div className="estado">
          <div className="estado__icono">
            <BellRing size={20} aria-hidden />
          </div>
          <p className="estado__titulo">Nada que alertar</p>
          <p className="estado__texto">Ningún plazo pendiente entró en la ventana de aviso de las reglas del estudio.</p>
        </div>
      )}
      {data && data.datos.length > 0 && (
        <div className="lista">
          {data.datos.slice(0, limite).map((alerta) => (
            <Link key={alerta.plazo_id} to={`/expedientes/${alerta.causa_id}?pestana=plazos`} className="lista__item">
              <span className="lista__cuerpo">
                <span className="lista__titulo">{alerta.descripcion}</span>
                <span className="lista__meta">
                  {alerta.caratula} · vence el {fechaLarga(alerta.fecha_vencimiento)}
                  {alerta.responsable ? ` · ${alerta.responsable}` : ' · sin responsable'}
                </span>
              </span>
              <span className="lista__lateral">
                <span className="texto-pequeno texto-tenue">{cuando(alerta.habiles_restantes)}</span>
                <Etiqueta tono={TONO[alerta.nivel] ?? 'neutral'} punto>
                  {TEXTO[alerta.nivel]}
                </Etiqueta>
              </span>
            </Link>
          ))}
          {data.datos.length > limite && (
            <p className="texto-pequeno texto-tenue" style={{ padding: 'var(--esp-3) var(--esp-4)' }}>
              Y {data.datos.length - limite} más en la agenda.
            </p>
          )}
        </div>
      )}
    </Tarjeta>
  );
}
