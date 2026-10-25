-- ============================================================================
-- 2026-10-25 : audit serveur (base et sécurité).
-- Titre Supabase : « Audit serveur 2026-10-25 »
-- ----------------------------------------------------------------------------
-- 1) Les gardes des briefs, des fiches créateur et des liens de collab ne
--    reconnaissaient que l'agence connectée. Les écritures du SERVEUR (clé
--    service_role, sans compte connecté) étaient traitées comme celles d'un
--    créateur. Conséquence visible : le résumé déposé par Claude (outil
--    resumer_brief du connecteur) était annulé sans erreur par
--    briefs_creator_guard, et n'apparaissait jamais. Les gardes laissent
--    maintenant passer les écritures sans compte connecté (serveur, SQL Editor) ;
--    la clé publique (anon) n'a de toute façon aucun droit d'écriture sur ces tables.
-- 2) Bucket public « avatars » : images seulement, 25 Mo maximum (avant : tout
--    compte connecté pouvait y déposer n'importe quel fichier, de n'importe quelle
--    taille, servi publiquement).
--
-- Aucune donnée modifiée. Déjà foldé dans SETUP.sql. Peut être relancé sans risque.
-- L'app marche avant comme après.
-- ============================================================================

-- 1a) Briefs : un créateur ne change que le statut et son script ; agence et serveur, tout.
create or replace function public.briefs_creator_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_agency() then return new; end if;
  -- Créatrice : tout reste comme avant, sauf status et consignes.
  return jsonb_populate_record(old, jsonb_build_object('status', new.status, 'consignes', new.consignes));
end $$;

-- 1b) Fiche créateur : colonnes de l'agence (CA, commission, statut, exclusivité, ordre).
create or replace function public.creators_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_agency() then
    new.ca         := old.ca;
    new.commission := old.commission;
    new.status     := old.status;
    new.exclu      := old.exclu;
    new.sort_order := old.sort_order;
  end if;
  return new;
end $$;

-- 1c) Lien vers une collab : un créateur ne relie qu'à SES collabs.
create or replace function public.collab_link_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.collab_id is null or auth.uid() is null or public.is_agency() then return new; end if;
  if tg_op = 'UPDATE' and new.collab_id is not distinct from old.collab_id then return new; end if;
  if not exists (select 1 from public.collabs c where c.id = new.collab_id and c.creator = public.my_creator()) then
    raise exception 'collab_id interdit' using errcode = '42501';
  end if;
  return new;
end $$;

-- 2) Bucket « avatars » : images seulement, 25 Mo maximum.
update storage.buckets
   set allowed_mime_types = array['image/*'],
       file_size_limit    = 26214400
 where id = 'avatars';

-- ----------------------------------------------------------------------------
-- Contrôle : une ligne, toutes les colonnes à true.
-- ----------------------------------------------------------------------------
select
  (select prosrc like '%auth.uid() is null or public.is_agency()%' from pg_proc where proname = 'briefs_creator_guard' and pronamespace = 'public'::regnamespace) as briefs_ok,
  (select prosrc like '%auth.uid() is not null and not public.is_agency()%' from pg_proc where proname = 'creators_guard' and pronamespace = 'public'::regnamespace) as creators_ok,
  (select prosrc like '%auth.uid() is null or public.is_agency()%' from pg_proc where proname = 'collab_link_guard' and pronamespace = 'public'::regnamespace) as collab_ok,
  (select allowed_mime_types = array['image/*'] and file_size_limit = 26214400 from storage.buckets where id = 'avatars') as avatars_ok;
