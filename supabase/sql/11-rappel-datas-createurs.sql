-- ============================================================================
-- 11-rappel-datas-createurs.sql
-- ----------------------------------------------------------------------------
-- Rappel mensuel « mettre à jour les données de chaque créateur ».
--
--   • Colonne creators.stats_month ("YYYY-MM") : marquée quand l'agence coche
--     « à jour » sur une ligne du roster (bouton dans la page Roster).
--   • Cron QUOTIDIEN 9h (Paris) → Edge Function daily-digest {"kind":"stats"} :
--     pousse un rappel listant les créateurs actifs dont stats_month ≠ mois
--     courant. Au 1er du mois, tout le monde redevient « à mettre à jour » →
--     rappel chaque jour JUSQU'À ce que tout soit coché, puis silence.
--
-- Fuseau : pg_cron tourne en UTC. On déclenche à 7h ET 8h UTC ; la fonction ne
-- garde QUE le passage où il est réellement 9h à Paris (robuste été/hiver).
--
-- Remplace <CRON_SECRET> par le MÊME secret que les autres crons digest.
-- Ne colle jamais le secret dans un fichier versionné : ce dépôt est public.
--
-- À exécuter une fois sur la base live (SQL Editor).
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1) Colonne de suivi « mois où les données ont été mises à jour ».
alter table public.creators add column if not exists stats_month text;

-- 2) Cron QUOTIDIEN — rappel des données créateurs à mettre à jour.
select cron.unschedule('ttp-stats-reminder')
where exists (select 1 from cron.job where jobname = 'ttp-stats-reminder');

select cron.schedule(
  'ttp-stats-reminder',
  '0 7,8 * * *',            -- 7h ET 8h UTC ; la fonction ne garde que 9h Paris
  $$
  select net.http_post(
    url     := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/daily-digest',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <CRON_SECRET>',
      'Content-Type',  'application/json'
    ),
    body    := '{"kind":"stats"}'::jsonb
  );
  $$
);

-- Vérifier :   select jobname, schedule, active from cron.job where jobname = 'ttp-stats-reminder';
-- Test hors créneau (force) depuis un terminal :
--   curl -s -X POST https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/daily-digest \
--     -H "Authorization: Bearer <CRON_SECRET>" -H "Content-Type: application/json" \
--     -d '{"kind":"stats","force":true}'
-- Désactiver : select cron.unschedule('ttp-stats-reminder');
