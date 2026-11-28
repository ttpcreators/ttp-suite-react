-- ============================================================================
-- Base de créateurs façon Kolsquare (2026-11-16, demandé par Marc)
-- ----------------------------------------------------------------------------
-- La base, ce sont les profils déjà lus par l'agence (ig_profiles : radars, promenade
-- Instagram, Scouting, veille des agences), qui ne s'effacent pas. Cette migration ajoute :
--   1. creator_base_meta : niche et ville corrigées à la main, note, et le RETRAIT (RGPD :
--      un créateur qui le demande n'apparaît plus dans la base ni dans aucune liste) ;
--   2. ig_profile_history : un point par jour (abonnés, engagement) pour suivre l'évolution,
--      rempli tout seul par un trigger quand ig_profiles est mis à jour ;
--   3. creator_lists : des sélections à montrer aux marques (« 10 créatrices running Lyon ») ;
--   4. public_creator_lists : la vue anonyme lue par ttpcreators.pro/selection/ ; seulement les
--      listes publiques, seulement des chiffres publics (jamais d'email, de bio ni de note).
-- Relançable sans risque. Contrôle en fin de fichier.
-- APRÈS UNE RELANCE : relancer ensuite 2026-11-28-listes-par-lien.sql (ce fichier redonne
-- à anon la lecture directe de la vue public_creator_lists, que le fichier du 28/11 retire).
-- ============================================================================

-- 1) Niche, ville, note et retrait ------------------------------------------------
create table if not exists public.creator_base_meta (
  username   text primary key check (username ~ '^[a-z0-9._]{1,30}$'),
  niche      text,
  ville      text,
  note       text,
  excluded   boolean not null default false,  -- retiré à sa demande : caché partout
  updated_at timestamptz not null default now()
);
alter table public.creator_base_meta enable row level security;
revoke all on public.creator_base_meta from anon;
drop policy if exists creator_base_meta_agency on public.creator_base_meta;
create policy creator_base_meta_agency on public.creator_base_meta for all to authenticated
  using (public.is_agency()) with check (public.is_agency());

-- 2) Historique des chiffres -------------------------------------------------------
create table if not exists public.ig_profile_history (
  username  text not null,
  d         date not null default current_date,
  followers int,
  er        numeric,
  primary key (username, d)
);
alter table public.ig_profile_history enable row level security;
revoke all on public.ig_profile_history from anon;
drop policy if exists ig_profile_history_agency_read on public.ig_profile_history;
create policy ig_profile_history_agency_read on public.ig_profile_history for select to authenticated
  using (public.is_agency());
drop policy if exists ig_profile_history_agency_delete on public.ig_profile_history;
create policy ig_profile_history_agency_delete on public.ig_profile_history for delete to authenticated
  using (public.is_agency());

create or replace function public.ig_profiles_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.data is not null and new.data ? 'followers'
     and coalesce((new.data->>'isBrand')::boolean, false) = false
     and not exists (select 1 from public.creator_base_meta m where m.username = new.username and m.excluded) then
    insert into public.ig_profile_history (username, d, followers, er)
    values (new.username, current_date,
            nullif(new.data->>'followers', '')::numeric::int,
            nullif(new.data->>'er', '')::numeric)
    on conflict (username, d) do update set followers = excluded.followers, er = excluded.er;
  end if;
  return new;
exception when others then
  return new;  -- l'historique ne doit jamais bloquer la lecture d'un profil
end $$;
drop trigger if exists ig_profiles_history on public.ig_profiles;
create trigger ig_profiles_history after insert or update of data on public.ig_profiles
  for each row execute function public.ig_profiles_history();

-- Premier point : aujourd'hui, pour tous les profils déjà lus.
insert into public.ig_profile_history (username, d, followers, er)
select username, current_date, nullif(data->>'followers', '')::numeric::int, nullif(data->>'er', '')::numeric
from public.ig_profiles
where data ? 'followers' and coalesce((data->>'isBrand')::boolean, false) = false
on conflict (username, d) do nothing;

-- 3) Listes pour les marques -------------------------------------------------------
create table if not exists public.creator_lists (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  title      text not null,
  brand      text,
  intro      text,
  usernames  text[] not null default '{}',
  public     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.creator_lists enable row level security;
revoke all on public.creator_lists from anon;
drop policy if exists creator_lists_agency on public.creator_lists;
create policy creator_lists_agency on public.creator_lists for all to authenticated
  using (public.is_agency()) with check (public.is_agency());

-- 4) Vue publique des listes (site) ---------------------------------------------------
create or replace view public.public_creator_lists
with (security_invoker = false) as
  select l.slug, l.title, l.brand, l.intro, l.updated_at,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'username',  p.username,
                    'name',      p.data->>'name',
                    'followers', nullif(p.data->>'followers', '')::numeric,
                    'er',        nullif(p.data->>'er', '')::numeric,
                    'perWeek',   nullif(p.data->>'perWeek', '')::numeric,
                    'picture',   p.data->>'picture',
                    'niche',     m.niche,
                    'ville',     m.ville)
                  order by array_position(l.usernames, p.username))
           from public.ig_profiles p
           left join public.creator_base_meta m on m.username = p.username
           where p.username = any(l.usernames) and coalesce(m.excluded, false) = false
         ), '[]'::jsonb) as creators
  from public.creator_lists l
  where l.public;
grant select on public.public_creator_lists to anon, authenticated;
revoke insert, update, delete, truncate on public.public_creator_lists from anon, authenticated, public;

-- Contrôle : 3 tables, le trigger, la vue, et le nombre de profils dans l'historique.
select
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('creator_base_meta', 'ig_profile_history', 'creator_lists')) as tables_3,
  (select count(*) from pg_trigger where tgname = 'ig_profiles_history') as trigger_1,
  (select count(*) from information_schema.views where table_schema = 'public' and table_name = 'public_creator_lists') as vue_1,
  (select count(*) from public.ig_profile_history) as points_historique;
