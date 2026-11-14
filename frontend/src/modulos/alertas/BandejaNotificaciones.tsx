import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { useBandeja, useMarcarLeida } from '../../servicios/consultasOperacion';
import type { Notificacion } from '../../tipos/api';
import { haceCuanto } from '../../lib/formato';
import { Boton } from '../../componentes/ui/Boton';
import { Etiqueta, type Tono } from '../../componentes/ui/Etiqueta';

/**
 * Campana de la barra superior.
 *
 * Muestra los avisos de vencimiento del usuario. El backend los genera al
 * consultarse la bandeja (no hay un cron: ver `modulos/alertas/servicio.ts`),
 * y la consulta se repite cada cinco minutos mientras la aplicación está abierta.
 */

const TONO: Record<string, Tono> = { CRITICA: 'peligro', IMPORTANTE: 'alerta', INFORMATIVA: 'info' };

export function BandejaNotificaciones() {
  const { data } = useBandeja();
  const marcar = useMarcarLeida();
  const [abierta, setAbierta] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);
  const navegar = useNavigate();

  useEffect(() => {
    if (!abierta) return;
    const alClic = (e: MouseEvent) => {
      if (!contenedor.current?.contains(e.target as Node)) setAbierta(false);
    };
    const alTecla = (e: KeyboardEvent) => e.key === 'Escape' && setAbierta(false);
    document.addEventListener('mousedown', alClic);
    document.addEventListener('keydown', alTecla);
    return () => {
      document.removeEventListener('mousedown', alClic);
      document.removeEventListener('keydown', alTecla);
    };
  }, [abierta]);

  function abrir(notificacion: Notificacion) {
    if (!notificacion.leida_en) marcar.mutate(notificacion.id);
    setAbierta(false);
    if (notificacion.causa_id) navegar(`/expedientes/${notificacion.causa_id}?pestana=plazos`);
  }

  const noLeidas = data?.no_leidas ?? 0;

  return (
    <div className="menu-usuario" ref={contenedor}>
      <Boton
        variante="sutil"
        onClick={() => setAbierta((a) => !a)}
        aria-haspopup="menu"
        aria-expanded={abierta}
        aria-label={noLeidas > 0 ? `Avisos: ${noLeidas} sin leer` : 'Avisos'}
        icono={
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <Bell size={18} aria-hidden />
            {noLeidas > 0 && (
              <span className="navegacion__contador campana__contador" aria-hidden>
                {noLeidas > 9 ? '9+' : noLeidas}
              </span>
            )}
          </span>
        }
      />

      {abierta && (
        <div className="menu menu--bandeja" role="menu">
          <div className="menu__cabecera fila fila--separada">
            <p className="menu-usuario__nombre">Avisos de vencimiento</p>
            {noLeidas > 0 && (
              <Boton pequeno variante="sutil" icono={<CheckCheck size={14} aria-hidden />} onClick={() => marcar.mutate('todas')}>
                Marcar leídos
              </Boton>
            )}
          </div>

          {(data?.datos ?? []).length === 0 && (
            <p className="texto-pequeno texto-tenue" style={{ padding: 'var(--esp-4)' }}>
              No hay avisos. Te avisamos acá cuando un plazo a tu cargo se acerque al vencimiento.
            </p>
          )}

          {(data?.datos ?? []).map((n) => (
            <button
              key={n.id}
              type="button"
              role="menuitem"
              className="menu__item menu__item--aviso"
              data-leida={n.leida_en ? 'si' : 'no'}
              onClick={() => abrir(n)}
            >
              <span className="pila--ajustada" style={{ display: 'grid', gap: 2, textAlign: 'left' }}>
                <span className="fila" style={{ gap: 'var(--esp-2)' }}>
                  {n.nivel && <Etiqueta tono={TONO[n.nivel] ?? 'neutral'}>{n.titulo}</Etiqueta>}
                  <span className="texto-pequeno texto-tenue">{haceCuanto(n.creado_en)}</span>
                </span>
                <span className="texto-pequeno">{n.mensaje}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
