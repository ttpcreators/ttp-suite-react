-- ============================================================================
-- Instagram · compteur de demandes à Meta
-- Titre Supabase : « Instagram · compteur Meta (ig_quota) »
-- ============================================================================
-- Une seule ligne, écrite par les fonctions Instagram après chaque passage :
-- demandes de l'heure et du jour, part du quota Meta utilisée (%), heure de
-- reprise si Meta a mis en pause. Affichée dans Sourcing et Scouting.
-- Lecture agence, écriture serveur seulement.
-- ============================================================================
create table if not exists public.ig_quota (
  id   int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  at   timestamptz not null default now()
);
alter table public.ig_quota enable row level security;
revoke all on public.ig_quota from anon;
drop policy if exists ig_quota_agency_read on public.ig_quota;
create policy ig_quota_agency_read on public.ig_quota for select to authenticated using (public.is_agency());
select 'ig_quota prête' as etat;
