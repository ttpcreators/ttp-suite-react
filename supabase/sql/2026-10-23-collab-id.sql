-- ════════════════════════════════════════════════════════════════════════════
-- Titre Supabase : « Collab au centre · collab_id + historique des étapes »
-- 2026-10-23 · La collab devient le centre : factures, tâches, rendez-vous, briefs et
-- gifting peuvent être reliés à UNE collab (`collab_id`). La fiche collab affiche tout ce
-- qui la concerne, et chaque objet renvoie vers sa collab.
--
-- Sécurité : la colonne ne donne AUCUN accès (aucune policy ni vue ne joint dessus ; la
-- RLS de chaque table reste la même). Un créateur ne peut relier SES objets (tâches,
-- rendez-vous, gifting, briefs) qu'à une de SES collabs (trigger `collab_link_guard`) :
-- il ne peut pas glisser une ligne dans la fiche collab d'un autre créateur.
--
-- Historique des étapes : `collab_steps` est rempli par le trigger `collabs_log_step`.
-- S'il est vide alors qu'il y a des collabs, le trigger n'était pas en prod : on le
-- (re)crée et on rattrape une ligne par collab sans historique (étape actuelle, datée de
-- la dernière modification).
--
-- Relançable sans risque. L'app marche avant ce SQL (repli : correspondance marque +
-- créateur, marquée « suggéré »).
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Colonne collab_id + index
alter table public.invoices add column if not exists collab_id uuid references public.collabs(id) on delete set null;
alter table public.todos    add column if not exists collab_id uuid references public.collabs(id) on delete set null;
alter table public.events   add column if not exists collab_id uuid references public.collabs(id) on delete set null;
alter table public.briefs   add column if not exists collab_id uuid references public.collabs(id) on delete set null;
alter table public.gifting  add column if not exists collab_id uuid references public.collabs(id) on delete set null;
create index if not exists invoices_collab_idx on public.invoices (collab_id);
create index if not exists todos_collab_idx    on public.todos (collab_id);
create index if not exists events_collab_idx   on public.events (collab_id);
create index if not exists briefs_collab_idx   on public.briefs (collab_id);
create index if not exists gifting_collab_idx  on public.gifting (collab_id);

-- 2) Garde : hors agence, collab_id doit être vide ou une collab du créateur connecté.
create or replace function public.collab_link_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.collab_id is null or public.is_agency() then return new; end if;
  if tg_op = 'UPDATE' and new.collab_id is not distinct from old.collab_id then return new; end if;
  if not exists (select 1 from public.collabs c where c.id = new.collab_id and c.creator = public.my_creator()) then
    raise exception 'collab_id interdit' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists todos_collab_link_guard on public.todos;
create trigger todos_collab_link_guard before insert or update of collab_id on public.todos
  for each row execute function public.collab_link_guard();
drop trigger if exists events_collab_link_guard on public.events;
create trigger events_collab_link_guard before insert or update of collab_id on public.events
  for each row execute function public.collab_link_guard();
drop trigger if exists gifting_collab_link_guard on public.gifting;
create trigger gifting_collab_link_guard before insert or update of collab_id on public.gifting
  for each row execute function public.collab_link_guard();
drop trigger if exists briefs_collab_link_guard on public.briefs;
create trigger briefs_collab_link_guard before insert or update of collab_id on public.briefs
  for each row execute function public.collab_link_guard();
drop trigger if exists invoices_collab_link_guard on public.invoices;
create trigger invoices_collab_link_guard before insert or update of collab_id on public.invoices
  for each row execute function public.collab_link_guard();

-- 3) Historique des étapes : trigger (copie de SETUP.sql) + rattrapage
create or replace function public.collabs_log_step() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.collab_steps(collab_id, step, reached_at)
      values (new.id, new.step, coalesce(new.created_at, now()));
  elsif (tg_op = 'UPDATE' and new.step is distinct from old.step) then
    insert into public.collab_steps(collab_id, step, reached_at) values (new.id, new.step, now());
  end if;
  return new;
end $$;
drop trigger if exists collabs_log_step_ins on public.collabs;
create trigger collabs_log_step_ins after insert on public.collabs
  for each row execute function public.collabs_log_step();
drop trigger if exists collabs_log_step_upd on public.collabs;
create trigger collabs_log_step_upd after update on public.collabs
  for each row execute function public.collabs_log_step();

insert into public.collab_steps(collab_id, step, reached_at)
select c.id, c.step, coalesce(c.updated_at, c.created_at, now())
  from public.collabs c
 where not exists (select 1 from public.collab_steps s where s.collab_id = c.id);

-- 4) Contrôle : colonnes présentes, objets déjà reliés, historique rempli.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and column_name = 'collab_id'
      and table_name in ('invoices','todos','events','briefs','gifting')) as colonnes_collab_id, -- attendu : 5
  (select count(*) from public.collabs) as collabs,
  (select count(*) from public.collab_steps) as lignes_historique,
  (select count(*) from public.collabs c where not exists (select 1 from public.collab_steps s where s.collab_id = c.id)) as collabs_sans_historique; -- attendu : 0
