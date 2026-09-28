-- ============================================================================
-- CRON · gmail-reconcile — le « scan invisible » de la prospection (1×/heure)
-- Titre Supabase : « Cron · gmail-reconcile (scan mails sortants) »
-- ============================================================================
-- Chaque heure : lit les mails ENVOYÉS depuis la boîte agence, matche les
-- destinataires avec le carnet contacts, et met à jour tout seul
-- last_contacted + le journal touches (canal email, dédoublonné par message).
-- → Les statuts de la page WhatsApp avancent sans rien ouvrir.
--
-- ⚠️ REMPLACE_MOI_CRON_SECRET : mets la même valeur Bearer que le cron
--    gmail-poll existant (Supabase → SQL Editor → requêtes enregistrées, ou
--    cron.job). Le secret ne doit PLUS être committé dans le dépôt (public).
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('gmail-reconcile-1h') where exists (select 1 from cron.job where jobname = 'gmail-reconcile-1h');
select cron.schedule(
  'gmail-reconcile-1h',
  '12 * * * *',
  $$
  select net.http_post(
    url := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/gmail-reconcile',
    headers := jsonb_build_object(
      'Authorization','Bearer REMPLACE_MOI_CRON_SECRET',
      'Content-Type','application/json'),
    body := '{}'::jsonb
  );
  $$
);
