-- ============================================================================
-- VIVIER CRÉATEURS (hors roster) — répertoire de créateurs à solliciter
-- ============================================================================
-- Table `creator_pool` : créateurs que l'agence NE représente pas (encore) —
-- vivier / UGC / prospects — à contacter pour une campagne ou un recrutement.
-- Champs : nom, handle, email, tag (niche), note, last_contacted (suivi contact).
--
-- RLS : AGENCE UNIQUEMENT (outil interne). Les créateurs ne voient pas le vivier.
-- Idempotent.
-- ============================================================================

create table if not exists public.creator_pool (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  handle text,
  email text,
  tag text,
  note text,
  last_contacted timestamptz,
  sort_order int default 0,
  created_at timestamptz default now()
);
create index if not exists creator_pool_sort_idx on public.creator_pool (sort_order);
alter table public.creator_pool enable row level security;
drop policy if exists creator_pool_agency on public.creator_pool;
create policy creator_pool_agency on public.creator_pool for all to authenticated
  using (public.is_agency()) with check (public.is_agency());
