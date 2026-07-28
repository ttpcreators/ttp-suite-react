-- ============================================================================
-- FEUILLE DE ROUTE PARTAGÉE AVEC LE CRÉATEUR (suivi créateurs)
-- ============================================================================
-- Le suivi complet (fiche éditoriale, mensuel, journal, alertes) reste dans le blob
-- AGENCE (invisible aux créateurs). Cette table n'expose que le STRICT partageable :
--   • roadmap      : la feuille de route éditoriale (piliers, ton, objectifs 90j,
--                    cadence recommandée) — l'AGENCE écrit, le créateur LIT.
--   • self_cadence : la cadence réelle que le CRÉATEUR reporte lui-même, par mois
--                    { "AAAA-MM": {reels, carrousels, stories, tiktoks, youtube} }.
--
-- ⚠️ Cloisonnement : un créateur ne voit/écrit QUE sa ligne (creator = my_creator()),
-- et un trigger l'empêche de modifier `roadmap` (la feuille de route reste à l'agence).
-- Le journal, les alertes et l'évaluation mensuelle de l'agence ne sont PAS ici.
--
-- Idempotent : rejouable sans risque.
-- ============================================================================

create table if not exists public.creator_roadmap (
  creator text primary key,        -- nom du créateur (= my_creator())
  roadmap jsonb,                   -- feuille de route (écrite par l'agence)
  self_cadence jsonb,              -- cadence réelle reportée par le créateur (par mois)
  updated_at timestamptz default now()
);

alter table public.creator_roadmap enable row level security;

-- Lecture : l'agence voit tout ; le créateur voit UNIQUEMENT sa ligne.
drop policy if exists creator_roadmap_read on public.creator_roadmap;
create policy creator_roadmap_read on public.creator_roadmap for select to authenticated
  using (public.is_agency() or creator = public.my_creator());

-- Écriture : l'agence partout ; le créateur seulement SA ligne.
drop policy if exists creator_roadmap_write on public.creator_roadmap;
create policy creator_roadmap_write on public.creator_roadmap for all to authenticated
  using (public.is_agency() or creator = public.my_creator())
  with check (public.is_agency() or creator = public.my_creator());

-- Garde-fou : hors agence, `roadmap` est FIGÉ (le créateur ne peut pas réécrire sa
-- feuille de route — il ne touche que `self_cadence`). Couvre INSERT et UPDATE.
create or replace function public.creator_roadmap_guard() returns trigger
  language plpgsql security definer as $$
begin
  if not public.is_agency() then
    if tg_op = 'INSERT' then
      new.roadmap := null;         -- un créateur ne crée jamais la feuille de route
    else
      new.roadmap := old.roadmap;  -- ni ne la modifie
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists creator_roadmap_guard_iu on public.creator_roadmap;
create trigger creator_roadmap_guard_iu before insert or update on public.creator_roadmap
  for each row execute function public.creator_roadmap_guard();
