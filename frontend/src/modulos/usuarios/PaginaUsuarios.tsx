import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { KeyRound, Pencil, UserPlus } from 'lucide-react';
import {
  useGuardarIntegrante,
  useRestablecerPassword,
  useRoles,
  useUsuarios,
} from '../../servicios/consultasOperacion';
import type { Integrante } from '../../tipos/api';
import { useSesion } from '../auth/ContextoSesion';
import { ROLES_USUARIO } from '../../lib/vocabulario';
import { haceCuanto } from '../../lib/formato';
import { useErroresFormulario } from '../../lib/formulario';
import { useAvisos } from '../../componentes/ui/Avisos';
import { CabeceraPagina } from '../../componentes/ui/CabeceraPagina';
import { Tarjeta } from '../../componentes/ui/Tarjeta';
import { Boton } from '../../componentes/ui/Boton';
import { Modal } from '../../componentes/ui/Modal';
import { CampoCasilla, CampoSelect, CampoTexto } from '../../componentes/ui/Campo';
import { Dato } from '../../componentes/ui/Tabla';
import { Etiqueta } from '../../componentes/ui/Etiqueta';
import { ErrorCarga, EsqueletoTabla } from '../../componentes/ui/Estados';

/**
 * Integrantes del estudio: quién entra al sistema y con qué rol.
 *
 * Los permisos de cada rol están en la base (`rol_permiso`); acá solo se asigna
 * el rol. Un cambio de rol se aplica en la próxima renovación de la sesión
 * (hasta 15 minutos); una baja corta las sesiones en el acto.
 */
export function PaginaUsuarios() {
  const { puede, usuario } = useSesion();
  const { data, isPending, isError, error, refetch } = useUsuarios();
  const { data: roles } = useRoles();
  const [editando, setEditando] = useState<Integrante | 'nuevo'>();
  const [restableciendo, setRestableciendo] = useState<Integrante>();

  return (
    <>
      <CabeceraPagina
        titulo="Usuarios y permisos"
        descripcion="Integrantes del estudio, su rol y su acceso al sistema."
        acciones={
          puede('usuario.crear') && (
            <Boton variante="primario" icono={<UserPlus size={16} aria-hidden />} onClick={() => setEditando('nuevo')}>
              Nuevo integrante
            </Boton>
          )
        }
      />

      <Tarjeta sinRelleno>
        {isPending && <EsqueletoTabla columnas={5} />}
        {isError && <ErrorCarga error={error} reintentar={() => void refetch()} />}
        {data && (
          <div className="tabla-envoltorio">
            <table className="tabla">
              <caption className="solo-lectores">Integrantes del estudio</caption>
              <thead>
                <tr>
                  <th scope="col">Integrante</th>
                  <th scope="col">Rol</th>
                  <th scope="col" className="columna--opcional">
                    Último acceso
                  </th>
                  <th scope="col">Estado</th>
                  <th scope="col" className="columna--acciones">
                    <span className="solo-lectores">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((integrante) => (
                  <tr key={integrante.id}>
                    <td>
                      <div className="tabla__principal">
                        {integrante.apellido}, {integrante.nombre}
                        {integrante.id === usuario?.id && ' (vos)'}
                      </div>
                      <div className="tabla__secundario">
                        {integrante.email}
                        {integrante.matricula && ` · Mat. ${integrante.matricula}`}
                      </div>
                    </td>
                    <td>{integrante.rol_nombre}</td>
                    <td className="columna--opcional">
                      <Dato>{integrante.ultimo_acceso_en ? haceCuanto(integrante.ultimo_acceso_en) : 'Nunca entró'}</Dato>
                    </td>
                    <td>
                      <Etiqueta tono={integrante.activo ? 'exito' : 'neutral'}>
                        {integrante.activo ? 'Activo' : 'De baja'}
                      </Etiqueta>
                    </td>
                    <td className="tabla__acciones">
                      {puede('usuario.editar') && (
                        <>
                          <Boton
                            pequeno
                            variante="sutil"
                            icono={<Pencil size={14} aria-hidden />}
                            aria-label={`Editar a ${integrante.nombre} ${integrante.apellido}`}
                            title="Editar"
                            onClick={() => setEditando(integrante)}
                          />
                          <Boton
                            pequeno
                            variante="sutil"
                            icono={<KeyRound size={14} aria-hidden />}
                            aria-label={`Asignar contraseña a ${integrante.nombre} ${integrante.apellido}`}
                            title="Asignar contraseña"
                            onClick={() => setRestableciendo(integrante)}
                          />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>

      {roles && (
        <Tarjeta titulo="Qué puede hacer cada rol">
          <div className="datos">
            {roles.map((rol) => (
              <div key={rol.codigo}>
                <p className="dato__etiqueta">{rol.nombre}</p>
                <p className="dato__valor texto-pequeno">{rol.descripcion ?? '—'}</p>
              </div>
            ))}
          </div>
        </Tarjeta>
      )}

      {editando && (
        <DialogoIntegrante
          integrante={editando === 'nuevo' ? undefined : editando}
          alCerrar={() => setEditando(undefined)}
        />
      )}
      {restableciendo && (
        <DialogoRestablecer integrante={restableciendo} alCerrar={() => setRestableciendo(undefined)} />
      )}
    </>
  );
}

function DialogoIntegrante({ integrante, alCerrar }: { integrante?: Integrante; alCerrar: () => void }) {
  const guardar = useGuardarIntegrante(integrante?.id);
  const { avisar } = useAvisos();
  const { errores, errorGeneral, limpiar, limpiarCampo, registrar } = useErroresFormulario();
  const [nombre, setNombre] = useState(integrante?.nombre ?? '');
  const [apellido, setApellido] = useState(integrante?.apellido ?? '');
  const [email, setEmail] = useState(integrante?.email ?? '');
  const [matricula, setMatricula] = useState(integrante?.matricula ?? '');
  const [telefono, setTelefono] = useState(integrante?.telefono ?? '');
  const [rol, setRol] = useState<Integrante['rol']>(integrante?.rol ?? 'EMPLEADO');
  const [activo, setActivo] = useState(integrante?.activo ?? true);
  const [password, setPassword] = useState('');

  async function enviar(evento: SubmitEvent) {
    evento.preventDefault();
    limpiar();
    try {
      await guardar.mutateAsync({
        nombre,
        apellido,
        matricula: matricula || undefined,
        telefono: telefono || undefined,
        rol,
        ...(integrante ? { activo } : { email, password }),
      });
      avisar(integrante ? 'Integrante actualizado.' : 'Integrante creado. Ya puede entrar con su correo.');
      alCerrar();
    } catch (fallo) {
      registrar(fallo, 'No se pudo guardar.');
    }
  }

  const campo = (clave: string, set: (v: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value);
    limpiarCampo(clave);
  };

  return (
    <Modal
      abierto
      alCerrar={alCerrar}
      titulo={integrante ? 'Editar integrante' : 'Nuevo integrante'}
      descripcion={integrante?.email}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={guardar.isPending}>
            Cancelar
          </Boton>
          <Boton variante="primario" type="submit" form="formulario-integrante" cargando={guardar.isPending}>
            Guardar
          </Boton>
        </>
      }
    >
      <form id="formulario-integrante" onSubmit={enviar} noValidate className="pila">
        {errorGeneral && (
          <div className="aviso aviso--peligro" role="alert">
            <span className="aviso__cuerpo">{errorGeneral}</span>
          </div>
        )}
        <div className="datos">
          <CampoTexto etiqueta="Nombre" value={nombre} onChange={campo('nombre', setNombre)} error={errores.nombre?.[0]} obligatorio />
          <CampoTexto etiqueta="Apellido" value={apellido} onChange={campo('apellido', setApellido)} error={errores.apellido?.[0]} obligatorio />
          {!integrante && (
            <CampoTexto
              etiqueta="Correo"
              type="email"
              autoComplete="off"
              value={email}
              onChange={campo('email', setEmail)}
              error={errores.email?.[0]}
              ayuda="Con este correo entra al sistema."
              obligatorio
            />
          )}
          <CampoSelect etiqueta="Rol" value={rol} onChange={(e) => setRol(e.target.value as Integrante['rol'])} opciones={ROLES_USUARIO} />
          <CampoTexto etiqueta="Matrícula" value={matricula} onChange={campo('matricula', setMatricula)} error={errores.matricula?.[0]} />
          <CampoTexto etiqueta="Teléfono" value={telefono} onChange={campo('telefono', setTelefono)} error={errores.telefono?.[0]} />
        </div>
        {!integrante && (
          <CampoTexto
            etiqueta="Contraseña inicial"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={campo('password', setPassword)}
            error={errores.password?.[0]}
            ayuda="Al menos 8 caracteres, con letras y números. Pedile que la cambie al entrar."
            obligatorio
          />
        )}
        {integrante && (
          <CampoCasilla
            etiqueta="Activo"
            ayuda="Dar de baja cierra sus sesiones y le impide entrar. Su historial se conserva."
            checked={activo}
            onChange={(e) => setActivo(e.target.checked)}
          />
        )}
      </form>
    </Modal>
  );
}

function DialogoRestablecer({ integrante, alCerrar }: { integrante: Integrante; alCerrar: () => void }) {
  const restablecer = useRestablecerPassword();
  const { avisar } = useAvisos();
  const { errores, errorGeneral, limpiar, registrar } = useErroresFormulario();
  const [password, setPassword] = useState('');

  async function enviar(evento: SubmitEvent) {
    evento.preventDefault();
    limpiar();
    try {
      await restablecer.mutateAsync({ id: integrante.id, password });
      avisar('Contraseña asignada. Sus sesiones abiertas se cerraron.');
      alCerrar();
    } catch (fallo) {
      registrar(fallo, 'No se pudo asignar la contraseña.');
    }
  }

  return (
    <Modal
      abierto
      alCerrar={alCerrar}
      titulo="Asignar contraseña"
      descripcion={`${integrante.nombre} ${integrante.apellido} · ${integrante.email}`}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={restablecer.isPending}>
            Cancelar
          </Boton>
          <Boton variante="primario" type="submit" form="formulario-restablecer" cargando={restablecer.isPending}>
            Asignar
          </Boton>
        </>
      }
    >
      <form id="formulario-restablecer" onSubmit={enviar} noValidate className="pila">
        {errorGeneral && (
          <div className="aviso aviso--peligro" role="alert">
            <span className="aviso__cuerpo">{errorGeneral}</span>
          </div>
        )}
        <CampoTexto
          etiqueta="Nueva contraseña"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errores.password?.[0]}
          ayuda="Comunicásela por un canal seguro y pedile que la cambie."
          obligatorio
          autoFocus
        />
      </form>
    </Modal>
  );
}
