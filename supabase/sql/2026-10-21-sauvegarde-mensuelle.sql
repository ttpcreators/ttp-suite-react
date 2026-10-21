-- ============================================================================
-- 2026-10-21 : sauvegarde mensuelle envoyée par mail (fonction monthly-backup).
-- Titre Supabase : « Sauvegarde mensuelle par mail »
-- ----------------------------------------------------------------------------
-- 1) Bucket PRIVÉ « backups » : aucune politique d'accès → seul le serveur (clé
--    service) y lit et écrit. Les membres de l'agence ne peuvent pas ouvrir les
--    sauvegardes (elles contiennent les factures, réservées aux fondateurs) ; le
--    lien du mail (30 jours) suffit.
-- 2) Cron « monthly-backup » : le 1er de chaque mois à 6 h UTC (8 h à Paris l'été,
--    7 h l'hiver). Le secret des crons est repris d'un cron existant : rien à coller.
-- Peut être relancé sans risque.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do update set public = false;

do $do$
declare v_secret text;
begin
  select substring(command from 'Bearer ([^'']+)') into v_secret
    from cron.job
   where (jobname = 'ig-sync-quotidien' or jobname = 'tt-sync-quotidien' or command like '%functions/v1/gmail-%') and command like '%Bearer %'
   order by (jobname = 'tt-sync-quotidien') desc, jobid limit 1;
  if v_secret is null or v_secret like 'REMPLACE_MOI%' then
    raise notice 'Secret des crons introuvable : cron monthly-backup NON planifié (voir README).';
    return;
  end if;
  perform cron.unschedule('monthly-backup') where exists (select 1 from cron.job where jobname = 'monthly-backup');
  perform cron.schedule('monthly-backup', '0 6 1 * *', format($cmd$
    select net.http_post(
      url := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/monthly-backup',
      headers := jsonb_build_object('Authorization', 'Bearer %s', 'Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000
    );
  $cmd$, v_secret));
end $do$;

-- Contrôle : le bucket privé et le cron (doit afficher monthly-backup · 0 6 1 * * · true).
select id, public from storage.buckets where id = 'backups';
select jobname, schedule, active from cron.job where jobname = 'monthly-backup';
