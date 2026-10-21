-- ============================================================================
-- 2026-10-21 : une tâche de la To-do peut concerner PLUSIEURS créateurs.
-- Titre Supabase : « To-do · plusieurs créateurs »
-- ----------------------------------------------------------------------------
-- `todos.creators` (text[]) = tous les créateurs de la tâche. `todos.creator` reste
-- le PREMIER de la liste : tous les lecteurs existants (notifications, corbeille,
-- planning, connecteur Claude…) continuent de marcher sans changement.
--
-- 1) Trigger todos_b_creators_sync : garde les deux colonnes d'accord (noms rognés,
--    doublons retirés sans tenir compte de la casse, creator = creators[1] ; liste
--    vide + creator rempli → creators = {creator} ; un ancien client qui ne change que
--    `creator` remplace la liste par ce seul nom).
-- 2) Trigger todos_a_creators_guard : un CRÉATEUR connecté ne peut ni changer
--    creator / creators (ni s'ajouter à une tâche, ni en ajouter d'autres), ni créer
--    une tâche pour quelqu'un d'autre. L'agence et le serveur (clé service : connecteur
--    Claude, fonctions) ne sont pas concernés.
-- 3) RLS (lecture large, écriture stricte, jamais de branche `creator is null`) :
--    un créateur LIT et MODIFIE (statut, sous-tâches, pièces jointes…) les tâches où il
--    figure dans `creators`, comme les siennes ; il ne CRÉE que pour lui-même et ne
--    SUPPRIME que celles dont il est le premier créateur (comme avant).
-- 4) Pièces jointes : un créateur ouvre aussi celles des tâches partagées avec lui.
-- 5) Reprise : creators = {creator} pour les tâches existantes.
-- Sans ce SQL, l'app marche comme avant (un seul créateur par tâche).
-- Déjà foldé dans SETUP.sql. Peut être relancé sans risque.
-- ============================================================================

alter table public.todos add column if not exists creators text[] not null default '{}';
create index if not exists todos_creators_gin on public.todos using gin (creators);

-- 1) Cohérence creator / creators ----------------------------------------------
create or replace function public.todos_creators_sync() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
declare
  clean text[];
begin
  -- Ancien client : seul `creator` a changé → la liste devient ce seul nom.
  if tg_op = 'UPDATE'
     and new.creator is distinct from old.creator
     and new.creators is not distinct from old.creators then
    new.creators := case when nullif(btrim(new.creator), '') is null then '{}'::text[]
                         else array[btrim(new.creator)] end;
  end if;
  -- Noms rognés, vides retirés, doublons (casse ignorée) retirés, ordre gardé.
  select coalesce(array_agg(x.n order by x.pos), '{}'::text[]) into clean
    from (
      select distinct on (lower(btrim(u.n))) btrim(u.n) as n, u.pos
        from unnest(coalesce(new.creators, '{}'::text[])) with ordinality as u(n, pos)
       where nullif(btrim(u.n), '') is not null
       order by lower(btrim(u.n)), u.pos
    ) x;
  if cardinality(clean) = 0 and nullif(btrim(new.creator), '') is not null then
    clean := array[btrim(new.creator)];
  end if;
  new.creators := clean;
  new.creator := clean[1];  -- null si la liste est vide (tâche agence)
  return new;
end $$;

-- 2) Garde-fou côté créateur ---------------------------------------------------
-- Les triggers BEFORE passent par ordre alphabétique : la garde (a_) avant la mise
-- en ordre (b_). La RLS (with check) est vérifiée APRÈS ces triggers.
create or replace function public.todos_creators_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.is_agency() then
    if tg_op = 'INSERT' then
      -- Une tâche créée par un créateur n'est qu'à lui (la RLS vérifie creator = lui).
      new.creators := case when nullif(btrim(new.creator), '') is null then '{}'::text[]
                           else array[btrim(new.creator)] end;
    else
      new.creator  := old.creator;
      new.creators := old.creators;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists todos_creators_sync on public.todos;
drop trigger if exists todos_b_creators_sync on public.todos;
create trigger todos_b_creators_sync before insert or update on public.todos
  for each row execute function public.todos_creators_sync();
drop trigger if exists todos_creators_guard on public.todos;
drop trigger if exists todos_a_creators_guard on public.todos;
create trigger todos_a_creators_guard before insert or update on public.todos
  for each row execute function public.todos_creators_guard();

-- 3) RLS ------------------------------------------------------------------------
-- Remplace todos_scoped (for all : is_agency() or creator = my_creator()).
drop policy if exists todos_scoped on public.todos;
drop policy if exists todos_read   on public.todos;
drop policy if exists todos_insert on public.todos;
drop policy if exists todos_update on public.todos;
drop policy if exists todos_delete on public.todos;
create policy todos_read on public.todos for select to authenticated
  using (public.is_agency() or creator = public.my_creator() or public.my_creator() = any(creators));
create policy todos_insert on public.todos for insert to authenticated
  with check (public.is_agency() or creator = public.my_creator());
create policy todos_update on public.todos for update to authenticated
  using (public.is_agency() or creator = public.my_creator() or public.my_creator() = any(creators))
  with check (public.is_agency() or creator = public.my_creator() or public.my_creator() = any(creators));
create policy todos_delete on public.todos for delete to authenticated
  using (public.is_agency() or creator = public.my_creator());

-- 4) Pièces jointes des tâches partagées --------------------------------------
drop policy if exists documents_obj_creator_own_read on storage.objects;
create policy documents_obj_creator_own_read on storage.objects for select to authenticated
  using (
    bucket_id = 'documents' and (
      name like 'creator-uploads/' || auth.uid()::text || '/%'
      or exists (
        select 1 from public.todos t, jsonb_array_elements(coalesce(t.attachments, '[]'::jsonb)) a
         where a->>'path' = storage.objects.name
           and (t.creator = public.my_creator() or public.my_creator() = any(t.creators))
           -- seulement un fichier rangé sous CETTE tâche (pas un chemin recopié, 2026-10-15)
           and storage.objects.name like 'todo-attachments/' || t.id::text || '/%'
      )
    )
  );

-- 5) Reprise des tâches existantes ----------------------------------------------
update public.todos
   set creators = array[btrim(creator)]
 where cardinality(creators) = 0
   and nullif(btrim(creator), '') is not null;

-- Contrôle : tâches avec un créateur mais sans liste (doit afficher 0).
select count(*) as taches_sans_liste
  from public.todos
 where nullif(btrim(creator), '') is not null and cardinality(creators) = 0;
