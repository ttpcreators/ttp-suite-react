-- ============================================================================
-- 2026-11-24 (suite de « Tâches internes privées ») : les repères « nouveau »
-- d'une tâche interne n'arrivent plus chez le créateur.
-- Titre Supabase : « Repères des tâches internes »
-- ----------------------------------------------------------------------------
-- NE PLUS RELANCER APRÈS LA VAGUE 1 (SQL du 27/11) : todos_activity est remplacée par
-- 2026-11-27-taches-pour-createur.sql, et la règle activity_events_read par
-- 2026-11-27-reperes-depots-infos.sql. Relancé, ce fichier les remettrait dans leur
-- version du 24/11, sans aucune erreur : le créateur recevrait de nouveau des repères pour
-- les tâches suivies par l'agence, la tâche d'étape posée par la base en laisserait un, et
-- les repères d'un objet supprimé compteraient de nouveau.
--
-- Bug vu chez une créatrice : « To-do 3 » dans son menu, mais une liste vide. Le
-- déclencheur todos_activity créait un repère pour le créateur à chaque écriture
-- de l'agence sur une tâche qui le cite, même interne. Le repère contient aussi le
-- titre de la tâche.
-- 1) todos_activity : rien pour le créateur sur une tâche interne de l'agence ; un
--    repère « nouveau » quand l'agence la coche « Visible par le créateur ».
-- 2) activity_events_read : un créateur ne lit le repère d'une tâche que s'il lit
--    la tâche elle-même (règle todos_read). Les anciens repères des tâches internes
--    disparaissent donc de son espace, sans rien supprimer.
-- Était relançable sans risque avant la vague 1 (voir plus haut).
-- ============================================================================

create or replace function public.todos_activity() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor text; who text; j jsonb; o jsonb; names text[]; nm text; sub text; title text;
  changes text[][] := '{}';
  i int;
  interne boolean; devient_visible boolean;
begin
  begin
    actor := public.activity_actor();
    if actor is null then return new; end if;
    who := public.activity_actor_name();
    j := to_jsonb(new);
    o := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
    -- Tâche interne de l'agence (pas cochée « Visible par le créateur ») : rien pour lui.
    interne := (j->>'source') is not distinct from 'agency' and not coalesce((j->>'visible_createur')::boolean, false);
    if actor = 'agency' and interne then return new; end if;
    devient_visible := tg_op = 'UPDATE'
      and coalesce((j->>'visible_createur')::boolean, false)
      and not coalesce((o->>'visible_createur')::boolean, false);
    title := left(coalesce(j->>'text', ''), 120);
    select coalesce(array_agg(btrim(x)) filter (where btrim(x) <> ''), '{}') into names
      from jsonb_array_elements_text(case when jsonb_typeof(j->'creators') = 'array' and jsonb_array_length(j->'creators') > 0
                                          then j->'creators' else jsonb_build_array(coalesce(j->>'creator', '')) end) x;
    if coalesce(array_length(names, 1), 0) = 0 then return new; end if;

    if tg_op = 'INSERT' or devient_visible then
      changes := array[array['new', title]];
    else
      if (j->>'text') is distinct from (o->>'text') and coalesce(j->>'text', '') <> '' then
        changes := changes || array[array['text', j->>'text']];
      end if;
      if (j->>'descr') is distinct from (o->>'descr') and coalesce(btrim(j->>'descr'), '') <> '' then
        changes := changes || array[array['description', j->>'descr']];
      end if;
      sub := public.activity_new_subtask(o->'subtasks', j->'subtasks');
      if sub is not null then changes := changes || array[array['subtask', sub]]; end if;
      if (j->>'progress') is distinct from (o->>'progress') and length(coalesce(j->>'progress', '')) > length(coalesce(o->>'progress', '')) then
        changes := changes || array[array['progress', public.activity_last_line(j->>'progress')]];
      end if;
    end if;
    if coalesce(array_length(changes, 1), 0) = 0 then return new; end if;

    for i in 1 .. array_length(changes, 1) loop
      if actor = 'agency' then
        foreach nm in array names loop
          perform public.log_activity_event('creator', nm, 'todo', new.id::text, title, changes[i][1], who, changes[i][2]);
        end loop;
      else
        perform public.log_activity_event('agency', public.my_creator(), 'todo', new.id::text, title, changes[i][1], who, changes[i][2]);
      end if;
    end loop;
  exception when others then
    null;
  end;
  return new;
end $$;

-- Le créateur ne lit le repère d'une tâche que s'il lit la tâche (la sous-requête
-- passe par la règle todos_read).
drop policy if exists activity_events_read on public.activity_events;
create policy activity_events_read on public.activity_events for select to authenticated
  using (
    (target = 'agency' and public.is_agency())
    or (target = 'creator' and creator = public.my_creator()
        and (object_type <> 'todo' or exists (select 1 from public.todos t where t.id::text = activity_events.object_id)))
  );

-- Contrôle : 1 · 1 (fonction et règle à jour).
select
  (select count(*) from pg_proc where proname = 'todos_activity' and prosrc like '%devient_visible%') as fonction,
  (select count(*) from pg_policies where tablename = 'activity_events' and policyname = 'activity_events_read' and qual like '%todos%') as regle;
