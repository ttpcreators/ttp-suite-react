-- ============================================================================
-- 06-crons-resume-matin-semaine.sql
-- ----------------------------------------------------------------------------
-- Résumés poussés (Web Push) via pg_cron + pg_net, appelant l'Edge Function
-- `daily-digest` :
--   • QUOTIDIEN  : chaque matin à 8h (Paris) — tâches/échéances/évènements du jour.
--   • HEBDO      : chaque lundi à 8h (Paris) — tâches & évènements de la semaine.
--
-- Fuseau : pg_cron tourne en UTC. On déclenche à 6h ET 7h UTC ; la fonction ne
-- garde QUE le passage où il est réellement 8h à Paris → 8h pile toute l'année,
-- sans rien changer au passage été/hiver.
--
-- Remplace <CRON_SECRET> par le MÊME secret que le digest actuel (celui déjà en
-- place pour google-sync / ttp-daily-digest). Ne colle jamais le secret dans un
-- fichier versionné : ce dépôt est public.
--
-- À exécuter une fois sur la base live (SQL Editor).
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1) QUOTIDIEN — recale l'ancien digest (était 06h30 UTC ≈ 8h30) sur 8h pile.
select cron.unschedule('ttp-daily-digest')
where exists (select 1 from cron.job where jobname = 'ttp-daily-digest');

select cron.schedule(
  'ttp-daily-digest',
  '0 6,7 * * *',            -- 6h ET 7h UTC ; la fonction ne garde que 8h Paris
  $$
  select net.http_post(
    url     := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/daily-digest',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <CRON_SECRET>',
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- 2) HEBDO — chaque lundi. body {"kind":"weekly"} → résumé de la semaine.
select cron.unschedule('ttp-weekly-digest')
where exists (select 1 from cron.job where jobname = 'ttp-weekly-digest');

select cron.schedule(
  'ttp-weekly-digest',
  '0 6,7 * * 1',            -- lundi, 6h ET 7h UTC ; la fonction ne garde que 8h Paris
  $$
  select net.http_post(
    url     := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/daily-digest',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <CRON_SECRET>',
      'Content-Type',  'application/json'
    ),
    body    := '{"kind":"weekly"}'::jsonb
  );
  $$
);

-- 3) MI-JOURNÉE — chaque jour à 14h. body {"kind":"afternoon"} → ce qu'il reste.
select cron.unschedule('ttp-afternoon-digest')
where exists (select 1 from cron.job where jobname = 'ttp-afternoon-digest');

select cron.schedule(
  'ttp-afternoon-digest',
  '0 12,13 * * *',         -- 12h ET 13h UTC ; la fonction ne garde que 14h Paris
  $$
  select net.http_post(
    url     := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/daily-digest',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <CRON_SECRET>',
      'Content-Type',  'application/json'
    ),
    body    := '{"kind":"afternoon"}'::jsonb
  );
  $$
);

-- Vérifier :   select jobname, schedule, active from cron.job where jobname like 'ttp-%digest';
-- Désactiver : select cron.unschedule('ttp-weekly-digest');
