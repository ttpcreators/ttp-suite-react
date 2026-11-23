-- ============================================================================
-- 2026-11-24 : les tâches et rendez-vous INTERNES de l'agence ne sont plus lus
-- par les créateurs.
-- Titre Supabase : « Tâches internes privées »
-- ----------------------------------------------------------------------------
-- Avant : un créateur lisait TOUTE tâche où il figure (creator / creators), donc
-- aussi les tâches internes de l'agence et d'Alfred à son sujet (relances de
-- marques, négociations, notes). Même chose pour les rendez-vous « Tâche : … ».
--
-- 1) todos.visible_createur (défaut false) : une tâche de l'agence
--    (source = 'agency') n'est lue, modifiée ou supprimée par le créateur que si
--    elle est cochée « Visible par le créateur ». Ses propres tâches
--    (source = 'creator') ne changent pas.
-- 2) events.interne (défaut false) : un rendez-vous interne n'est plus lu par le
--    créateur. Reprise : les rendez-vous « Tâche : … » deviennent internes.
-- 3) Pièces jointes des tâches : même règle.
-- Aucune ligne n'est supprimée. Peut être relancé sans risque.
-- ============================================================================

alter table public.todos  add column if not exists visible_createur boolean not null default false;
alter table public.events add column if not exists interne boolean not null default false;

-- Rendez-vous recopiés depuis une tâche (« Tâche : relancer… ») : internes.
update public.events set interne = true
 where not interne and title ~* '^\s*t[âa]che\s*:';

-- 1) Tâches ----------------------------------------------------------------------
drop policy if exists todos_read   on public.todos;
drop policy if exists todos_update on public.todos;
drop policy if exists todos_delete on public.todos;
create policy todos_read on public.todos for select to authenticated
  using (public.is_agency() or (
    (creator = public.my_creator() or public.my_creator() = any(creators))
    and (source is distinct from 'agency' or visible_createur)));
create policy todos_update on public.todos for update to authenticated
  using (public.is_agency() or (
    (creator = public.my_creator() or public.my_creator() = any(creators))
    and (source is distinct from 'agency' or visible_createur)))
  with check (public.is_agency() or (
    (creator = public.my_creator() or public.my_creator() = any(creators))
    and (source is distinct from 'agency' or visible_createur)));
create policy todos_delete on public.todos for delete to authenticated
  using (public.is_agency() or (
    creator = public.my_creator()
    and (source is distinct from 'agency' or visible_createur)));

-- 2) Rendez-vous -----------------------------------------------------------------
drop policy if exists events_read   on public.events;
drop policy if exists events_write  on public.events;
drop policy if exists events_scoped on public.events;
create policy events_read on public.events for select to authenticated
  using (public.is_agency() or (
    public.my_creator() = any(string_to_array(coalesce(who, ''), ', ')) and not interne));
create policy events_write on public.events for all to authenticated
  using (public.is_agency() or (who = public.my_creator() and not interne))
  with check (public.is_agency() or (who = public.my_creator() and not interne));

-- 3) Pièces jointes des tâches ----------------------------------------------------
drop policy if exists documents_obj_creator_own_read on storage.objects;
create policy documents_obj_creator_own_read on storage.objects for select to authenticated
  using (
    bucket_id = 'documents' and (
      name like 'creator-uploads/' || auth.uid()::text || '/%'
      or exists (
        select 1 from public.todos t, jsonb_array_elements(coalesce(t.attachments, '[]'::jsonb)) a
         where a->>'path' = storage.objects.name
           and (t.creator = public.my_creator() or public.my_creator() = any(t.creators))
           and (t.source is distinct from 'agency' or t.visible_createur)
           and storage.objects.name like 'todo-attachments/' || t.id::text || '/%'
      )
    )
  );

-- Contrôle (à lire après le lancement) : 2 · 2 · 0 · nombre de rendez-vous internes.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'todos' and column_name = 'visible_createur')
        or (table_name = 'events' and column_name = 'interne'))) as colonnes,
  (select count(*) from pg_policies
    where schemaname = 'public'
      and ((policyname = 'todos_read' and qual like '%visible_createur%')
        or (policyname = 'events_read' and qual like '%interne%'))) as regles,
  (select count(*) from public.todos where source = 'agency' and visible_createur) as taches_agence_visibles,
  (select count(*) from public.events where interne) as rdv_internes;
