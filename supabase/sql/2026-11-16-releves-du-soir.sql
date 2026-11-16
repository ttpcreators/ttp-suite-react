-- TITRE : TTP Suite · Relevés Instagram, TikTok et YouTube du soir (2026-11-16)
-- ============================================================================
-- Demande de Marc : une tournée de relevés le matin ET le soir, pour qu'Alfred soit à jour
-- partout. Le matin existe déjà (ig-sync 5 h 20, tt-sync 6 h, yt-sync 6 h 15 UTC). On
-- ajoute le soir, en heures UTC, fini avant le point de 17 h d'Alfred toute l'année :
--   ig-sync 14 h 30, tt-sync 14 h 45, yt-sync 14 h 50 UTC
--   (15 h 30 à 15 h 50 à Paris en hiver, 16 h 30 à 16 h 50 en été).
-- Sans risque de doublon : l'historique des abonnés garde un point par jour, la mesure
-- d'engagement automatique une par mois et par réseau.
-- Le secret est repris des crons déjà en place (même CRON_SECRET) : rien à copier à la
-- main, et il n'apparaît pas dans Git. Relançable.
-- ============================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $do$
declare
  v_secret text;
  v_job record;
begin
  select substring(command from 'Bearer ([^'']+)') into v_secret
    from cron.job
   where command like '%functions/v1/ig-sync%' and command like '%Bearer %'
   order by jobid limit 1;
  if v_secret is null or v_secret like 'REMPLACE_MOI%' then
    raise notice 'Secret du cron ig-sync introuvable : relevés du soir NON planifiés (voir supabase/sql/README.md).';
    return;
  end if;
  for v_job in select * from (values
      ('ig-sync-soir', '30 14 * * *', 'ig-sync'),
      ('tt-sync-soir', '45 14 * * *', 'tt-sync'),
      ('yt-sync-soir', '50 14 * * *', 'yt-sync')
    ) as t(nom, horaire, fonction)
  loop
    perform cron.unschedule(v_job.nom) where exists (select 1 from cron.job where jobname = v_job.nom);
    perform cron.schedule(v_job.nom, v_job.horaire, format($cmd$
      select net.http_post(
        url := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/%s',
        headers := jsonb_build_object('Authorization', 'Bearer %s', 'Content-Type', 'application/json'),
        body := '{}'::jsonb,
        timeout_milliseconds := 150000
      );
    $cmd$, v_job.fonction, v_secret));
  end loop;
end $do$;

-- Contrôle : 6 lignes attendues (les 3 du matin et les 3 du soir).
select jobname, schedule from cron.job
 where jobname in ('ig-sync-quotidien', 'tt-sync-quotidien', 'yt-sync-quotidien', 'ig-sync-soir', 'tt-sync-soir', 'yt-sync-soir')
 order by schedule;
