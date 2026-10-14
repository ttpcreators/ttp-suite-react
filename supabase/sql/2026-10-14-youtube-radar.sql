-- ============================================================================
-- YouTube · Radar à collabs (vidéos sponsorisées / placements de produit)
-- Titre Supabase : « YouTube · radar à collabs (yt_radar, cron) »
-- ============================================================================
-- yt-radar lit chaque jour, avec l'outil officiel de Google (YouTube Data API) :
--   • les dernières vidéos des chaînes du roster et du Scouting ;
--   • des vidéos récentes en France trouvées par des recherches « code promo »,
--     « partenariat », « sponsorisé »… (créatrices hors agence).
-- Une vidéo est sponsorisée si la créatrice a coché « communication commerciale »
-- (indicateur officiel de YouTube) ou si sa description le dit (#ad, code promo…).
-- Marques = domaines des liens, @ cités, noms après « sponsorisé par / merci à… ».
-- yt_radar : une marque = une ligne, avec ses vidéos. Lecture agence ; l'agence
-- change seulement le statut (à traiter / pas pertinente / Pipeline).
-- Cron quotidien 7 h 30 UTC, même secret que ig-sync (repris tout seul).
-- ============================================================================

create table if not exists public.yt_radar (
  brand      text primary key,                -- clé de marque (minuscules, sans ponctuation)
  name       text not null,                   -- nom affiché
  posts      jsonb not null default '[]'::jsonb,
  status     text not null default 'nouveau' check (status in ('nouveau', 'ignore', 'pipeline')),
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);
alter table public.yt_radar enable row level security;
revoke all on public.yt_radar from anon;
drop policy if exists yt_radar_agency_read on public.yt_radar;
create policy yt_radar_agency_read on public.yt_radar for select to authenticated using (public.is_agency());
drop policy if exists yt_radar_agency_update on public.yt_radar;
create policy yt_radar_agency_update on public.yt_radar for update to authenticated
  using (public.is_agency()) with check (public.is_agency());

do $do$
declare v_secret text;
begin
  select substring(command from 'Bearer ([^'']+)') into v_secret
    from cron.job
   where (jobname = 'ig-sync-quotidien' or command like '%functions/v1/gmail-%') and command like '%Bearer %'
   order by (jobname = 'ig-sync-quotidien') desc, jobid limit 1;
  if v_secret is null or v_secret like 'REMPLACE_MOI%' then
    raise notice 'Secret des crons introuvable : cron yt-radar NON planifié (voir README).';
    return;
  end if;
  perform cron.unschedule('yt-radar-quotidien') where exists (select 1 from cron.job where jobname = 'yt-radar-quotidien');
  perform cron.schedule('yt-radar-quotidien', '30 7 * * *', format($cmd$
    select net.http_post(
      url := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/yt-radar',
      headers := jsonb_build_object('Authorization', 'Bearer %s', 'Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000
    );
  $cmd$, v_secret));
end $do$;
select jobname, schedule, active from cron.job where jobname like 'yt-%' order by jobname;
