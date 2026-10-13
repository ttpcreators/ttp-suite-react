-- ============================================================================
-- Instagram (API officielle de Meta) : chiffres mis à jour tout seuls
-- Titre Supabase : « Instagram · colonnes ig + jetons + cron ig-sync »
-- ============================================================================
-- 1. Colonnes `ig` (jsonb), écrites par la fonction ig-sync :
--    - creators.ig : abonnés, engagement public, rythme, dernier post, relevé
--      quotidien des abonnés, lien « Instagram connecté » et statistiques privées
--      (couverture, vues, audience) si la créatrice a connecté son compte ;
--    - collabs.ig  : publications de la marque repérées chez la créatrice ;
--    - contacts.ig : chiffres Instagram de la marque.
-- 2. Garde-fou : seuls l'agence et le serveur écrivent `ig` (une créatrice ne
--    peut pas gonfler ses chiffres par un appel direct à l'API).
-- 3. Table ig_accounts : jetons Instagram des créatrices qui ont connecté leur
--    compte. AUCUNE politique RLS → illisible depuis l'app (serveur seulement).
-- 4. Cron quotidien ig-sync (5 h 20 UTC = 6 h 20 à Paris en hiver), avec le
--    même secret que les crons Gmail déjà en place (repris tout seul).
-- ============================================================================

-- 1. Colonnes
alter table public.creators add column if not exists ig jsonb;
alter table public.collabs  add column if not exists ig jsonb;
alter table public.contacts add column if not exists ig jsonb;

-- 2. Garde-fou (invoker : current_user = rôle réel de l'appelant)
create or replace function public.ig_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if public.is_agency()
     or coalesce(auth.role(), '') = 'service_role'
     or current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.ig := null;
  else
    new.ig := old.ig;
  end if;
  return new;
end $$;
drop trigger if exists creators_ig_guard on public.creators;
create trigger creators_ig_guard before insert or update on public.creators
  for each row execute function public.ig_guard();
drop trigger if exists contacts_ig_guard on public.contacts;
create trigger contacts_ig_guard before insert or update on public.contacts
  for each row execute function public.ig_guard();
-- (collabs : écriture déjà réservée à l'agence, audit 2026-10-01.)

-- 3. Jetons Instagram des créatrices
create table if not exists public.ig_accounts (
  creator_id   uuid primary key references public.creators(id) on delete cascade,
  ig_user_id   text not null,
  username     text,
  token        text not null,          -- jeton longue durée (60 j), prolongé par ig-sync
  expires_at   timestamptz,
  scopes       text,
  connected_at timestamptz default now(),
  refreshed_at timestamptz
);
alter table public.ig_accounts enable row level security;
revoke all on public.ig_accounts from anon, authenticated;

-- 4. Cron quotidien. Le secret est repris du cron gmail-reconcile déjà en place
--    (même CRON_SECRET) : rien à copier à la main, et il n'apparaît pas dans Git.
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $do$
declare v_secret text;
begin
  select substring(command from 'Bearer ([^'']+)') into v_secret
    from cron.job
   where command like '%functions/v1/gmail-%' and command like '%Bearer %'
   order by jobid limit 1;
  if v_secret is null or v_secret like 'REMPLACE_MOI%' then
    raise notice 'Secret des crons Gmail introuvable : cron ig-sync NON planifié (voir README).';
    return;
  end if;
  perform cron.unschedule('ig-sync-quotidien') where exists (select 1 from cron.job where jobname = 'ig-sync-quotidien');
  perform cron.schedule('ig-sync-quotidien', '20 5 * * *', format($cmd$
    select net.http_post(
      url := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-sync',
      headers := jsonb_build_object('Authorization', 'Bearer %s', 'Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000
    );
  $cmd$, v_secret));
end $do$;
