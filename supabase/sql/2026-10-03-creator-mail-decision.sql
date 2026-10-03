-- ════════════════════════════════════════════════════════════════════════════
-- Mails créatrices : décision « J'accepte / Je refuse » (2026-10-03). AJOUT uniquement.
-- Idempotent : peut être relancé sans risque. À lancer dans le SQL Editor.
--
-- « Nouvelle demande » et « En négociation » sont calculés automatiquement depuis
-- Gmail. Seule la DÉCISION (Validé / Refusé) est stockée, avec son auteur :
--   decided_by = 'creator' (boutons de la créatrice) ou 'agency' (choix de l'agence).
-- La créatrice n'écrit jamais directement : la fonction creator-mail vérifie que le
-- fil lui appartient avant d'enregistrer sa décision (RLS inchangée : lecture seule).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.creator_mail_threads add column if not exists decided_by text;
alter table public.creator_mail_threads add column if not exists decided_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'creator_mail_threads_decided_by_check') then
    alter table public.creator_mail_threads
      add constraint creator_mail_threads_decided_by_check check (decided_by is null or decided_by in ('creator', 'agency'));
  end if;
end $$;
