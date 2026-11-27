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
--      rendre une tâche interne, l'app envoie les deux à false. Si seule la case
--      « Visible » est décochée, le masquage l'emporte : la tâche n'est plus demandée (une
--      page de l'agence ouverte avant ce SQL, ou Alfred avec modifier_element, n'envoient
--      que visible_createur = false ; sans ça, la tâche resterait lue par le créateur).
--      Reprise faite UNE seule fois, quand la colonne est créée : les tâches écrites à la
--      main pour un créateur (étiquette CRÉATEUR ou PERSO, visibles) deviennent demandées.
--      Les tâches d'Alfred (« Claude · … ») et les rappels des collabs restent à false.
--   2) Garde todos_creators_guard, pour un créateur connecté, sur une tâche de l'agence :
--      refus (« Tâche suivie par ton agence », code 42501) de tout changement du texte, du
--      détail, de l'échéance, de la priorité, de l'étiquette et des deux cases. Sur une
--      tâche seulement suivie par l'agence (pas demandée) : refus aussi du statut, de
--      « fait », des sous-tâches et des pièces jointes. « Où j'en suis » : ajout seulement
--      (le nouveau texte commence par l'ancien, aux blancs du début et de la fin près,
--      comptés comme l'app : espace insécable comprise). Une réponse écrite depuis une page
--      restée ouverte part d'une copie ancienne : si un point de l'agence ou d'Alfred est
--      arrivé entre-temps, ses lignes nouvelles vont à la suite du texte enregistré au
--      lieu d'être refusées. Effacer ou réécrire un point reste refusé. Les verrous d'avant
--      restent (créateurs, origine, « fait par »).
--   3) Règle todos_delete : un créateur ne supprime que ses propres tâches.
--   4) Repères « nouveau » (todos_activity) : rien pour le créateur sur une tâche suivie
--      par l'agence ; « nouveau » à la création d'une tâche « Pour toi », quand une tâche
--      devient demandée, et pour un créateur ajouté à une tâche « Pour toi » qui existait
--      déjà (lui seul) ; côté agence, « Terminée » quand le créateur termine une tâche de
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
-- Après ce SQL, ne plus relancer les anciens fichiers qui redéfinissent ces objets : ils
-- les remettraient dans leur ancienne version sans aucune erreur (leur en-tête le dit :
-- 2026-10-21-taches-plusieurs-createurs.sql, 2026-10-23-notifications-nouveautes.sql,
-- 2026-11-24-taches-internes-privees.sql, 2026-11-24-reperes-taches-internes.sql,
-- 2026-11-27-securite-14.sql), ni SETUP.sql tant que la vague n'y est pas repliée.
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

-- Une tâche demandée au créateur est toujours visible par lui. Si seule la case « Visible »
-- est décochée (« À faire par le créateur » pas touchée), le masquage l'emporte : la tâche
-- n'est plus demandée, comme la case de la fiche.
create or replace function public.todos_pour_createur_visible() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and old.visible_createur and not new.visible_createur
     and new.pour_createur is not distinct from old.pour_createur then
    new.pour_createur := false;
  elsif new.pour_createur then
    new.visible_createur := true;
  end if;
  return new;
end $$;
drop trigger if exists todos_c_pour_createur on public.todos;
create trigger todos_c_pour_createur before insert or update on public.todos
  for each row execute function public.todos_pour_createur_visible();

-- 2) Garde des écritures d'un créateur ------------------------------------------------
create or replace function public.todos_creators_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  -- Blancs du début et de la fin : les mêmes que String.trim() de l'app (espace insécable
  -- comprise). Sinon un point ajouté par l'app ne « commencerait » plus par l'ancien texte.
  rogne constant text := '^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$';
  ancien text;
  nouveau text;
  lignes_a text[];
  lignes_n text[];
  ajout text[] := '{}';
  ligne text;
  k int := 0;
  i int;
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
        if new.text is distinct from old.text
           or new.descr is distinct from old.descr
           or new.due is distinct from old.due
           or new.priority is distinct from old.priority
           or new.tag is distinct from old.tag
           or new.visible_createur is distinct from old.visible_createur
           or new.pour_createur is distinct from old.pour_createur
           or (not coalesce(old.pour_createur, false) and (
                 new.status is distinct from old.status
                 or new.done is distinct from old.done
                 or new.done_at is distinct from old.done_at
                 or new.done_by is distinct from old.done_by
                 or new.subtasks is distinct from old.subtasks
                 or new.attachments is distinct from old.attachments)) then
          raise exception 'Tâche suivie par ton agence' using errcode = '42501';
        end if;
        -- « Où j'en suis » : un point s'ajoute à la suite, rien ne s'efface.
        ancien  := regexp_replace(coalesce(old.progress, ''), rogne, '', 'g');
        nouveau := regexp_replace(coalesce(new.progress, ''), rogne, '', 'g');
        if left(nouveau, length(ancien)) is distinct from ancien then
          -- La page du créateur partait d'une copie ancienne (un point de l'agence ou
          -- d'Alfred est arrivé depuis son chargement) : les lignes qu'elle ajoute vont à la
          -- suite du texte enregistré. Rien de neuf, ou une ligne enregistrée qui revient
          -- plus loin (il efface ou réécrit un point) : refus.
          lignes_a := string_to_array(ancien, E'\n');
          lignes_n := string_to_array(nouveau, E'\n');
          while k < least(cardinality(lignes_a), cardinality(lignes_n))
                and regexp_replace(lignes_a[k + 1], rogne, '', 'g') = regexp_replace(lignes_n[k + 1], rogne, '', 'g') loop
            k := k + 1;
          end loop;
          for i in k + 1 .. cardinality(lignes_n) loop
            ligne := regexp_replace(lignes_n[i], rogne, '', 'g');
            continue when ligne = '';
            if exists (select 1 from unnest(lignes_a[k + 1:]) x where regexp_replace(x, rogne, '', 'g') = ligne) then
              raise exception 'Tâche suivie par ton agence' using errcode = '42501';
            end if;
            ajout := ajout || ligne;
          end loop;
          if cardinality(ajout) = 0 then
            raise exception 'Tâche suivie par ton agence' using errcode = '42501';
          end if;
          new.progress := ancien || E'\n' || array_to_string(ajout, E'\n');
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
  anciens text[]; ajoutes text[] := '{}';
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

    -- Créateur ajouté par l'agence à une tâche « Pour toi » qui existait déjà : « nouveau »
    -- pour lui seul (elle arrive dans sa liste) ; les autres gardent les repères habituels.
    if tg_op = 'UPDATE' and actor = 'agency' and not devient_demandee then
      select coalesce(array_agg(lower(btrim(x))), '{}') into anciens
        from jsonb_array_elements_text(case when jsonb_typeof(o->'creators') = 'array' and jsonb_array_length(o->'creators') > 0
                                            then o->'creators' else jsonb_build_array(coalesce(o->>'creator', '')) end) x;
      foreach nm in array names loop
        if not (lower(nm) = any (anciens)) then
          perform public.log_activity_event('creator', nm, 'todo', new.id::text, title, 'new', who, title);
          ajoutes := ajoutes || nm;
        end if;
      end loop;
      names := array(select n from unnest(names) n where not (n = any (ajoutes)));
    end if;

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
  position('ttp.auto_step' in pg_get_functiondef('public.todos_creators_guard'::regproc)) > 0
    and position('lignes_n' in pg_get_functiondef('public.todos_creators_guard'::regproc)) > 0 as garde_ok,
  position('pour_toi' in pg_get_functiondef('public.todos_activity'::regproc)) > 0
    and position('ajoutes' in pg_get_functiondef('public.todos_activity'::regproc)) > 0 as reperes_ok,
  (select qual not like '%visible_createur%' from pg_policies
    where schemaname = 'public' and tablename = 'todos' and policyname = 'todos_delete') as suppression_ok,
  exists (select 1 from pg_trigger where tgname = 'todos_c_pour_createur' and not tgisinternal)
    and position('old.visible_createur' in pg_get_functiondef('public.todos_pour_createur_visible'::regproc)) > 0 as visible_ok,
  (select count(*) from public.todos where pour_createur) as taches_demandees;
