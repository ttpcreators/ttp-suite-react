-- ============================================================================
-- 2026-11-27 · Vague 1 : repères « nouveau » pour les dépôts et les infos du créateur,
-- plus de pastille pour un objet supprimé, dépôt relié à sa collab
-- Titre Supabase : « Repères dépôts et infos »
-- ----------------------------------------------------------------------------
-- Pourquoi (audit du 27/11, points W5, W9, WC3, WC4) :
--   • le contenu, la facture et les captures de stats déposés par un créateur ne laissaient
--     aucun repère à l'agence (seul un push partait) et n'étaient reliés à aucune collab ;
--   • un repère restait compté après la suppression de son idée ou de son brief (pastille
--     « Idées 1 » que personne ne pouvait effacer) ;
--   • une adresse ou un SIREN changé par le créateur n'était signalé à personne.
--
-- Quoi :
--   1) activity_events accepte deux types d'objets de plus : 'document' (un dépôt du
--      créateur, page Documents de l'agence) et 'creator' (ses infos, page Roster).
--   2) Règle de lecture activity_events_read : des deux côtés, un repère n'est lu que si
--      son objet existe encore (tâche, idée, brief, document, fiche). Côté créateur, la
--      vérification passe par ses propres règles (une tâche interne reste cachée). Rien
--      n'est supprimé : un objet remis depuis la Corbeille retrouve son repère.
--   3) documents.collab_id (lien vers la collab, vidé si la collab est supprimée), index
--      documents_collab_id_idx, et garde documents_collab_link_guard : un créateur ne
--      relie un dépôt qu'à une de SES collabs (sinon erreur 42501 « collab_id interdit » ;
--      l'app recommence alors sans le lien).
--   4) Déclencheur documents_activity : un dépôt fait par un créateur laisse un repère à
--      l'agence (type 'document', « nouveau », détail = type du document).
--   5) Déclencheur creators_infos_activity : quand le créateur change ses infos (adresse,
--      ville, SIREN, email, email pro, téléphone, date de naissance, Instagram, TikTok),
--      l'agence reçoit un repère (type 'creator', « mis à jour ») qui ne cite que les noms
--      des champs, jamais les valeurs. Pas de push.
--   Rien pour le gifting ni la feuille de route (en attente d'une décision de Marc).
--
-- Avant ce SQL, l'app marche comme aujourd'hui (dépôt sans lien, aucun repère de ce type).
-- Contrôle : la requête à la fin. Attendu : true · true · 1 · 3 · false · false
-- Relançable sans risque (if not exists, drop puis create, create or replace).
-- Pas encore dans SETUP.sql (à replier après la réécriture de SETUP.sql en cours).
-- Après ce SQL, ne plus relancer 2026-10-23-notifications-nouveautes.sql ni
-- 2026-11-24-reperes-taches-internes.sql : ils remettraient l'ancienne règle
-- activity_events_read sans aucune erreur (leur en-tête le dit).
-- ============================================================================

-- 1) Deux types d'objets de plus ------------------------------------------------------
alter table public.activity_events drop constraint if exists activity_events_object_type_check;
alter table public.activity_events add constraint activity_events_object_type_check
  check (object_type in ('todo', 'idea', 'brief', 'mail', 'document', 'creator'));

-- 2) Lecture : l'objet doit exister (des deux côtés) -----------------------------------
drop policy if exists activity_events_read on public.activity_events;
create policy activity_events_read on public.activity_events for select to authenticated
  using (
    ((target = 'agency' and public.is_agency()) or (target = 'creator' and creator = public.my_creator()))
    and case object_type
      when 'todo'     then exists (select 1 from public.todos t     where t.id::text = activity_events.object_id)
      when 'idea'     then exists (select 1 from public.ideas i     where i.id::text = activity_events.object_id)
      when 'brief'    then exists (select 1 from public.briefs b    where b.id::text = activity_events.object_id)
      when 'document' then exists (select 1 from public.documents d where d.id::text = activity_events.object_id)
      when 'creator'  then exists (select 1 from public.creators c  where c.id::text = activity_events.object_id)
      else true end
  );

-- 3) Dépôt relié à sa collab --------------------------------------------------------------
alter table public.documents add column if not exists collab_id uuid references public.collabs(id) on delete set null;
create index if not exists documents_collab_id_idx on public.documents (collab_id);
drop trigger if exists documents_collab_link_guard on public.documents;
create trigger documents_collab_link_guard before insert or update of collab_id on public.documents
  for each row execute function public.collab_link_guard();

-- 4) Repère de l'agence pour un dépôt du créateur -----------------------------------------
create or replace function public.documents_activity() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if public.activity_actor() = 'creator' then
      perform public.log_activity_event('agency', coalesce(nullif(btrim(new.creator), ''), public.my_creator()),
        'document', new.id::text, coalesce(nullif(btrim(new.name), ''), 'Document'), 'new',
        public.activity_actor_name(), new.type);
    end if;
  exception when others then
    null; -- jamais bloquant : le dépôt passe toujours
  end;
  return new;
end $$;
revoke execute on function public.documents_activity() from public, anon, authenticated;
drop trigger if exists documents_activity on public.documents;
create trigger documents_activity after insert on public.documents
  for each row execute function public.documents_activity();

-- 5) Repère de l'agence quand le créateur change ses infos --------------------------------
create or replace function public.creators_infos_activity() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  -- Colonne suivie, puis son nom affiché. Jamais la valeur.
  champs constant text[][] := array[
    array['address', 'adresse'], array['ville', 'ville'], array['siren', 'SIREN'],
    array['email', 'email'], array['email_pro', 'email pro'], array['phone', 'téléphone'],
    array['birth', 'date de naissance'], array['instagram', 'Instagram'], array['tiktok', 'TikTok']];
  n jsonb; o jsonb; deja text[]; liste text[] := '{}'; change boolean := false; i int;
begin
  begin
    if public.activity_actor() is distinct from 'creator' then return new; end if;
    n := to_jsonb(new);
    o := to_jsonb(old);
    -- Champs déjà signalés et pas encore lus : on les garde dans le détail.
    select coalesce(array_agg(btrim(x)), '{}') into deja
      from public.activity_events e, unnest(string_to_array(coalesce(e.excerpt, ''), ',')) x
     where e.target = 'agency' and e.object_type = 'creator' and e.object_id = new.id::text and e.read_at is null;
    for i in 1 .. array_length(champs, 1) loop
      if nullif(btrim(n->>champs[i][1]), '') is distinct from nullif(btrim(o->>champs[i][1]), '') then
        change := true;
        liste := liste || champs[i][2];
      elsif champs[i][2] = any (deja) then
        liste := liste || champs[i][2];
      end if;
    end loop;
    if not change then return new; end if;
    perform public.log_activity_event('agency', coalesce(public.my_creator(), new.name), 'creator', new.id::text,
      new.name, 'update', public.activity_actor_name(), array_to_string(liste, ', '));
  exception when others then
    null; -- jamais bloquant : la fiche s'enregistre toujours
  end;
  return new;
end $$;
revoke execute on function public.creators_infos_activity() from public, anon, authenticated;
drop trigger if exists creators_infos_activity on public.creators;
create trigger creators_infos_activity after update on public.creators
  for each row execute function public.creators_infos_activity();

-- Contrôle (une ligne). Attendu : true · true · 1 · 3 · false · false
select
  position('document' in (select pg_get_constraintdef(oid) from pg_constraint
                           where conname = 'activity_events_object_type_check')) > 0 as types_ok,
  (select qual like '%ideas%' and qual like '%briefs%' from pg_policies
    where schemaname = 'public' and tablename = 'activity_events' and policyname = 'activity_events_read') as lecture_ok,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'documents' and column_name = 'collab_id') as colonne_collab,
  (select count(*) from pg_trigger where not tgisinternal
    and tgname in ('documents_collab_link_guard', 'documents_activity', 'creators_infos_activity')) as declencheurs,
  has_function_privilege('authenticated', 'public.documents_activity()', 'execute') as depot_appelable,
  has_function_privilege('authenticated', 'public.creators_infos_activity()', 'execute') as infos_appelable;
