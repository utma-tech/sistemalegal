import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCambiarMiPassword } from '../../servicios/consultasOperacion';
import { useSesion } from '../auth/ContextoSesion';
import { useErroresFormulario } from '../../lib/formulario';
import { useAvisos } from '../../componentes/ui/Avisos';
import { Modal } from '../../componentes/ui/Modal';
import { Boton } from '../../componentes/ui/Boton';
import { CampoTexto } from '../../componentes/ui/Campo';

/**
 * Cambio de la contraseña propia.
 *
 * Cambiarla cierra todas las sesiones abiertas —incluida esta—, porque es lo
 * que se hace cuando se sospecha que alguien más la conoce. Por eso, al
 * terminar, se vuelve a la pantalla de acceso.
 */
export function DialogoMiPassword({ alCerrar }: { alCerrar: () => void }) {
  const cambiar = useCambiarMiPassword();
  const { cerrarSesion } = useSesion();
  const { avisar } = useAvisos();
  const navegar = useNavigate();
  const { errores, errorGeneral, limpiar, limpiarCampo, registrar } = useErroresFormulario();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [errorRepetida, setErrorRepetida] = useState<string>();

  async function enviar(evento: SubmitEvent) {
    evento.preventDefault();
    limpiar();
    setErrorRepetida(undefined);
    if (nueva !== repetida) {
      setErrorRepetida('Las contraseñas no coinciden.');
      return;
    }
    try {
      await cambiar.mutateAsync({ actual, nueva });
      avisar('Contraseña cambiada. Volvé a entrar con la nueva.');
      alCerrar();
      await cerrarSesion();
      navegar('/acceso', { replace: true });
    } catch (fallo) {
      registrar(fallo, 'No se pudo cambiar la contraseña.');
    }
  }

  return (
    <Modal
      abierto
      alCerrar={alCerrar}
      titulo="Cambiar mi contraseña"
      descripcion="Se cierran todas tus sesiones abiertas, también en otros dispositivos."
      pie={
        <>
          <Boton onClick={alCerrar} disabled={cambiar.isPending}>
            Cancelar
          </Boton>
          <Boton variante="primario" type="submit" form="formulario-mi-password" cargando={cambiar.isPending}>
            Cambiar
          </Boton>
        </>
      }
    >
      <form id="formulario-mi-password" onSubmit={enviar} noValidate className="pila">
        {errorGeneral && (
          <div className="aviso aviso--peligro" role="alert">
            <span className="aviso__cuerpo">{errorGeneral}</span>
          </div>
        )}
        <CampoTexto
          etiqueta="Contraseña actual"
          type="password"
          autoComplete="current-password"
          value={actual}
          onChange={(e) => {
            setActual(e.target.value);
            limpiarCampo('actual');
          }}
          error={errores.actual?.[0]}
          obligatorio
          autoFocus
        />
        <CampoTexto
          etiqueta="Nueva contraseña"
          type="password"
          autoComplete="new-password"
          value={nueva}
          onChange={(e) => {
            setNueva(e.target.value);
            limpiarCampo('nueva');
          }}
          ayuda="Al menos 8 caracteres, con letras y números."
          error={errores.nueva?.[0]}
          obligatorio
        />
        <CampoTexto
          etiqueta="Repetí la nueva"
          type="password"
          autoComplete="new-password"
          value={repetida}
          onChange={(e) => setRepetida(e.target.value)}
          error={errorRepetida}
          obligatorio
        />
      </form>
    </Modal>
  );
}
