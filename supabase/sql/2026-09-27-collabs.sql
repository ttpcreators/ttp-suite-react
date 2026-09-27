-- ============================================================================
-- COLLABS — cycle de vie des collaborations (11 étapes datées)
-- Titre Supabase : « Agent · Phase 2 · collabs + collab_steps »
-- ============================================================================
-- Objectif : donner à chaque collab une ÉTAPE COURANTE (1 à 11) et un HISTORIQUE
-- DATÉ de chaque changement d'étape, pour que l'agent détecte ce qui stagne.
--
-- Étapes (spec) : 1 Signature · 2 Brief transmis · 3 Concept validé · 4 Tournage
--   5 Validation marque · 6 Publication · 7 Stats à 7 jours · 8 Facture envoyée
--   9 Paiement marque reçu · 10 Créatrice payée · 11 Bilan et renouvellement.
--
-- ➕ MIGRATION EN AJOUT PUR : deux nouvelles tables, aucune donnée existante
--    modifiée ni supprimée. Idempotente (create if not exists / drop policy if…).
--
-- RLS : motif maison « lecture large, écriture stricte ».
--   collabs      : agence = tout ; créatrice = ses collabs (creator = my_creator()).
--   collab_steps : lecture agence + créatrice de la collab liée ; écriture agence.
--   (L'écriture de l'historique passe surtout par un trigger SECURITY DEFINER.)
-- ============================================================================

-- 1) La collab elle-même ------------------------------------------------------
create table if not exists public.collabs (
  id uuid primary key default gen_random_uuid(),
  brand text not null,                       -- marque (convention app : nom en texte)
  creator text,                              -- créatrice (nom, comme briefs.creator)
  contact text,                              -- interlocuteur côté marque (nom)
  title text,                                -- libellé de la collab (ex « Campagne été »)
  deliverables text,                         -- livrables
  cachet text,                               -- cachet / budget (texte libre, comme briefs.budget)
  step int not null default 1 check (step between 1 and 11),  -- étape courante
  status text not null default 'active',     -- active / gagnee / perdue / archivee
  brief_id uuid,                             -- lien optionnel vers le brief source
  note text,
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists collabs_sort_idx    on public.collabs (sort_order);
create index if not exists collabs_creator_idx on public.collabs (creator);
create index if not exists collabs_step_idx     on public.collabs (step);

-- 2) L'historique daté des étapes --------------------------------------------
create table if not exists public.collab_steps (
  id uuid primary key default gen_random_uuid(),
  collab_id uuid not null references public.collabs(id) on delete cascade,
  step int not null check (step between 1 and 11),
  reached_at timestamptz default now(),
  note text
);
create index if not exists collab_steps_collab_idx on public.collab_steps (collab_id);

-- 3) updated_at auto sur collabs ---------------------------------------------
create or replace function public.collabs_touch() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists collabs_touch_upd on public.collabs;
create trigger collabs_touch_upd before update on public.collabs
  for each row execute function public.collabs_touch();

-- 4) Journalisation automatique des étapes -----------------------------------
-- À la création : on enregistre l'étape de départ. À chaque changement d'étape :
-- on enregistre la nouvelle étape avec sa date. SECURITY DEFINER pour que
-- l'écriture de l'historique réussisse toujours, indépendamment de la RLS de
-- collab_steps (l'app ne fait qu'UPDATE collabs.step ; elle ne touche jamais
-- collab_steps directement). search_path figé (bonne pratique DEFINER).
create or replace function public.collabs_log_step() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.collab_steps(collab_id, step, reached_at)
      values (new.id, new.step, coalesce(new.created_at, now()));
  elsif (tg_op = 'UPDATE' and new.step is distinct from old.step) then
    insert into public.collab_steps(collab_id, step, reached_at)
      values (new.id, new.step, now());
  end if;
  return new;
end $$;
drop trigger if exists collabs_log_step_ins on public.collabs;
create trigger collabs_log_step_ins after insert on public.collabs
  for each row execute function public.collabs_log_step();
drop trigger if exists collabs_log_step_upd on public.collabs;
create trigger collabs_log_step_upd after update on public.collabs
  for each row execute function public.collabs_log_step();

-- 5) RLS ---------------------------------------------------------------------
alter table public.collabs      enable row level security;
alter table public.collab_steps enable row level security;

drop policy if exists collabs_scoped on public.collabs;
create policy collabs_scoped on public.collabs for all to authenticated
  using (public.is_agency() or creator = public.my_creator())
  with check (public.is_agency() or creator = public.my_creator());

-- collab_steps : lecture large (agence + créatrice de la collab liée), écriture agence.
-- Les deux policies SELECT se combinent en OR ; l'écriture directe reste agence
-- (l'historique normal est écrit par le trigger DEFINER ci-dessus).
drop policy if exists collab_steps_read   on public.collab_steps;
drop policy if exists collab_steps_agency on public.collab_steps;
create policy collab_steps_read on public.collab_steps for select to authenticated
  using (
    public.is_agency()
    or exists (
      select 1 from public.collabs c
       where c.id = collab_steps.collab_id and c.creator = public.my_creator()
    )
  );
create policy collab_steps_agency on public.collab_steps for all to authenticated
  using (public.is_agency()) with check (public.is_agency());

-- ============================================================================
-- Vérification anon attendue après application (jamais de vraie donnée) :
--   • select=step sur collabs      → 200 (colonne présente, RLS filtre → [])
--   • select=reached_at sur collab_steps → 200 []
--   • INSERT collabs en anon       → 401 42501 (écriture refusée hors auth)
--   • colonne bidon                → 400 42703 (contrôle négatif)
-- ============================================================================
