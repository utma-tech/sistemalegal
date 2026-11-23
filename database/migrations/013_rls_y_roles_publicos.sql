-- =============================================================================
-- 013 — Row Level Security y roles públicos de Supabase
-- Sistema de Gestión Integral para Estudios Jurídicos
-- =============================================================================
--
-- La aplicación nunca expone la base al navegador: todo pasa por la API, que
-- se conecta como dueña de las tablas. Pero Supabase publica el esquema public
-- por su Data API (PostgREST) con los roles `anon` y `authenticated`, y la
-- clave anon no es secreta. Sin esta migración, quien la tenga podría leer o
-- escribir las tablas directamente, salteando la API y todos sus controles.
--
-- Dos barreras, cada una suficiente por sí sola:
--
--  1. RLS activado en todas las tablas y SIN políticas: para cualquier rol que
--     no sea el dueño, cada tabla aparece vacía y no admite escrituras.
--  2. Se quitan los permisos de anon y authenticated sobre el esquema, también
--     para las tablas que se creen en el futuro.
--
-- Al backend no le cambia nada: el dueño de una tabla no está sujeto a sus
-- políticas salvo que se use FORCE ROW LEVEL SECURITY, que acá no se usa. En
-- el PostgreSQL local (docker compose, CI) los roles de Supabase no existen y
-- el bloque 2 no hace nada.
-- =============================================================================

DO $$
DECLARE
    tabla record;
BEGIN
    FOR tabla IN
        SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', tabla.schemaname, tabla.tablename);
    END LOOP;
END;
$$;

DO $$
DECLARE
    rol text;
BEGIN
    FOREACH rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
            EXECUTE format('REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM %I', rol);
            EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', rol);
            EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', rol);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM %I', rol);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', rol);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', rol);
        END IF;
    END LOOP;
END;
$$;
