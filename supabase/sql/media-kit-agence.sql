-- ════════════════════════════════════════════════════════════════════════════
-- MEDIA KIT AGENCE — contenu éditable du deck global
-- ════════════════════════════════════════════════════════════════════════════
-- Le deck agence (ttpcreators.pro/mediakit/agence/) affiche tout le roster + un
-- contenu AGENCE : intro (titre + accroche), 3 piliers, 2 KPIs statiques et le
-- bloc contact. Jusqu'ici ce contenu était codé en dur dans le site. Cette table
-- le rend éditable depuis l'app (vue « Media kit agence »).
--
-- Modèle : table SINGLETON (une seule ligne, id=1) avec un blob `data` jsonb ;
-- une vue anon `public_agency_mediakit` l'expose au site vitrine (comme
-- public_mediakit pour les créatrices). Écriture réservée à l'agence.
--
-- Idempotent — relançable sans risque. Foldé dans SETUP.sql.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.agency_mediakit (
  id         int primary key default 1,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint agency_mediakit_singleton check (id = 1)
);

-- La ligne unique (id=1) existe toujours → l'app fait un upsert dessus.
insert into public.agency_mediakit (id, data) values (1, '{}'::jsonb)
  on conflict (id) do nothing;

alter table public.agency_mediakit enable row level security;

drop policy if exists agency_mediakit_read  on public.agency_mediakit;
drop policy if exists agency_mediakit_write on public.agency_mediakit;
-- Lecture : tout compte connecté (le contenu est public de toute façon).
create policy agency_mediakit_read  on public.agency_mediakit for select to authenticated
  using (true);
-- Écriture (insert/update/delete) : AGENCE uniquement.
create policy agency_mediakit_write on public.agency_mediakit for all to authenticated
  using (public.is_agency()) with check (public.is_agency());

-- Vue publique (anon) pour le site vitrine — n'expose QUE le blob `data` (public,
-- aucune donnée sensible). Security definer : lue en anonyme malgré la RLS.
create or replace view public.public_agency_mediakit
with (security_invoker = false) as
  select data from public.agency_mediakit where id = 1;
grant select on public.public_agency_mediakit to anon, authenticated;

-- Vérif (déconnecté) : select data from public.public_agency_mediakit;  → 1 ligne
-- Vérif (créateur) : update public.agency_mediakit set data='{}' where id=1; → 0 ligne (RLS)
