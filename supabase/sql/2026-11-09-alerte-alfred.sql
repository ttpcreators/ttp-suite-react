-- TITRE : TTP Suite · Alerte si Alfred ne répond plus (2026-11-09)
-- ============================================================================
-- Cron « agent-watchdog » : du lundi au vendredi, à 9 h 40 et 10 h 40 UTC (10 h 40 et
-- 11 h 40 à Paris l'hiver, 11 h 40 et 12 h 40 l'été). La fonction agent-watchdog regarde
-- si Alfred a écrit au journal des agents ce matin depuis 8 h 45 ; sinon, elle envoie
-- une notification aux fondateurs (une seule par jour). Le secret des crons est repris
-- d'un cron existant : rien à coller. Peut être relancé sans risque.
-- ============================================================================

do $do$
declare v_secret text;
begin
  select substring(command from 'Bearer ([^'']+)') into v_secret
    from cron.job
   where (jobname = 'ig-sync-quotidien' or jobname = 'tt-sync-quotidien' or command like '%functions/v1/gmail-%') and command like '%Bearer %'
   order by (jobname = 'tt-sync-quotidien') desc, jobid limit 1;
  if v_secret is null or v_secret like 'REMPLACE_MOI%' then
    raise notice 'Secret des crons introuvable : cron agent-watchdog NON planifié.';
    return;
  end if;
  perform cron.unschedule('agent-watchdog') where exists (select 1 from cron.job where jobname = 'agent-watchdog');
  perform cron.schedule('agent-watchdog', '40 9,10 * * 1-5', format($cmd$
    select net.http_post(
      url := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/agent-watchdog',
      headers := jsonb_build_object('Authorization', 'Bearer %s', 'Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cmd$, v_secret));
end $do$;

-- Contrôle : doit afficher agent-watchdog · 40 9,10 * * 1-5 · true.
select jobname, schedule, active from cron.job where jobname = 'agent-watchdog';
