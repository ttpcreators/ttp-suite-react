-- ════════════════════════════════════════════════════════════════════════════
-- Mails créatrices : HISTORIQUE des statuts (2026-10-03). AJOUT uniquement.
-- Idempotent : peut être relancé sans risque. À lancer dans le SQL Editor.
--
-- Chaque fois que la créatrice ou l'agence range un échange dans « En cours »,
-- « Validé » ou « Refusé », une ligne est ajoutée ici : qui, quand, et son mot
-- (facultatif). C'est la trace des avis, affichée dans le « Suivi » de l'échange.
--
-- Écriture :
--   - créatrice : JAMAIS directe. La fonction creator-mail vérifie d'abord que
--     l'échange est à elle, puis ajoute la ligne ;
--   - agence : directe, uniquement en son propre nom (by_role 'agency', auteur = soi).
-- Aucune modification ni suppression : l'historique est une trace.
-- Aucun contenu de mail n'est stocké (seulement l'identifiant du fil Gmail).
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.creator_mail_status_log (
  id              uuid primary key default gen_random_uuid(),
  creator         text not null,                    -- = creators.name (même clé que my_creator())
  thread_id       text not null,                    -- identifiant du fil Gmail
  status          text not null check (status in ('encours', 'valide', 'refuse')),
  by_role         text not null check (by_role in ('creator', 'agency')),
  author_user_id  uuid,
  comment         text check (comment is null or char_length(comment) between 1 and 1000),
  created_at      timestamptz not null default now()
);
create index if not exists creator_mail_status_log_thread_idx
  on public.creator_mail_status_log (creator, thread_id, created_at);
alter table public.creator_mail_status_log enable row level security;

-- Lecture : l'agence voit tout, la créatrice uniquement ses lignes.
drop policy if exists creator_mail_status_log_read on public.creator_mail_status_log;
create policy creator_mail_status_log_read on public.creator_mail_status_log for select to authenticated
  using (public.is_agency() or creator = public.my_creator());

-- Ajout direct : agence uniquement, en son propre nom.
drop policy if exists creator_mail_status_log_agency_insert on public.creator_mail_status_log;
create policy creator_mail_status_log_agency_insert on public.creator_mail_status_log for insert to authenticated
  with check (public.is_agency() and by_role = 'agency' and author_user_id = auth.uid());
