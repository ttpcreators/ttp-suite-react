-- ============================================================================
-- 2026-11-27 · Vague 1 : ménage des tâches planifiées (pg_cron)
-- Titre Supabase : « Crons : purge, import fini, délais »
-- ----------------------------------------------------------------------------
-- Pourquoi (audit du 27/11, points P9, A14, P10) :
--   • l'historique des crons (cron.job_run_details) n'est jamais purgé : 120 000 lignes,
--     près de 100 Mo, 40 % de la base, environ 4 000 lignes de plus par jour ;
--   • l'import de l'historique des DM Instagram est fini (ig_sync_state, clé
--     inbox_historique, termine = true), mais son job ig-historique-import tourne encore
--     toutes les 3 minutes, à vide ;
--   • 9 jobs appellent une fonction sans délai réglé : pg_net coupe la réponse à 5 s
--     (google-sync dure environ 40 s) et les vrais délais dépassés se perdent dans les faux.
--
-- Quoi :
--   1) Job purge-historique-cron, chaque nuit à 3 h 30 (heure UTC) : efface l'historique
--      des crons de plus de 7 jours. La première purge a lieu la nuit suivante. La place
--      libérée est réutilisée (la base ne rétrécit pas sans VACUUM FULL, facultatif).
--   2) ig-historique-import : mis en pause (active = false), seulement si l'import est fini.
--      Le job n'est pas supprimé : pour relancer un import, le remettre en route avec
--        select cron.alter_job(jobid, active := true) from cron.job where jobname = 'ig-historique-import';
--   3) Délai de 120 s (timeout_milliseconds := 120000) ajouté aux appels qui n'en ont pas :
--      google-watch-renew, google-sync-hourly, gmail-poll-5min, ttp-daily-digest,
--      ttp-weekly-digest, ttp-afternoon-digest, ttp-stats-reminder, gmail-reconcile-1h,
--      envoi-file-minute. La commande de chaque job est modifiée sur place (regexp_replace) :
--      le secret des crons n'est ni écrit ici, ni affiché. Un délai plus long ne fait
--      jamais renvoyer une requête (pg_net n'essaie qu'une fois).
--   Pas ici : la sauvegarde ig_radar_sauvegarde_20261125 reste (retour arrière du ménage du
--   radar, étape 3 en attente du « oui » de Gianni).
--
-- Contrôle : la requête à la fin. Attendu : 1 · 0 · 0
-- Relançable sans risque : le job de purge est remplacé par son nom, la pause et les
-- délais ne touchent que les jobs qui ne les ont pas encore.
-- Pas dans SETUP.sql (réglage des tâches planifiées de la prod).
-- ============================================================================

-- 1) Purge quotidienne de l'historique des crons ------------------------------------------
select cron.schedule('purge-historique-cron', '30 3 * * *',
  $$delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval '7 days'$$);

-- 2) Import de l'historique des DM fini : son job est mis en pause -------------------------
select j.jobid, j.jobname, cron.alter_job(j.jobid, active := false) as en_pause
  from cron.job j
 where j.jobname = 'ig-historique-import' and j.active
   and exists (select 1 from public.ig_sync_state s
                where s.key = 'inbox_historique' and coalesce((s.data->>'termine')::boolean, false));

-- 3) Délai de 120 s pour les appels sans délai réglé ---------------------------------------
-- Le motif « ::jsonb ) » ferme une seule fois chaque commande visée (vérifié le 27/11) ;
-- une commande où il n'apparaît pas exactement une fois n'est pas touchée.
select j.jobid, j.jobname,
       cron.alter_job(j.jobid, command := regexp_replace(j.command, '::jsonb\s*\)', '::jsonb, timeout_milliseconds := 120000)')) as delai_pose
  from cron.job j
 where j.jobname in ('google-watch-renew', 'google-sync-hourly', 'gmail-poll-5min', 'ttp-daily-digest',
                     'ttp-weekly-digest', 'ttp-afternoon-digest', 'ttp-stats-reminder', 'gmail-reconcile-1h',
                     'envoi-file-minute')
   and j.command ilike '%net.http_post%'
   and j.command not ilike '%timeout_milliseconds%'
   and (select count(*) from regexp_matches(j.command, '::jsonb\s*\)', 'g')) = 1;

-- Contrôle (une ligne). Attendu : 1 · 0 · 0
-- (purge en place · import en route alors qu'il est fini · appels http sans délai)
select
  (select count(*) from cron.job where jobname = 'purge-historique-cron' and active) as purge,
  (select count(*) from cron.job j where j.jobname = 'ig-historique-import' and j.active
     and exists (select 1 from public.ig_sync_state s
                  where s.key = 'inbox_historique' and coalesce((s.data->>'termine')::boolean, false))) as import_fini_actif,
  (select count(*) from cron.job where command ilike '%net.http_post%'
     and command not ilike '%timeout_milliseconds%') as appels_sans_delai;
