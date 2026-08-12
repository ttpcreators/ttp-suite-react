-- ============================================================================
-- BRIEFS : PDF joint (facultatif)
-- ============================================================================
-- Colonne `pdf` (jsonb) sur `briefs` : { name, path, docId }.
--   • le fichier est uploadé dans le bucket Storage `documents` (chemin `briefs/…`) ;
--   • une ligne `documents` (type = 'brief', creator = créateur du brief) est aussi
--     insérée → le PDF apparaît dans Documents (agence) ET dans l'espace / le portail
--     du créateur (RLS `documents` existante : lecture par le créateur concerné).
--   • `pdf.docId` garde la référence de cette ligne pour pouvoir la retirer proprement.
--
-- RLS `briefs` inchangée (écriture agence). Idempotent.
-- ============================================================================

alter table public.briefs add column if not exists pdf jsonb;
