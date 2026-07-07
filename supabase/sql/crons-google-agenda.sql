-- Crons · Google Agenda (watch-renew + sync)
-- Maintiennent la synchro Google Agenda vivante.
--   google-watch-renew : tous les jours à 1h (renouvelle l'abonnement Google)
--   google-sync-hourly : toutes les heures à :17 (synchronise l'agenda)
select cron.unschedule('google-watch-renew');
select cron.schedule(
  'google-watch-renew', '0 1 * * *',
  $job$
  select net.http_post(
    url     := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/google-watch-renew',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer nq66DO+Bw8X7g6e2xu5jpAMrQuV45ixarQll2O7z9bBEMqBb0oTpCKB3v7KOo33r'
    ),
    body    := '{}'::jsonb
  );
  $job$
);

select cron.unschedule('google-sync-hourly');
select cron.schedule(
  'google-sync-hourly', '17 * * * *',
  $job$
  select net.http_post(
    url     := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/google-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer nq66DO+Bw8X7g6e2xu5jpAMrQuV45ixarQll2O7z9bBEMqBb0oTpCKB3v7KOo33r'
    ),
    body    := '{"trigger":"cron"}'::jsonb
  );
  $job$
);
