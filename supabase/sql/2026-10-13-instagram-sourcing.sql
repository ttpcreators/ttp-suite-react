-- ============================================================================
-- Instagram · Sourcing + Radar à marques (page Sourcing)
-- Titre Supabase : « Instagram · Sourcing + Radar (ig_profiles, ig_radar, cron) »
-- ============================================================================
-- 1. ig_profiles : profils Instagram déjà lus par la fonction ig-sourcing (abonnés,
--    engagement, rythme, bio, site, email de la bio, « est-ce une marque ? »),
--    gardés 7 jours pour ne pas redemander à Meta. Écrits par le serveur seulement.
-- 2. ig_radar : marques citées dans les posts des créatrices (roster + Scouting),
--    avec les posts (payés ou non). L'agence peut seulement changer le statut
--    (nouveau / ignorée / ajoutée au pipeline).
-- 3. Cron quotidien ig-sourcing (5 h 40 UTC), même secret que ig-sync (repris tout seul).
-- Rien de visible par les créatrices.
-- ============================================================================

create table if not exists public.ig_profiles (
  username   text primary key,          -- @ en minuscules
  data       jsonb,                     -- chiffres du profil (voir ig-sourcing/toData)
  why        text,                      -- raison si introuvable (compte_perso…), null = trouvé
  scanned_at timestamptz,               -- dernier passage du radar sur ses posts
  at         timestamptz not null default now()
);
create table if not exists public.ig_radar (
  brand      text primary key,          -- @ de la marque, minuscules
  posts      jsonb not null default '[]'::jsonb,
  status     text not null default 'nouveau' check (status in ('nouveau', 'ignore', 'pipeline')),
  first_seen timestamptz default now(),
  last_seen  timestamptz default now()
);
alter table public.ig_profiles enable row level security;
alter table public.ig_radar    enable row level security;
revoke all on public.ig_profiles from anon;
revoke all on public.ig_radar    from anon;
drop policy if exists ig_profiles_agency_read on public.ig_profiles;
create policy ig_profiles_agency_read on public.ig_profiles for select to authenticated using (public.is_agency());
drop policy if exists ig_radar_agency_read on public.ig_radar;
create policy ig_radar_agency_read on public.ig_radar for select to authenticated using (public.is_agency());
drop policy if exists ig_radar_agency_update on public.ig_radar;
create policy ig_radar_agency_update on public.ig_radar for update to authenticated
  using (public.is_agency()) with check (public.is_agency());

-- Cron : même secret que la tâche ig-sync-quotidien (ou les crons Gmail).
do $do$
declare v_secret text;
begin
  select substring(command from 'Bearer ([^'']+)') into v_secret
    from cron.job
   where (jobname = 'ig-sync-quotidien' or command like '%functions/v1/gmail-%') and command like '%Bearer %'
   order by (jobname = 'ig-sync-quotidien') desc, jobid limit 1;
  if v_secret is null or v_secret like 'REMPLACE_MOI%' then
    raise notice 'Secret des crons introuvable : cron ig-sourcing NON planifié (voir README).';
    return;
  end if;
  perform cron.unschedule('ig-sourcing-quotidien') where exists (select 1 from cron.job where jobname = 'ig-sourcing-quotidien');
  perform cron.schedule('ig-sourcing-quotidien', '40 5 * * *', format($cmd$
    select net.http_post(
      url := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-sourcing',
      headers := jsonb_build_object('Authorization', 'Bearer %s', 'Content-Type', 'application/json'),
      body := '{"mode":"scan"}'::jsonb,
      timeout_milliseconds := 150000
    );
  $cmd$, v_secret));
end $do$;
select jobname, schedule, active from cron.job where jobname like 'ig-%' order by jobname;
