-- ============================================================================
-- 09-events-description.sql
-- ----------------------------------------------------------------------------
-- Ajoute une description / commentaire aux événements du Planning.
-- Ce champ est synchronisé avec Google Agenda (description de l'événement),
-- dans les deux sens (app <-> Google).
--
-- À exécuter AVANT de déployer le front (sinon créer/modifier un événement
-- échouerait : colonne inconnue).
-- ============================================================================

alter table public.events add column if not exists description text;
