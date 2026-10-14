-- ============================================================================
-- TikTok · « Connecter mon TikTok » (créatrices du roster)
-- Titre Supabase : « TikTok · connexion créatrices (tt_accounts, creators.tt, cron) »
-- ============================================================================
-- 1. tt_accounts : jetons TikTok des créatrices qui ont connecté leur compte
--    (tt-connect / tt-callback). AUCUNE politique : illisible depuis l'app.
-- 2. creators.tt : chiffres TikTok du jour (abonnés, j'aime, vidéos, vues moyennes,
--    engagement, 12 dernières vidéos), écrits par tt-sync. Protégés comme
--    creators.ig : seuls l'agence et le serveur peuvent les écrire.
-- 3. collabs.tt : vidéos TikTok de la créatrice qui citent la marque (vues, j'aime…).
-- 4. Cron quotidien tt-sync (6 h UTC), même secret que ig-sync (repris tout seul).
-- ============================================================================

create table if not exists public.tt_accounts (
  creator_id         uuid primary key references public.creators(id) on delete cascade,
  open_id            text not null,
  username           text,
  token              text not null,
  expires_at         timestamptz,
  refresh_token      text,
  refresh_expires_at timestamptz,
  scopes             text,
  connected_at       timestamptz default now(),
  refreshed_at       timestamptz
);
alter table public.tt_accounts enable row level security;
revoke all on public.tt_accounts from anon, authenticated;

alter table public.creators add column if not exists tt jsonb;
alter table public.collabs  add column if not exists tt jsonb;

-- Même garde que creators.ig : une créatrice ne peut pas écrire ses propres chiffres.
create or replace function public.tt_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if public.is_agency()
     or coalesce(auth.role(), '') = 'service_role'
     or current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.tt := null;
  else
    new.tt := old.tt;
  end if;
  return new;
end $$;
drop trigger if exists creators_tt_guard on public.creators;
create trigger creators_tt_guard before insert or update on public.creators
  for each row execute function public.tt_guard();

do $do$
declare v_secret text;
begin
  select substring(command from 'Bearer ([^'']+)') into v_secret
    from cron.job
   where (jobname = 'ig-sync-quotidien' or command like '%functions/v1/gmail-%') and command like '%Bearer %'
   order by (jobname = 'ig-sync-quotidien') desc, jobid limit 1;
  if v_secret is null or v_secret like 'REMPLACE_MOI%' then
    raise notice 'Secret des crons introuvable : cron tt-sync NON planifié (voir README).';
    return;
  end if;
  perform cron.unschedule('tt-sync-quotidien') where exists (select 1 from cron.job where jobname = 'tt-sync-quotidien');
  perform cron.schedule('tt-sync-quotidien', '0 6 * * *', format($cmd$
    select net.http_post(
      url := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/tt-sync',
      headers := jsonb_build_object('Authorization', 'Bearer %s', 'Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000
    );
  $cmd$, v_secret));
end $do$;
select jobname, schedule, active from cron.job where jobname like 'tt-%' or jobname like 'ig-%' order by jobname;
