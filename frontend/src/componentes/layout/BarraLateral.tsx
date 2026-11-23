import { useState, type FocusEvent, type MouseEvent } from 'react';
import { NavLink } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, Scale, Stethoscope } from 'lucide-react';
import { useSesion } from '../../modulos/auth/ContextoSesion';
import { Boton } from '../ui/Boton';
import { NAVEGACION, NAVEGACION_ADMINISTRACION, NAVEGACION_PENDIENTE, type ItemNavegacion } from './navegacion';

/**
 * Barra lateral: la navegación principal.
 *
 * Azul petróleo, con los nombres siempre visibles mientras no se contraiga.
 * Los iconos acompañan al texto, no lo reemplazan: un icono solo es ambiguo.
 * Contraída, cada enlace muestra su nombre en un tooltip al pasar el mouse o
 * al recibir el foco del teclado.
 */

interface Tooltip {
  texto: string;
  top: number;
  left: number;
}

interface Props {
  contraida: boolean;
  alternarContraida: () => void;
  abiertaEnMovil: boolean;
  alCerrarEnMovil: () => void;
  nombreEstudio?: string;
}

export function BarraLateral({
  contraida,
  alternarContraida,
  abiertaEnMovil,
  alCerrarEnMovil,
  nombreEstudio,
}: Props) {
  const { puede } = useSesion();
  const visibles = NAVEGACION.filter((item) => !item.permiso || puede(item.permiso));
  const administracion = NAVEGACION_ADMINISTRACION.filter((item) => !item.permiso || puede(item.permiso));
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);

  // El tooltip se dibuja fuera de la lista con posición fija: la navegación
  // tiene desplazamiento propio y recortaría cualquier cosa que sobresalga.
  function mostrarTooltip(texto: string) {
    return (evento: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
      // En el cajón del teléfono los nombres ya se ven: no hace falta tooltip.
      if (!contraida || window.matchMedia('(max-width: 900px)').matches) return;
      const caja = evento.currentTarget.getBoundingClientRect();
      setTooltip({ texto, top: caja.top + caja.height / 2, left: caja.right + 10 });
    };
  }
  const ocultarTooltip = () => setTooltip(null);
  const conTooltip = (texto: string) => ({
    onMouseEnter: mostrarTooltip(texto),
    onFocus: mostrarTooltip(texto),
    onMouseLeave: ocultarTooltip,
    onBlur: ocultarTooltip,
    'aria-label': contraida ? texto : undefined,
  });

  const enlace = (item: ItemNavegacion) => (
    <NavLink
      key={item.ruta}
      to={item.ruta}
      // `end` solo en Inicio: sin eso, "/" quedaría activo en todas las
      // rutas, porque toda ruta empieza con barra.
      end={item.ruta === '/'}
      onClick={() => {
        ocultarTooltip();
        alCerrarEnMovil();
      }}
      {...conTooltip(item.texto)}
      className={({ isActive }) => `navegacion__enlace${isActive ? ' navegacion__enlace--activo' : ''}`}
    >
      <item.icono size={17} strokeWidth={1.75} aria-hidden />
      <span className="navegacion__texto">{item.texto}</span>
    </NavLink>
  );

  return (
    <aside
      className={`barra-lateral${abiertaEnMovil ? ' barra-lateral--abierta' : ''}`}
      aria-label="Navegación principal"
    >
      <NavLink to="/" className="barra-lateral__marca" onClick={alCerrarEnMovil}>
        <span className="barra-lateral__logo" aria-hidden>
          <Scale size={17} strokeWidth={1.75} />
        </span>
        <span className="barra-lateral__identidad">
          <span className="barra-lateral__nombre">SistemaLegal</span>
          {nombreEstudio && <span className="barra-lateral__estudio">{nombreEstudio}</span>}
        </span>
      </NavLink>

      <nav className="barra-lateral__navegacion">
        <div className="barra-lateral__grupo">{visibles.map(enlace)}</div>

        {administracion.length > 0 && (
          <div className="barra-lateral__grupo">
            <p className="barra-lateral__titulo-grupo">Administración</p>
            {administracion.map(enlace)}
          </div>
        )}

        <div className="barra-lateral__grupo">
          <p className="barra-lateral__titulo-grupo">En desarrollo</p>
          {NAVEGACION_PENDIENTE.map((item) => (
            <span
              key={item.texto}
              className="navegacion__enlace navegacion__enlace--inactivo"
              tabIndex={contraida ? 0 : undefined}
              {...conTooltip(`${item.texto} · en desarrollo`)}
              aria-disabled="true"
            >
              <item.icono size={17} strokeWidth={1.75} aria-hidden />
              <span className="navegacion__texto">{item.texto}</span>
              <span className="navegacion__pronto">Pronto</span>
            </span>
          ))}
        </div>
      </nav>

      <div className="barra-lateral__pie">
        <NavLink
          to="/diagnostico"
          onClick={() => {
            ocultarTooltip();
            alCerrarEnMovil();
          }}
          {...conTooltip('Diagnóstico del sistema')}
          className={({ isActive }) => `navegacion__enlace${isActive ? ' navegacion__enlace--activo' : ''}`}
        >
          <Stethoscope size={17} strokeWidth={1.75} aria-hidden />
          <span className="navegacion__texto">Diagnóstico</span>
        </NavLink>

        <div className="barra-lateral__pie-fila">
          <span className="barra-lateral__creditos">Powered by UTMA Technologies</span>
          <Boton
            variante="sutil"
            pequeno
            className="barra-lateral__contraer"
            onClick={() => {
              ocultarTooltip();
              alternarContraida();
            }}
            aria-label={contraida ? 'Expandir la barra lateral' : 'Contraer la barra lateral'}
            icono={contraida ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
          />
        </div>
      </div>

      {tooltip && (
        <span className="tooltip tooltip--derecha" role="tooltip" style={{ top: tooltip.top, left: tooltip.left }}>
          {tooltip.texto}
        </span>
      )}
    </aside>
  );
}
