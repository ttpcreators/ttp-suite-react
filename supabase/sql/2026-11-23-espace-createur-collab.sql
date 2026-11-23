-- ============================================================================
-- Espace créateur : « J'ai lu » et concept sur un brief, lien du post et stats à 7 jours
-- Titre Supabase : « Espace créateur · brief lu, concept, post et stats »
-- (2026-11-23, demandé par Marc). Relançable sans risque.
-- ----------------------------------------------------------------------------
-- 1. Brief : le créateur peut dire « J'ai lu » (read_at, posé une seule fois par le
--    serveur) et proposer un concept (texte court + lien facultatif). L'agence voit
--    tout dans la fiche collab et valide le concept (concept_status = 'valide') ;
--    c'est cette validation qui fait passer la collab à l'étape 3 « Concept validé »
--    (fait par l'app agence, jamais par le créateur).
--    La garde briefs_creator_guard laisse le créateur écrire SEULEMENT : status,
--    consignes (son script), read_at, concept, concept_link. Une proposition repasse
--    toujours « propose » : un créateur ne peut pas valider son propre concept.
-- 2. Posts publiés (table collab_posts) : le créateur colle le lien de son post sur une
--    de SES collabs, puis ses stats à 7 jours (vues, likes, commentaires, partages,
--    enregistrements, capture facultative dans son dossier creator-uploads/<uid>/).
--    Lien → la collab atteint l'étape 6 « Publication » ; stats → l'étape 7 « Stats à
--    7 jours » (jamais de recul, rien sur une collab perdue ou archivée). La page
--    Debrief reprend ces chiffres dans le bilan.
--    RLS : lecture et écriture = is_agency() or creator = my_creator() (aucune branche
--    `creator is null`) ; la garde vérifie en plus que la collab est bien la sienne.
-- L'app marche avant ce SQL : boutons cachés tant que les colonnes ou la table manquent.
-- ============================================================================

-- 1) Brief lu et concept ------------------------------------------------------
alter table public.briefs add column if not exists read_at              timestamptz;
alter table public.briefs add column if not exists concept              text;
alter table public.briefs add column if not exists concept_link         text;
alter table public.briefs add column if not exists concept_at           timestamptz;
alter table public.briefs add column if not exists concept_status       text;
alter table public.briefs add column if not exists concept_validated_at timestamptz;

create or replace function public.briefs_creator_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j jsonb;
  v_concept text;
  v_link text;
begin
  -- Sans compte connecté (serveur : résumé déposé par Claude) ou agence : tout passe.
  if auth.uid() is null or public.is_agency() then return new; end if;
  -- Créateur : tout reste comme avant, sauf son statut et son script…
  j := jsonb_build_object('status', new.status, 'consignes', new.consignes);
  -- … « J'ai lu » : date du serveur, posée une seule fois…
  j := j || jsonb_build_object('read_at', coalesce(old.read_at, case when new.read_at is not null then now() end));
  -- … et son concept : toujours « proposé », jamais validé par lui-même.
  if new.concept is distinct from old.concept or new.concept_link is distinct from old.concept_link then
    v_concept := nullif(btrim(left(coalesce(new.concept, ''), 2000)), '');
    v_link := nullif(btrim(left(coalesce(new.concept_link, ''), 500)), '');
    if v_link is not null and v_link !~* '^https?://' then v_link := null; end if;
    j := j || jsonb_build_object(
      'concept', v_concept,
      'concept_link', case when v_concept is null then null else v_link end,
      'concept_at', case when v_concept is null then null else now() end,
      'concept_status', case when v_concept is null then null else 'propose' end,
      'concept_validated_at', null);
  end if;
  return jsonb_populate_record(old, j);
end $$;
drop trigger if exists briefs_creator_guard on public.briefs;
create trigger briefs_creator_guard before update on public.briefs
  for each row execute function public.briefs_creator_guard();

-- 2) Posts publiés et stats à 7 jours -----------------------------------------
create table if not exists public.collab_posts (
  id           uuid primary key default gen_random_uuid(),
  collab_id    uuid not null references public.collabs(id) on delete cascade,
  creator      text not null,
  url          text not null check (url ~* '^https?://' and length(url) <= 500),
  platform     text,
  views        bigint check (views is null or views >= 0),
  likes        bigint check (likes is null or likes >= 0),
  comments     bigint check (comments is null or comments >= 0),
  shares       bigint check (shares is null or shares >= 0),
  saves        bigint check (saves is null or saves >= 0),
  capture_path text,
  stats_at     timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists collab_posts_collab_url_idx on public.collab_posts (collab_id, url);
create index if not exists collab_posts_creator_idx on public.collab_posts (creator);
alter table public.collab_posts enable row level security;
revoke all on public.collab_posts from anon;
grant select, insert, update, delete on public.collab_posts to authenticated;
drop policy if exists collab_posts_read on public.collab_posts;
create policy collab_posts_read on public.collab_posts for select to authenticated
  using (public.is_agency() or creator = public.my_creator());
drop policy if exists collab_posts_write on public.collab_posts;
create policy collab_posts_write on public.collab_posts for all to authenticated
  using (public.is_agency() or creator = public.my_creator())
  with check (public.is_agency() or creator = public.my_creator());

-- Garde : créateur = celui de la collab ; un créateur n'écrit que sur SES collabs et
-- seulement une capture de SON dossier ; date des stats posée par le serveur.
create or replace function public.collab_posts_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_creator text;
begin
  if tg_op = 'UPDATE' then
    new.collab_id := old.collab_id;
    new.created_at := old.created_at;
  end if;
  select c.creator into v_creator from public.collabs c where c.id = new.collab_id;
  if not found then raise exception 'collab introuvable' using errcode = '23503'; end if;
  new.creator := coalesce(nullif(btrim(v_creator), ''), new.creator);
  new.updated_at := now();
  if coalesce(new.views, new.likes, new.comments, new.shares, new.saves) is null then
    new.stats_at := null;
  elsif tg_op = 'INSERT'
     or (new.views, new.likes, new.comments, new.shares, new.saves) is distinct from (old.views, old.likes, old.comments, old.shares, old.saves) then
    new.stats_at := now();
  else
    new.stats_at := old.stats_at;
  end if;
  if auth.uid() is null or public.is_agency() then return new; end if;
  if v_creator is null or v_creator is distinct from public.my_creator() then
    raise exception 'collab interdite' using errcode = '42501';
  end if;
  if new.capture_path is not null
     and not (tg_op = 'UPDATE' and new.capture_path is not distinct from old.capture_path)
     and new.capture_path not like 'creator-uploads/' || auth.uid()::text || '/%' then
    raise exception 'capture interdite' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists collab_posts_guard on public.collab_posts;
create trigger collab_posts_guard before insert or update on public.collab_posts
  for each row execute function public.collab_posts_guard();

-- Lien → étape 6 ; stats → étape 7. Jamais de recul (le trigger collabs_log_step date l'étape).
create or replace function public.collab_posts_advance() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_target integer := case when new.stats_at is not null then 7 else 6 end;
begin
  update public.collabs set step = v_target
   where id = new.collab_id and coalesce(step, 1) < v_target
     and coalesce(status, 'active') not in ('perdue', 'archivee');
  return new;
end $$;
drop trigger if exists collab_posts_advance on public.collab_posts;
create trigger collab_posts_advance after insert or update on public.collab_posts
  for each row execute function public.collab_posts_advance();

-- Contrôle : 6 colonnes de brief, la table, 2 règles, 3 triggers.
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'briefs'
     and column_name in ('read_at', 'concept', 'concept_link', 'concept_at', 'concept_status', 'concept_validated_at')) as colonnes_brief,
  to_regclass('public.collab_posts') is not null as table_posts,
  (select count(*) from pg_policy where polrelid = 'public.collab_posts'::regclass) as regles_posts,
  (select count(*) from pg_trigger where tgname in ('briefs_creator_guard', 'collab_posts_guard', 'collab_posts_advance') and not tgisinternal) as triggers;
-- Attendu : colonnes_brief 6 · table_posts true · regles_posts 2 · triggers 3
