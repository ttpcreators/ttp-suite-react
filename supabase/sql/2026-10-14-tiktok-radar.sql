-- ============================================================================
-- TikTok · Radar à collabs (contenus sponsorisés en France)
-- Titre Supabase : « TikTok · radar à collabs (tt_commercial, tt_brand_status, cron) »
-- ============================================================================
-- Source : API officielle « Commercial Content » de TikTok (bibliothèque de
-- transparence européenne) : chaque vidéo marquée « partenariat rémunéré » par une
-- créatrice en France, avec les marques qui la paient. Récupérée chaque jour par la
-- fonction tt-radar (accès accordé par TikTok sur demande).
-- 1. tt_commercial : un contenu sponsorisé = une ligne (créatrice, marques, vidéo).
--    Lecture agence, écriture serveur. Gardé 13 mois (comme la bibliothèque TikTok).
-- 2. tt_brand_status : ce que l'agence a décidé pour une marque (à traiter,
--    pas pertinente, ajoutée au Pipeline). Lecture et écriture agence.
-- 3. Cron quotidien tt-radar (7 h UTC), même secret que ig-sync (repris tout seul).
-- ============================================================================

create table if not exists public.tt_commercial (
  id         text primary key,                 -- id du contenu chez TikTok
  created    date,                             -- date de publication
  label      text,                             -- « Paid partnership »…
  brands     text[] not null default '{}',     -- marques qui paient
  creator    text,                             -- @ TikTok de la créatrice (minuscules)
  video_url  text,
  cover      text,
  country    text not null default 'FR',
  fetched_at timestamptz not null default now()
);
create index if not exists tt_commercial_created_idx on public.tt_commercial (created desc);
create index if not exists tt_commercial_creator_idx on public.tt_commercial (creator);
create table if not exists public.tt_brand_status (
  brand  text primary key,                     -- nom de marque en minuscules, sans accents
  status text not null default 'nouveau' check (status in ('nouveau', 'ignore', 'pipeline')),
  at     timestamptz not null default now()
);
alter table public.tt_commercial   enable row level security;
alter table public.tt_brand_status enable row level security;
revoke all on public.tt_commercial   from anon;
revoke all on public.tt_brand_status from anon;
drop policy if exists tt_commercial_agency_read on public.tt_commercial;
create policy tt_commercial_agency_read on public.tt_commercial for select to authenticated using (public.is_agency());
drop policy if exists tt_brand_status_agency on public.tt_brand_status;
create policy tt_brand_status_agency on public.tt_brand_status for all to authenticated
  using (public.is_agency()) with check (public.is_agency());

do $do$
declare v_secret text;
begin
  select substring(command from 'Bearer ([^'']+)') into v_secret
    from cron.job
   where (jobname = 'ig-sync-quotidien' or command like '%functions/v1/gmail-%') and command like '%Bearer %'
   order by (jobname = 'ig-sync-quotidien') desc, jobid limit 1;
  if v_secret is null or v_secret like 'REMPLACE_MOI%' then
    raise notice 'Secret des crons introuvable : cron tt-radar NON planifié (voir README).';
    return;
  end if;
  perform cron.unschedule('tt-radar-quotidien') where exists (select 1 from cron.job where jobname = 'tt-radar-quotidien');
  perform cron.schedule('tt-radar-quotidien', '0 7 * * *', format($cmd$
    select net.http_post(
      url := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/tt-radar',
      headers := jsonb_build_object('Authorization', 'Bearer %s', 'Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000
    );
  $cmd$, v_secret));
end $do$;
select jobname, schedule, active from cron.job where jobname like 'tt-%' order by jobname;
