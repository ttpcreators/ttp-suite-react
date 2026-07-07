-- 5 · Cron alertes email (gmail-poll) — vérifie la boîte agence toutes les 5 min
-- 1er passage = baseline (aucune alerte) ; ensuite : nouveau mail → cloche + push.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('gmail-poll-5min') where exists (select 1 from cron.job where jobname = 'gmail-poll-5min');
select cron.schedule(
  'gmail-poll-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/gmail-poll',
    headers := jsonb_build_object(
      'Authorization','Bearer nq66DO+Bw8X7g6e2xu5jpAMrQuV45ixarQll2O7z9bBEMqBb0oTpCKB3v7KOo33r.',
      'Content-Type','application/json'),
    body := '{}'::jsonb
  );
  $$
);
