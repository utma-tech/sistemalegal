-- =============================================================================
-- Programador externo de avisos con Supabase Cron (pg_cron + pg_net)
--
-- PLANTILLA: no se ejecuta sola ni la aplica ningún script. Se corre a mano en
-- el SQL Editor de Supabase, una vez, cuando se decida activar los avisos
-- automáticos (ver docs/fase-5-agenda-notificaciones.md, sección 9).
--
-- Qué hace: cada 5 minutos, la base le hace un POST a la API en Render
-- (/api/interno/programador) con el secreto CRON_SECRET en la cabecera
-- Authorization. La API evalúa las alertas de plazos y entrega lo que venció
-- en la cola de avisos.
--
-- Antes de correrla:
--   1. Definir CRON_SECRET (48+ caracteres) en Render y redesplegar.
--   2. Reemplazar abajo <URL_DE_LA_API> y <CRON_SECRET>. El secreto va a
--      Supabase Vault, no queda escrito en la definición del job.
--
-- Advertencias:
--   - pg_net guarda la cabecera (con el secreto descifrado) en
--     net.http_request_queue hasta enviar el pedido: la puede leer cualquier
--     rol que inicie sesión en la base. Son los mismos roles que ya pueden
--     leer todo; aun así, el secreto es exclusivo del programador y se puede
--     rotar sin tocar nada más.
--   - Render gratis duerme el servicio: el primer pedido tras la siesta tarda
--     ~50 s. Por eso el timeout es de 60 s. Si igual vence, el pedido despertó
--     al servicio y la corrida siguiente recupera lo atrasado.
--   - Un proyecto gratuito de Supabase se pausa tras 7 días sin uso y el cron
--     se detiene con él.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('<URL_DE_LA_API>', 'sistemalegal_url_programador');
select vault.create_secret('<CRON_SECRET>', 'sistemalegal_cron_secret');

select cron.schedule(
  'sistemalegal-avisos',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sistemalegal_url_programador')
           || '/api/interno/programador',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sistemalegal_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- Ver las corridas:         select * from cron.job_run_details order by start_time desc limit 20;
-- Ver las respuestas HTTP:  select id, status_code, created from net._http_response order by created desc limit 20;
-- Desactivar:               select cron.unschedule('sistemalegal-avisos');
