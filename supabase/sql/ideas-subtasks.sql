-- ============================================================================
-- IDÉES : sous-tâches (checklist)
-- ============================================================================
-- Une colonne JSONB sur `ideas`, éditée depuis la carte d'idée (agence + créateur ;
-- la RLS existante de `ideas` s'applique déjà — rien à changer côté policies) :
--   • subtasks : [{ id, text, done }]   (checklist interne à l'idée)
--
-- Pas de pièces jointes ici (choix produit : les idées n'en ont pas).
--
-- Idempotent : rejouable sans risque.
-- ============================================================================

alter table public.ideas add column if not exists subtasks jsonb;
