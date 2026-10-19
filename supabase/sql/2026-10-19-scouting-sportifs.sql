-- ============================================================================
-- 2026-10-19 · Scouting des SPORTIFS (Scouting → « Sportifs »), à part du scouting
-- créateurs (creator_pool, utilisé aussi par le Sourcing et les radars).
-- Même principe : nom, @ Instagram, email, sport (colonne tag), club, niveau, note,
-- dernier contact. Agence seule (RLS). Sans risque à relancer.
-- ============================================================================
create table if not exists public.athlete_pool (
  id uuid primary key default gen_random_uuid(),
  name text not null, handle text, email text,
  tag text,            -- sport
  club text, level text,
  note text,
  last_contacted timestamptz, sort_order int default 0, created_at timestamptz default now()
);
alter table public.athlete_pool enable row level security;
revoke all on public.athlete_pool from anon;
drop policy if exists athlete_pool_agency on public.athlete_pool;
create policy athlete_pool_agency on public.athlete_pool for all to authenticated
  using (public.is_agency()) with check (public.is_agency());

-- Vérification : doit afficher « athlete_pool · RLS : true ».
select relname as table_name, 'RLS : ' || relrowsecurity as securite
  from pg_class where relname = 'athlete_pool';
