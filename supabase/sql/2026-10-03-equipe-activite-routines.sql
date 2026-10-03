-- ════════════════════════════════════════════════════════════════════════════
-- Équipe agence (2026-10-03) : qui fait quoi, tâches hebdomadaires, propriétaires.
-- Idempotent : peut être relancé sans risque. À lancer dans le SQL Editor.
--
--   1) To-do : date et auteur du « Fait » (todos.done_at / done_by).
--   2) To-do « Chaque semaine » : table todo_routines (+ historique des « Fait »).
--   3) Prénom affiché de chaque compte agence (profiles.display_name) + fonctions
--      set_my_display_name() et agency_accounts() (liste réelle des comptes agence).
--   4) Journal de l'équipe : table agency_activity, remplie PAR LA BASE (déclencheur)
--      à chaque ajout / « Fait » / mise à la corbeille / avancée faite par l'agence.
--   5) Propriétaires (fondateurs) : marcbouraoui@gmail.com, gianni.valter@gmail.com,
--      milanesemaher@gmail.com, talent@ttpcreators.pro. partnerships@ttpcreators.pro
--      repasse « membre » (seulement si au moins un nouveau fondateur existe déjà).
-- ════════════════════════════════════════════════════════════════════════════

-- 1) To-do : traçabilité du « Fait ».
alter table public.todos add column if not exists done_at timestamptz;
alter table public.todos add column if not exists done_by text;

-- 2) To-do « Chaque semaine » (agence uniquement).
create table if not exists public.todo_routines (
  id          uuid primary key default gen_random_uuid(),
  text        text not null check (char_length(text) between 1 and 300),
  weekday     smallint check (weekday between 1 and 7),          -- 1 = lundi … 7 = dimanche ; vide = n'importe quel jour
  priority    text not null default 'moyenne' check (priority in ('haute', 'moyenne', 'basse')),
  done_log    jsonb not null default '[]'::jsonb,                 -- [{ "at": date ISO, "by": "Marc" }], le plus récent en dernier
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.todo_routines enable row level security;
drop policy if exists todo_routines_agency on public.todo_routines;
create policy todo_routines_agency on public.todo_routines for all to authenticated
  using (public.is_agency()) with check (public.is_agency());

-- 3) Prénom affiché (« Marc », « Gianni »…) et liste réelle des comptes agence.
alter table public.profiles add column if not exists display_name text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_display_name_len') then
    alter table public.profiles add constraint profiles_display_name_len
      check (display_name is null or char_length(display_name) between 1 and 40);
  end if;
end $$;

-- Chacun ne peut changer QUE son propre prénom (rien d'autre dans son profil).
create or replace function public.set_my_display_name(name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_agency() then
    raise exception 'non_autorise';
  end if;
  update public.profiles set display_name = nullif(left(trim(name), 40), '') where user_id = auth.uid();
end $$;
revoke all on function public.set_my_display_name(text) from public, anon;
grant execute on function public.set_my_display_name(text) to authenticated;

-- Comptes agence réels (adresse, niveau, prénom, dernière connexion) : fondateurs seulement.
create or replace function public.agency_accounts()
returns table (user_id uuid, email text, agency_role text, display_name text, last_sign_in_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.user_id, u.email::text, coalesce(p.agency_role, 'member'), p.display_name, u.last_sign_in_at
    from public.profiles p join auth.users u on u.id = p.user_id
   where p.role = 'agency' and public.is_founder()
   order by (coalesce(p.agency_role, 'member') = 'founder') desc, u.email;
$$;
revoke all on function public.agency_accounts() from public, anon;
grant execute on function public.agency_accounts() to authenticated;

-- 4) Journal de l'équipe. Lecture : agence (les lignes « factures » : fondateurs
--    seulement, comme la Finance). Aucune écriture directe : seul le déclencheur
--    ci-dessous ajoute des lignes, au nom du compte connecté.
create table if not exists public.agency_activity (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid,
  actor_name  text,
  verb        text not null,     -- add | done | reopen | delete | status | step
  entity      text not null,     -- table concernée (todos, contacts, collabs…)
  label       text not null,     -- ce qui a été touché (« Relancer Nike »…)
  detail      text,              -- nouveau statut / nouvelle étape
  creator     text,              -- créatrice concernée, s'il y en a une
  pushed_at   timestamptz,       -- notification envoyée à l'équipe
  created_at  timestamptz not null default now()
);
create index if not exists agency_activity_created_idx on public.agency_activity (created_at desc);
create index if not exists agency_activity_actor_idx on public.agency_activity (actor_id, created_at desc);
alter table public.agency_activity enable row level security;
drop policy if exists agency_activity_read on public.agency_activity;
create policy agency_activity_read on public.agency_activity for select to authenticated
  using (public.is_agency() and (entity <> 'invoices' or public.is_founder()));

create or replace function public.log_agency_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  n jsonb;
  o jsonb;
  r jsonb;
  v text;
  d text;
  who text;
  lbl text;
begin
  -- Seules les actions d'un compte agence connecté sont notées (pas les crons,
  -- ni la synchro Google, ni les créatrices).
  if uid is null or not public.is_agency() then
    return null;
  end if;
  n := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  o := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  r := coalesce(n, o);

  if tg_op = 'INSERT' then
    v := 'add';
  elsif tg_op = 'DELETE' then
    v := 'delete';
  elsif tg_table_name = 'todos' then
    if coalesce(n->>'status', '') = 'Fait' and coalesce(o->>'status', '') <> 'Fait' then v := 'done';
    elsif coalesce(o->>'status', '') = 'Fait' and coalesce(n->>'status', '') <> 'Fait' then v := 'reopen';
    end if;
  elsif tg_table_name = 'todo_routines' then
    if jsonb_array_length(coalesce(n->'done_log', '[]'::jsonb)) > jsonb_array_length(coalesce(o->'done_log', '[]'::jsonb)) then
      v := 'done';
    end if;
  elsif tg_table_name = 'collabs' then
    if (n->>'status') is distinct from (o->>'status') then v := 'status'; d := n->>'status';
    elsif coalesce((n->>'step')::int, 0) > coalesce((o->>'step')::int, 0) then v := 'step'; d := n->>'step';
    end if;
  elsif tg_table_name = 'events' then
    if coalesce((n->>'deleted')::boolean, false) and not coalesce((o->>'deleted')::boolean, false) then v := 'delete'; end if;
  elsif n ? 'status' and (n->>'status') is distinct from (o->>'status') then
    v := 'status'; d := n->>'status';
  end if;
  if v is null then
    return null;
  end if;

  select coalesce(nullif(trim(p.display_name), ''), split_part(u.email::text, '@', 1))
    into who
    from auth.users u left join public.profiles p on p.user_id = u.id
   where u.id = uid;
  lbl := case tg_table_name
    when 'invoices' then concat_ws(' · ', nullif(r->>'ref', ''), nullif(r->>'party', ''))
    else coalesce(nullif(r->>'text', ''), nullif(r->>'brand', ''), nullif(r->>'name', ''),
                  nullif(r->>'title', ''), nullif(r->>'person', ''), nullif(r->>'email', ''))
  end;
  insert into public.agency_activity (actor_id, actor_name, verb, entity, label, detail, creator)
  values (uid, left(coalesce(who, 'Quelqu''un'), 40), v, tg_table_name,
          left(coalesce(nullif(lbl, ''), '(sans titre)'), 200), d, r->>'creator');
  return null;
exception when others then
  -- La trace ne doit JAMAIS empêcher l'action elle-même.
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['todos', 'todo_routines', 'ideas', 'events', 'contacts', 'creators', 'collabs',
                           'briefs', 'invoices', 'documents', 'gifting', 'creator_pool', 'prospects'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists agency_activity_log on public.%I', t);
      execute format('create trigger agency_activity_log after insert or update or delete on public.%I
                      for each row execute function public.log_agency_activity()', t);
    end if;
  end loop;
end $$;

-- 5) Propriétaires de l'app (fondateurs).
do $$
declare
  owners text[] := array['marcbouraoui@gmail.com', 'gianni.valter@gmail.com', 'milanesemaher@gmail.com', 'talent@ttpcreators.pro'];
  names  text[] := array['Marc', 'Gianni', null, null];
  e text;
  i int;
  u uuid;
  n_owners int := 0;
begin
  for i in 1 .. array_length(owners, 1) loop
    e := owners[i];
    select id into u from auth.users where lower(email) = e limit 1;
    if u is null then
      raise notice 'Pas encore de compte pour % : crée-le dans l''app (Accès → Créer un accès → Agence → Fondateur), puis relance ce SQL.', e;
    else
      insert into public.profiles (user_id, role, agency_role, display_name)
      values (u, 'agency', 'founder', names[i])
      on conflict (user_id) do update
        set role = 'agency', agency_role = 'founder',
            display_name = coalesce(public.profiles.display_name, excluded.display_name);
      n_owners := n_owners + 1;
      raise notice 'Fondateur : %', e;
    end if;
  end loop;

  -- partnerships@ n'est plus propriétaire : il reste dans l'équipe en « membre »
  -- (tout sauf Finance et Accès). Seulement si un nouveau fondateur existe, pour
  -- ne jamais se retrouver sans propriétaire.
  if n_owners > 0 then
    update public.profiles p set agency_role = 'member'
      from auth.users x
     where x.id = p.user_id and lower(x.email) = 'partnerships@ttpcreators.pro' and p.role = 'agency';
    raise notice 'partnerships@ttpcreators.pro : membre (n''est plus propriétaire).';
  else
    raise notice 'Aucun des nouveaux propriétaires n''a de compte : partnerships@ reste propriétaire pour l''instant.';
  end if;
end $$;
