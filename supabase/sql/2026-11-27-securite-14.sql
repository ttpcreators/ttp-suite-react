-- ============================================================================
-- 2026-11-27 · Sécurité : audit « 14 attaques »
-- ----------------------------------------------------------------------------
-- NE PLUS RELANCER APRÈS LA VAGUE 1 (SQL du 27/11) : la garde todos_creators_guard de la
-- partie 1 est remplacée par 2026-11-27-taches-pour-createur.sql. Relancé, ce fichier la
-- remettrait dans sa version d'avant, sans aucune erreur : un créateur pourrait de nouveau
-- cocher ou réécrire une tâche suivie par l'agence, et la tâche d'étape posée par la base
-- pendant sa session (« Créer la facture … ») deviendrait la sienne, visible et supprimable.
-- Avant la vague 1, il était relançable sans risque (create or replace, update idempotent,
-- create table if not exists).
-- Aucun changement pour l'agence. Pour un compte créateur connecté :
--
-- 1. Tâches : « fait par » est le nom de son compte (plus un texte libre), une tâche créée
--    par un créateur est marquée « creator », et il ne change pas l'origine d'une tâche.
-- 2. Media kit : il ne change plus lui même l'affichage ni le contenu de ses tarifs
--    (hideRates, rates, ratesNote, ratesNoteEn) ; le reste du kit passe comme avant.
-- 3. Bucket public « avatars » : photos seulement (jpeg, png, webp, gif, avif, heic),
--    plus de SVG. Même liste que src/lib/safeUrl.ts (AVATAR_TYPES).
-- 4. Journal des réservations de visio (rdv_journal), lu et écrit par la fonction rdv
--    seulement (service_role) : plafond par heure et par adresse.
--
-- Foldé dans SETUP.sql.
-- ============================================================================

-- 1. Tâches ------------------------------------------------------------------
create or replace function public.todos_creators_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.is_agency() then
    if tg_op = 'INSERT' then
      new.creators := case when nullif(btrim(new.creator), '') is null then '{}'::text[]
                           else array[btrim(new.creator)] end;
      if new.source is not distinct from 'agency' then new.source := 'creator'; end if;
    else
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

-- 2. Fiche créateur : tarifs du media kit -------------------------------------
create or replace function public.creators_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
  k text;
begin
  if auth.uid() is not null and not public.is_agency() then
    new.ca         := old.ca;
    new.commission := old.commission;
    new.status     := old.status;
    new.exclu      := old.exclu;
    new.sort_order := old.sort_order;
    if new.mediakit is distinct from old.mediakit then
      if jsonb_typeof(new.mediakit) is distinct from 'object' then
        new.mediakit := old.mediakit;
      else
        v := new.mediakit - array['hideRates', 'rates', 'ratesNote', 'ratesNoteEn'];
        if jsonb_typeof(old.mediakit) = 'object' then
          foreach k in array array['hideRates', 'rates', 'ratesNote', 'ratesNoteEn'] loop
            if old.mediakit ? k then v := v || jsonb_build_object(k, old.mediakit -> k); end if;
          end loop;
        end if;
        new.mediakit := v;
      end if;
    end if;
  end if;
  return new;
end $$;

-- 3. Bucket avatars : photos seulement ----------------------------------------
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif']
 where id = 'avatars';

-- 4. Journal des réservations de visio ------------------------------------------
create table if not exists public.rdv_journal (
  id bigserial primary key,
  email text not null,
  cree_le timestamptz not null default now()
);
create index if not exists rdv_journal_cree_le on public.rdv_journal (cree_le);
alter table public.rdv_journal enable row level security;
revoke all on public.rdv_journal from anon, authenticated;
grant select, insert on public.rdv_journal to service_role;
grant usage, select on sequence public.rdv_journal_id_seq to service_role;

-- Contrôle (une ligne) : attendu « true · true · {image/jpeg,…} · true »
select
  position('done_by' in pg_get_functiondef('public.todos_creators_guard'::regproc)) > 0 as taches_ok,
  position('hideRates' in pg_get_functiondef('public.creators_guard'::regproc)) > 0     as tarifs_ok,
  (select allowed_mime_types from storage.buckets where id = 'avatars')                as avatars_types,
  to_regclass('public.rdv_journal') is not null                                           as journal_rdv_ok;
