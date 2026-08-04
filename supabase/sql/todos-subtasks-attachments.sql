-- ============================================================================
-- TÂCHES : sous-tâches (checklist) + pièces jointes
-- ============================================================================
-- Deux colonnes JSONB sur `todos`, éditées depuis la fiche tâche (agence + créateur,
-- la RLS existante de `todos` s'applique déjà — rien à changer côté policies) :
--   • subtasks    : [{ id, text, done }]        (checklist interne à la tâche)
--   • attachments : [{ name, size, path }]      (fichiers du bucket `documents`)
--
-- Les fichiers sont stockés dans le bucket Storage `documents` déjà en place
-- (agence : chemin libre ; créateur : `creator-uploads/<uid>/…` via la RLS storage
-- existante). Ici on ne stocke QUE la référence (chemin) dans le JSONB.
--
-- Idempotent : rejouable sans risque.
-- ============================================================================

alter table public.todos add column if not exists subtasks jsonb;
alter table public.todos add column if not exists attachments jsonb;
