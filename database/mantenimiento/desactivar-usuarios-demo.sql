-- =============================================================================
-- Desactiva los usuarios de demostración (*@estudiodemo.test)
-- =============================================================================
--
-- Para un entorno público: la contraseña de esos usuarios (Demo1234!) está en
-- el README, así que cualquiera podía entrar como Administrador.
--
-- ANTES de correrlo, crear un Administrador propio desde la aplicación:
-- entrar como admin@estudiodemo.test, ir a Usuarios y dar de alta la cuenta
-- con rol Administrador (queda en la auditoría). `npm run crear-admin` no
-- sirve acá: se niega a correr mientras haya un Administrador activo, y el
-- de demostración lo es. El script se niega a seguir si después no quedaría ningún Administrador
-- activo fuera de los de demostración: sin esa guarda, el estudio se quedaría
-- afuera de su propio sistema.
--
-- No borra nada: desactiva las cuentas y corta sus sesiones. Los expedientes
-- de demostración siguen visibles para el administrador nuevo. Se revierte con
--     UPDATE usuario SET activo = TRUE WHERE email LIKE '%@estudiodemo.test';
--
-- Uso (con la cadena del pooler de Supabase en DATABASE_URL):
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/mantenimiento/desactivar-usuarios-demo.sql
-- =============================================================================

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM usuario u
          JOIN rol r ON r.id = u.rol_id
         WHERE r.codigo = 'ADMIN'
           AND u.activo
           AND lower(u.email) NOT LIKE '%@estudiodemo.test'
    ) THEN
        RAISE EXCEPTION 'No hay ningún Administrador activo fuera de los de demostración. '
                        'Creá uno desde Usuarios en la aplicación y volvé a correr este script.';
    END IF;
END;
$$;

UPDATE refresh_token rt
   SET revocado_en = now()
  FROM usuario u
 WHERE rt.usuario_id = u.id
   AND lower(u.email) LIKE '%@estudiodemo.test'
   AND rt.revocado_en IS NULL;

UPDATE usuario
   SET activo = FALSE
 WHERE lower(email) LIKE '%@estudiodemo.test'
   AND activo;

SELECT email, activo FROM usuario WHERE lower(email) LIKE '%@estudiodemo.test' ORDER BY email;

COMMIT;
