-- ============================================================================
-- 2026-11-27 · Vague 1 : les tâches « Pour toi » et les tâches « suivies par ton agence »
-- Titre Supabase : « Tâches pour le créateur »
-- ----------------------------------------------------------------------------
-- Pourquoi (audit du 27/11, points W2, C4, D1, W4) : depuis le 24/11, le créateur lit les
-- tâches visibles de l'agence et d'Alfred telles quelles (décision de Marc, gardée). Mais
-- il pouvait aussi les cocher, les réécrire ou les supprimer pour de bon, sans trace : une
-- relance de marque pouvait disparaître de la To-do de l'agence.
--
-- Quoi :
--   1) Colonne todos.pour_createur (défaut false) : « l'agence demande cette tâche au
--      créateur, c'est à lui de la faire ». Elle ne compte que pour une tâche de l'agence
--      (source = 'agency'). Une tâche demandée est toujours visible : la base pose
--      visible_createur = true à chaque écriture (déclencheur todos_c_pour_createur). Pour
--      rendre une tâche interne, l'app envoie les deux à false.
--      Reprise faite UNE seule fois, quand la colonne est créée : les tâches écrites à la
--      main pour un créateur (étiquette CRÉATEUR ou PERSO, visibles) deviennent demandées.
--      Les tâches d'Alfred (« Claude · … ») et les rappels des collabs restent à false.
--   2) Garde todos_creators_guard, pour un créateur connecté, sur une tâche de l'agence :
--      refus (« Tâche suivie par ton agence », code 42501) de tout changement du texte, du
--      détail, de l'échéance, de la priorité, de l'étiquette et des deux cases. Sur une
--      tâche seulement suivie par l'agence (pas demandée) : refus aussi du statut, de
--      « fait », des sous-tâches et des pièces jointes. « Où j'en suis » : ajout seulement
--      (le nouveau texte commence par l'ancien). Les verrous d'avant restent (créateurs,
--      origine, « fait par »).
--   3) Règle todos_delete : un créateur ne supprime que ses propres tâches.
--   4) Repères « nouveau » (todos_activity) : rien pour le créateur sur une tâche suivie
--      par l'agence ; « nouveau » à la création d'une tâche « Pour toi » et quand une tâche
--      devient demandée ; côté agence, « Terminée » quand le créateur termine une tâche de
--      l'agence.
--   5) Drapeau de transaction ttp.auto_step : la tâche d'étape créée par la base (fichier
--      2026-11-27-etape-collab-auto.sql) passe sans garde ni repère, même quand l'étape
--      change dans la session d'un créateur.
--
-- Avant ce SQL, l'app marche comme aujourd'hui (colonne absente : tout reste « Pour toi »).
-- Contrôle : la requête à la fin. Attendu : 1 · true · true · true · true · N (N = tâches
-- demandées, 56 au 27/11).
-- Relançable sans risque : la reprise ne se refait pas, le reste est create or replace.
-- À lancer AVANT 2026-11-27-etape-collab-auto.sql. Pas encore dans SETUP.sql (à replier
-- après la réécriture de SETUP.sql en cours).
-- ============================================================================

-- 1) Colonne, et reprise faite une seule fois ---------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'todos' and column_name = 'pour_createur') then
    alter table public.todos add column pour_createur boolean not null default false;
    -- Tâches écrites à la main pour un créateur et visibles par lui (pas les rappels des collabs).
    update public.todos set pour_createur = true
     where source = 'agency' and visible_createur and tag in ('CRÉATEUR', 'PERSO')
       and (cardinality(creators) > 0 or nullif(btrim(creator), '') is not null)
       and text !~* '^(Résumer le brief pour|Relancer .+ pour (le contenu|le paiement)|Envoyer le contenu à .+ pour validation|Relever les stats à 7 jours|Créer la facture|Reverser |Préparer le bilan pour)';
  end if;
end $$;

-- Une tâche demandée au créateur est toujours visible par lui.
create or replace function public.todos_pour_createur_visible() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if new.pour_createur then new.visible_createur := true; end if;
  return new;
end $$;
drop trigger if exists todos_c_pour_createur on public.todos;
create trigger todos_c_pour_createur before insert or update on public.todos
  for each row execute function public.todos_pour_createur_visible();

-- 2) Garde des écritures d'un créateur ------------------------------------------------
create or replace function public.todos_creators_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ancien text;
  nouveau text;
begin
  -- Tâche de l'étape d'une collab, créée par la base (collabs_step_task) : elle reste à
  -- l'agence telle quelle, même si l'étape a changé dans la session d'un créateur.
  if pg_trigger_depth() > 1 and coalesce(current_setting('ttp.auto_step', true), '') = '1' then
    return new;
  end if;
  if auth.uid() is not null and not public.is_agency() then
    if tg_op = 'INSERT' then
      new.creators := case when nullif(btrim(new.creator), '') is null then '{}'::text[]
                           else array[btrim(new.creator)] end;
      if new.source is not distinct from 'agency' then new.source := 'creator'; end if;
    else
      -- Tâche de l'agence : le créateur lit tout, mais ne change ni ce qu'elle dit ni pour
      -- qui elle est ; si elle est seulement suivie par l'agence, il ne la termine pas non
      -- plus. Un refus plutôt qu'un retour silencieux : sinon l'app afficherait « Fait ✓ »
      -- pour rien. L'app ne propose pas ces actions : ce refus est un filet.
      if old.source is not distinct from 'agency' then
        ancien  := btrim(coalesce(old.progress, ''), E' \t\r\n');
        nouveau := btrim(coalesce(new.progress, ''), E' \t\r\n');
        if new.text is distinct from old.text
           or new.descr is distinct from old.descr
           or new.due is distinct from old.due
           or new.priority is distinct from old.priority
           or new.tag is distinct from old.tag
           or new.visible_createur is distinct from old.visible_createur
           or new.pour_createur is distinct from old.pour_createur
           -- « Où j'en suis » : un point s'ajoute à la suite, rien ne s'efface.
           or left(nouveau, length(ancien)) is distinct from ancien
           or (not coalesce(old.pour_createur, false) and (
                 new.status is distinct from old.status
                 or new.done is distinct from old.done
                 or new.done_at is distinct from old.done_at
                 or new.done_by is distinct from old.done_by
                 or new.subtasks is distinct from old.subtasks
                 or new.attachments is distinct from old.attachments)) then
          raise exception 'Tâche suivie par ton agence' using errcode = '42501';
        end if;
      end if;
      new.creator  := old.creator;
      new.creators := old.creators;
      new.source   := old.source;
    end if;
    -- « Fait par » : le nom du compte connecté, jamais un texte choisi par l'appelant.
    if new.done_by is not null
       and (tg_op = 'INSERT' or new.done_by is distinct from old.done_by) then
      new.done_by := coalesce(
        (select coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.creator_name), ''))
           from public.profiles p where p.user_id = auth.uid()),
        'Créateur');
    end if;
  end if;
  return new;
end $$;

-- 3) Suppression : un créateur ne supprime que ses propres tâches --------------------
drop policy if exists todos_delete on public.todos;
create policy todos_delete on public.todos for delete to authenticated
  using (public.is_agency() or (creator = public.my_creator() and source is distinct from 'agency'));

-- 4) Repères « nouveau » des tâches ----------------------------------------------------
create or replace function public.todos_activity() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor text; who text; j jsonb; o jsonb; names text[]; nm text; sub text; title text;
  changes text[][] := '{}';
  i int;
  agence boolean; pour_toi boolean; devient_demandee boolean;
begin
  begin
    -- Tâche de l'étape d'une collab, créée par la base : rien à signaler.
    if pg_trigger_depth() > 1 and coalesce(current_setting('ttp.auto_step', true), '') = '1' then
      return new;
    end if;
    actor := public.activity_actor();
    if actor is null then return new; end if;
    who := public.activity_actor_name();
    j := to_jsonb(new);
    o := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
    agence := (j->>'source') is not distinct from 'agency';
    -- « Pour toi » : sa propre tâche, ou une tâche que l'agence lui demande (toujours visible).
    pour_toi := not agence or coalesce((j->>'pour_createur')::boolean, false);
    -- Tâche interne, ou seulement suivie par l'agence : rien pour le créateur.
    if actor = 'agency' and not pour_toi then return new; end if;
    devient_demandee := tg_op = 'UPDATE' and agence
      and coalesce((j->>'visible_createur')::boolean, false) and coalesce((j->>'pour_createur')::boolean, false)
      and not (coalesce((o->>'visible_createur')::boolean, false) and coalesce((o->>'pour_createur')::boolean, false));
    title := left(coalesce(j->>'text', ''), 120);
    select coalesce(array_agg(btrim(x)) filter (where btrim(x) <> ''), '{}') into names
      from jsonb_array_elements_text(case when jsonb_typeof(j->'creators') = 'array' and jsonb_array_length(j->'creators') > 0
                                          then j->'creators' else jsonb_build_array(coalesce(j->>'creator', '')) end) x;
    if coalesce(array_length(names, 1), 0) = 0 then return new; end if;

    if tg_op = 'INSERT' or devient_demandee then
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
      -- Le créateur termine une tâche de l'agence : l'agence le voit (« Terminée »).
      if actor = 'creator' and agence
         and coalesce((j->>'done')::boolean, false) and not coalesce((o->>'done')::boolean, false) then
        changes := changes || array[array['done', title]];
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
    null; -- jamais bloquant
  end;
  return new;
end $$;

-- Contrôle (une ligne). Attendu : 1 · true · true · true · true · N
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'todos' and column_name = 'pour_createur') as colonne,
  position('ttp.auto_step' in pg_get_functiondef('public.todos_creators_guard'::regproc)) > 0 as garde_ok,
  position('pour_toi' in pg_get_functiondef('public.todos_activity'::regproc)) > 0 as reperes_ok,
  (select qual not like '%visible_createur%' from pg_policies
    where schemaname = 'public' and tablename = 'todos' and policyname = 'todos_delete') as suppression_ok,
  exists (select 1 from pg_trigger where tgname = 'todos_c_pour_createur' and not tgisinternal) as visible_ok,
  (select count(*) from public.todos where pour_createur) as taches_demandees;
