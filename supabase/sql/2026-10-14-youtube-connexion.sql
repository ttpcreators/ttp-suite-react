-- ============================================================================
-- YouTube · « Connecter mon YouTube » (créatrices du roster)
-- Titre Supabase : « YouTube · connexion créatrices (yt_accounts, creators.yt, cron) »
-- ============================================================================
-- 1. yt_accounts : jetons Google des créatrices qui ont connecté leur chaîne
--    (yt-connect / yt-callback), lecture seule (youtube.readonly + yt-analytics.readonly).
--    AUCUNE politique : illisible depuis l'app.
-- 2. creators.yt : chiffres YouTube (abonnés, vues 30 j, temps de visionnage, vues
--    moyennes des dernières vidéos, audience âge / sexe / pays), écrits par yt-sync.
--    Même garde que creators.ig / creators.tt (agence et serveur seulement).
-- 3. collabs.yt : vidéos YouTube de la créatrice qui citent la marque (yt-sync), comme collabs.tt.
-- 4. Cron quotidien yt-sync (6 h 15 UTC), même secret que ig-sync (repris tout seul).
-- ============================================================================

create table if not exists public.yt_accounts (
  creator_id    uuid primary key references public.creators(id) on delete cascade,
  channel_id    text not null,
  title         text,
  token         text,
  expires_at    timestamptz,
  refresh_token text not null,
  scopes        text,
  connected_at  timestamptz default now(),
  refreshed_at  timestamptz
);
alter table public.yt_accounts enable row level security;
revoke all on public.yt_accounts from anon, authenticated;

alter table public.creators add column if not exists yt jsonb;

alter table public.collabs add column if not exists yt jsonb;

create or replace function public.yt_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if public.is_agency()
     or coalesce(auth.role(), '') = 'service_role'
     or current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.yt := null;
  else
    new.yt := old.yt;
  end if;
  return new;
end $$;
drop trigger if exists creators_yt_guard on public.creators;
create trigger creators_yt_guard before insert or update on public.creators
  for each row execute function public.yt_guard();

do $do$
declare v_secret text;
begin
  select substring(command from 'Bearer ([^'']+)') into v_secret
    from cron.job
   where (jobname = 'ig-sync-quotidien' or command like '%functions/v1/gmail-%') and command like '%Bearer %'
   order by (jobname = 'ig-sync-quotidien') desc, jobid limit 1;
  if v_secret is null or v_secret like 'REMPLACE_MOI%' then
    raise notice 'Secret des crons introuvable : cron yt-sync NON planifié (voir README).';
    return;
  end if;
  perform cron.unschedule('yt-sync-quotidien') where exists (select 1 from cron.job where jobname = 'yt-sync-quotidien');
  perform cron.schedule('yt-sync-quotidien', '15 6 * * *', format($cmd$
    select net.http_post(
      url := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/yt-sync',
      headers := jsonb_build_object('Authorization', 'Bearer %s', 'Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000
    );
  $cmd$, v_secret));
end $do$;
select jobname, schedule, active from cron.job where jobname like 'yt-%' order by jobname;
