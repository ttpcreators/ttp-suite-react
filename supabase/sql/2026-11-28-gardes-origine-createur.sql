-- ============================================================================
-- 2026-11-28 · Tâches, idées, cadeaux et rendez-vous d'un créateur : origine et champs de
-- synchro verrouillés
-- Titre Supabase : « Gardes origine créateur »
-- ----------------------------------------------------------------------------
-- Pourquoi (audit des 14 attaques du 28/11, constats de l'équipe « accès » contre-vérifiés) :
--   • un créateur qui insère une tâche avec source 'alfred' ou 'claude' la gardait telle
--     quelle (seule 'agency' était remplacée) : la To-do de l'agence affichait alors
--     « Demandée par : L'agence » ; même chose pour ses idées et ses cadeaux (« Ajoutée par
--     l'agence ») et ses rendez-vous, sans aucune garde sur source ;
--   • sur une tâche de l'agence qu'il voit, il pouvait changer collab_id, id, created_at et
--     sort_order ;
--   • sur ses rendez-vous, il choisissait google_event_id, google_etag et last_synced_at :
--     l'évènement Google que la synchro de l'agence modifie ou supprime.
--
-- Quoi :
--   1) todos_creators_guard (copie de la version en prod, 2026-11-27-taches-pour-createur.sql,
--      relue en base le 28/11) : à l'insertion par un créateur, source vaut toujours
--      'creator'. Sur une tâche de l'agence : refus (« Tâche suivie par ton agence », 42501)
--      aussi d'un changement de collab_id, d'id ou de created_at ; sort_order reste celui de
--      l'agence (sans erreur). Le reste ne change pas (drapeau ttp.auto_step compris).
--   2) source_createur_guard sur ideas, gifting et events (avant insertion ou modification) :
--      pour un créateur connecté, source vaut 'creator' à l'insertion et ne change plus
--      ensuite (valeur d'avant remise).
--   3) events_creator_sync_guard (avant insertion ou modification) : pour un créateur
--      connecté, google_event_id, google_etag et last_synced_at sont vidés à l'insertion et
--      gardés à la modification. La synchro Google (serveur, sans compte connecté) les écrit
--      toujours. La suppression douce (deleted, sync_source 'agence') reste permise. Que les
--      rendez-vous d'un créateur partent ou non dans l'agenda de l'agence reste une décision
--      de Marc : ce SQL n'y touche pas (sync_source n'est pas gardé).
--   Fonctions security definer, search_path fixé, execute retiré à public, anon et
--   authenticated. L'agence et le serveur ne changent pas.
--
-- Avant ce SQL, l'app marche comme aujourd'hui ; après aussi : l'espace créateur envoie déjà
-- source 'creator' et n'écrit ni les champs Google ni l'ordre des tâches de l'agence.
-- Contrôle : la requête à la fin. Attendu : true · true · 3 · 1 · false · false · false
-- Relançable sans risque (create or replace, drop puis create des déclencheurs).
-- Pas encore dans SETUP.sql (à replier avec la vague du 27/11). Après ce SQL, ne plus
-- relancer 2026-11-27-taches-pour-createur.sql (ni les anciens fichiers que son en-tête
-- cite) : la garde des tâches y perd ces verrous, sans aucune erreur.
-- ============================================================================

-- 1) Garde des tâches -------------------------------------------------------------------------
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
      -- Une tâche écrite par un créateur est toujours la sienne (ni « agence », ni « Alfred »).
      new.source := 'creator';
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
           or new.collab_id is distinct from old.collab_id
           or new.id is distinct from old.id
           or new.created_at is distinct from old.created_at
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
        -- L'ordre de la To-do de l'agence reste le sien.
        new.sort_order := old.sort_order;
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

revoke execute on function public.todos_creators_guard() from public, anon, authenticated;
-- Le déclencheur todos_a_creators_guard ne change pas.

-- 2) Origine des idées, cadeaux et rendez-vous --------------------------------------------------
create or replace function public.source_createur_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.is_agency() then
    if tg_op = 'INSERT' then
      new.source := 'creator';
    else
      new.source := old.source;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.source_createur_guard() from public, anon, authenticated;

drop trigger if exists ideas_source_guard on public.ideas;
create trigger ideas_source_guard before insert or update on public.ideas
  for each row execute function public.source_createur_guard();
drop trigger if exists gifting_source_guard on public.gifting;
create trigger gifting_source_guard before insert or update on public.gifting
  for each row execute function public.source_createur_guard();
drop trigger if exists events_source_guard on public.events;
create trigger events_source_guard before insert or update on public.events
  for each row execute function public.source_createur_guard();

-- 3) Champs de synchro Google des rendez-vous ---------------------------------------------------
create or replace function public.events_creator_sync_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or public.is_agency() then return new; end if;
  if tg_op = 'INSERT' then
    new.google_event_id := null;
    new.google_etag     := null;
    new.last_synced_at  := null;
  else
    new.google_event_id := old.google_event_id;
    new.google_etag     := old.google_etag;
    new.last_synced_at  := old.last_synced_at;
  end if;
  return new;
end $$;
revoke execute on function public.events_creator_sync_guard() from public, anon, authenticated;
drop trigger if exists events_creator_sync_guard on public.events;
create trigger events_creator_sync_guard before insert or update on public.events
  for each row execute function public.events_creator_sync_guard();

-- Contrôle (une ligne). Attendu : true · true · 3 · 1 · false · false · false
select
  position('new.source := ''creator'';' in pg_get_functiondef('public.todos_creators_guard'::regproc)) > 0
    and position('ttp.auto_step' in pg_get_functiondef('public.todos_creators_guard'::regproc)) > 0 as origine_taches,
  position('new.collab_id is distinct from old.collab_id' in pg_get_functiondef('public.todos_creators_guard'::regproc)) > 0
    and position('new.sort_order := old.sort_order' in pg_get_functiondef('public.todos_creators_guard'::regproc)) > 0 as tache_agence,
  (select count(*) from pg_trigger where not tgisinternal
    and tgname in ('ideas_source_guard', 'gifting_source_guard', 'events_source_guard')) as gardes_origine,
  (select count(*) from pg_trigger where not tgisinternal and tgname = 'events_creator_sync_guard') as garde_synchro,
  has_function_privilege('authenticated', 'public.todos_creators_guard()', 'execute') as taches_appelable,
  has_function_privilege('authenticated', 'public.source_createur_guard()', 'execute') as origine_appelable,
  has_function_privilege('authenticated', 'public.events_creator_sync_guard()', 'execute') as synchro_appelable;
