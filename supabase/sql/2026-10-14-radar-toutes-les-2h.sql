-- ============================================================================
-- Radar à marques : un petit passage toutes les 2 heures (au lieu d'un la nuit)
-- Titre Supabase : « Instagram · radar toutes les 2 h »
-- ============================================================================
-- Le quota Meta se compte sur une heure glissante : de petits passages répartis
-- sur la journée lisent environ 10 fois plus de créatrices et de marques par jour,
-- sans jamais bloquer. Chaque passage s'arrête à 60 % du quota (body "quota":60)
-- pour laisser de la marge aux recherches faites dans l'app.
-- Secret repris tout seul de la tâche ig-sync-quotidien (rien à copier).
-- ============================================================================
do $do$
declare v_secret text;
begin
  select substring(command from 'Bearer ([^'']+)') into v_secret
    from cron.job
   where (jobname = 'ig-sync-quotidien' or command like '%functions/v1/gmail-%') and command like '%Bearer %'
   order by (jobname = 'ig-sync-quotidien') desc, jobid limit 1;
  if v_secret is null or v_secret like 'REMPLACE_MOI%' then
    raise notice 'Secret des crons introuvable : rien changé.';
    return;
  end if;
  perform cron.unschedule('ig-sourcing-quotidien') where exists (select 1 from cron.job where jobname = 'ig-sourcing-quotidien');
  perform cron.unschedule('ig-sourcing-2h') where exists (select 1 from cron.job where jobname = 'ig-sourcing-2h');
  perform cron.schedule('ig-sourcing-2h', '40 */2 * * *', format($cmd$
    select net.http_post(
      url := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-sourcing',
      headers := jsonb_build_object('Authorization', 'Bearer %s', 'Content-Type', 'application/json'),
      body := '{"mode":"scan","quota":60}'::jsonb,
      timeout_milliseconds := 150000
    );
  $cmd$, v_secret));
end $do$;
select jobname, schedule, active from cron.job where jobname like 'ig-%' order by jobname;
