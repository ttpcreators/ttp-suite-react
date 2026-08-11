-- ============================================================================
-- CONTACTS : dernier contact (anti sur-contact en prospection)
-- ============================================================================
-- Colonne `last_contacted` (timestamptz) sur `contacts` : date du dernier email
-- SORTANT vers ce contact. Mise à jour AUTOMATIQUE par l'app :
--   • à chaque envoi depuis le composeur (Gmail `gmail-send` ou Resend `send-email`) ;
--   • en réconciliation quand on ouvre une fiche (dernier message sortant réel lu
--     via `gmail-history`).
-- Sert à afficher « Contacté il y a X j » (fiche + liste) et à alerter avant de
-- relancer un contact trop récemment sollicité.
--
-- RLS `contacts` existante inchangée (écriture agence). Idempotent.
-- ============================================================================

alter table public.contacts add column if not exists last_contacted timestamptz;
