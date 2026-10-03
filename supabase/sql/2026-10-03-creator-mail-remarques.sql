-- ════════════════════════════════════════════════════════════════════════════
-- Mails créatrices : remarques de l'agence + statuts « À vérifier » / « À valider »
-- (2026-10-03). Idempotent : peut être relancé sans risque. SQL Editor.
--
--   - L'agence peut écrire une REMARQUE dans le suivi d'un échange : la créatrice
--     la voit (lecture déjà permise par creator_mail_notes_own). by_role dit qui écrit.
--   - Deux statuts en plus, posés par l'agence et visibles par la créatrice :
--     « À vérifier » (a_verifier) et « À valider » (a_valider).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.creator_mail_notes add column if not exists by_role text not null default 'creator';
alter table public.creator_mail_notes add column if not exists author_name text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'creator_mail_notes_by_role_check') then
    alter table public.creator_mail_notes
      add constraint creator_mail_notes_by_role_check check (by_role in ('creator', 'agency'));
  end if;
end $$;
-- Remarque de l'agence : écrite directement, en son propre nom uniquement.
drop policy if exists creator_mail_notes_agency_insert on public.creator_mail_notes;
create policy creator_mail_notes_agency_insert on public.creator_mail_notes for insert to authenticated
  with check (public.is_agency() and by_role = 'agency' and author_user_id = auth.uid());

alter table public.creator_mail_threads drop constraint if exists creator_mail_threads_status_check;
alter table public.creator_mail_threads add constraint creator_mail_threads_status_check
  check (status in ('nouvelle', 'negociation', 'a_verifier', 'a_valider', 'valide', 'refuse'));
alter table public.creator_mail_status_log drop constraint if exists creator_mail_status_log_status_check;
alter table public.creator_mail_status_log add constraint creator_mail_status_log_status_check
  check (status in ('encours', 'a_verifier', 'a_valider', 'valide', 'refuse'));
