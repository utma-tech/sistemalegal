import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, LogOut, Menu, Search, UserRound } from 'lucide-react';
import { useSesion } from '../../modulos/auth/ContextoSesion';
import { iniciales } from '../../lib/formato';
import { Boton } from '../ui/Boton';
import { BandejaNotificaciones } from '../../modulos/alertas/BandejaNotificaciones';
import { DialogoMiPassword } from '../../modulos/usuarios/DialogoMiPassword';
import { rutaDeSeccion } from './navegacion';

/**
 * Barra superior: contexto de la sección, búsqueda global y usuario.
 */

interface Props {
  titulo: string;
  alAbrirMenu: () => void;
  alAbrirBusqueda: () => void;
}

export function BarraSuperior({ titulo, alAbrirMenu, alAbrirBusqueda }: Props) {
  const { usuario, cerrarSesion } = useSesion();
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [cambiandoPassword, setCambiandoPassword] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const rutaSeccion = rutaDeSeccion(ubicacion.pathname);

  // Un menú abierto se cierra al hacer clic afuera o con Escape. Sin esto,
  // queda flotando mientras el usuario trabaja en otra parte.
  useEffect(() => {
    if (!menuAbierto) return;

    function alClic(evento: MouseEvent) {
      if (!contenedor.current?.contains(evento.target as Node)) setMenuAbierto(false);
    }
    function alPresionar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') setMenuAbierto(false);
    }

    document.addEventListener('mousedown', alClic);
    document.addEventListener('keydown', alPresionar);
    return () => {
      document.removeEventListener('mousedown', alClic);
      document.removeEventListener('keydown', alPresionar);
    };
  }, [menuAbierto]);

  async function salir() {
    setMenuAbierto(false);
    await cerrarSesion();
    navegar('/acceso', { replace: true });
  }

  return (
    <header className="barra-superior">
      <Boton
        variante="sutil"
        className="boton-menu"
        onClick={alAbrirMenu}
        aria-label="Abrir la navegación"
        icono={<Menu size={18} aria-hidden />}
      />

      {/* No es un <h1>: el título de la pantalla lo pone cada página. Esto es
          contexto de ubicación, y en un detalle lleva de vuelta a la sección. */}
      <div className="barra-superior__contexto">
        {rutaSeccion && rutaSeccion !== ubicacion.pathname ? (
          <Link to={rutaSeccion} className="barra-superior__titulo barra-superior__titulo--enlace">
            {titulo}
          </Link>
        ) : (
          <span className="barra-superior__titulo">{titulo}</span>
        )}
      </div>

      <div className="barra-superior__busqueda">
        <button
          type="button"
          className="buscador buscador-global"
          onClick={alAbrirBusqueda}
          aria-label="Buscar en todo el sistema"
        >
          <Search size={16} className="buscador__icono" aria-hidden />
          <span className="entrada buscador-global__campo">Buscar expedientes, clientes…</span>
          <kbd className="atajo">Ctrl K</kbd>
        </button>
      </div>

      <div className="barra-superior__acciones">
        <Boton
          variante="sutil"
          onClick={alAbrirBusqueda}
          className="boton-menu"
          aria-label="Buscar"
          icono={<Search size={18} aria-hidden />}
        />

        <BandejaNotificaciones />

        <div className="menu-usuario" ref={contenedor}>
          <button
            type="button"
            className="menu-usuario__disparador"
            onClick={() => setMenuAbierto((abierto) => !abierto)}
            aria-haspopup="menu"
            aria-expanded={menuAbierto}
          >
            <span className="avatar" aria-hidden>
              {iniciales(usuario?.nombre, usuario?.apellido)}
            </span>
            <span className="menu-usuario__datos">
              <span className="menu-usuario__nombre">
                {usuario?.nombre} {usuario?.apellido}
              </span>
              <span className="menu-usuario__rol">{usuario?.rolNombre}</span>
            </span>
          </button>

          {menuAbierto && (
            <div className="menu" role="menu">
              <div className="menu__cabecera">
                <p className="menu-usuario__nombre">
                  {usuario?.nombre} {usuario?.apellido}
                </p>
                <p className="texto-pequeno texto-tenue">{usuario?.email}</p>
                <p className="texto-pequeno texto-tenue" style={{ marginTop: 2 }}>
                  <UserRound size={12} aria-hidden style={{ display: 'inline', verticalAlign: -2 }} />{' '}
                  {usuario?.rolNombre}
                </p>
              </div>

              <button
                type="button"
                className="menu__item"
                role="menuitem"
                onClick={() => {
                  setMenuAbierto(false);
                  setCambiandoPassword(true);
                }}
              >
                <KeyRound size={16} aria-hidden />
                Cambiar mi contraseña
              </button>

              <button type="button" className="menu__item menu__item--peligro" role="menuitem" onClick={salir}>
                <LogOut size={16} aria-hidden />
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>

      {cambiandoPassword && <DialogoMiPassword alCerrar={() => setCambiandoPassword(false)} />}
    </header>
  );
}
