-- ============================================================================
-- CONTACTS : @Instagram + Ville
-- ----------------------------------------------------------------------------
-- Deux champs en plus sur les fiches contacts (marques / agences / médias…) :
--   • instagram : le @ de la marque (ex. « @sephora ») ;
--   • city      : la ville (ex. « Paris »).
-- Rien à changer côté RLS : les policies `contacts` existantes couvrent déjà
-- toutes les colonnes. Idempotent.
-- ============================================================================

alter table public.contacts add column if not exists instagram text;
alter table public.contacts add column if not exists city text;
