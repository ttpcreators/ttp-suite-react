-- ============================================================================
-- 2026-10-21 : résumé d'un brief pour le créateur (page Briefs + espace créateur).
-- Titre Supabase : « Briefs · résumé pour le créateur »
-- ----------------------------------------------------------------------------
-- `resume` (jsonb) = { faire[], eviter[], livrables[], mentions[], maj_le, par }.
-- Écrit par Claude (outil resumer_brief du connecteur ttp-mcp) ou à la main par
-- l'agence (Modifier le brief). Lu par le créateur avec ses briefs (RLS existante).
-- Le créateur ne peut pas le modifier : le trigger briefs_creator_guard ne lui
-- laisse changer que status et consignes.
-- Déjà foldé dans SETUP.sql. Peut être relancé sans risque.
-- ============================================================================

alter table public.briefs add column if not exists resume jsonb;
