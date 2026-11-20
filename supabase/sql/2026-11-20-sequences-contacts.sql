-- TITRE : TTP Suite · Séquences de prospection et état des adresses sur les fiches contact (2026-11-20)
-- ============================================================================
-- Liste de Gianni « ce qu'il manque pour automatiser la prospection », points 1, 2 et 7.
--   contacts.sequence    : la séquence en cours (étape, prochaine relance, canal, réponse…),
--                          règles dans supabase/functions/_shared/sequence.ts ;
--   contacts.email_check : l'adresse est-elle bonne (rebond, domaine sans serveur mail) ?
-- Deux colonnes jsonb facultatives : rien ne change pour les lignes existantes.
-- Index : les contacts à relancer (séquence en cours, date de la prochaine étape).
-- Peut être relancé sans risque.
-- ============================================================================
alter table public.contacts add column if not exists sequence jsonb;
alter table public.contacts add column if not exists email_check jsonb;

create index if not exists contacts_sequence_prochaine_idx
  on public.contacts ((sequence->>'prochaine'))
  where sequence->>'statut' = 'en_cours';

notify pgrst, 'reload schema';
