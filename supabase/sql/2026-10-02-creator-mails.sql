-- ════════════════════════════════════════════════════════════════════════════
-- Section « Mails » de l'Espace Créateur (2026-10-02). AJOUT uniquement.
-- Idempotent : peut être relancé sans risque. À lancer dans le SQL Editor.
--
-- Principe : les mails restent dans Gmail (boîte talents@, lecture seule côté
-- serveur). La base ne stocke QUE : le réglage par créatrice (alias, libellé,
-- section activée), le statut de chaque fil (défini par l'agence) et les notes
-- « Écrire à mon manager ». Aucun contenu de mail n'est stocké.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Réglage par créatrice : alias Gmail + libellé manuel facultatif + activation.
create table if not exists public.creator_mail_settings (
  creator     text primary key,                 -- = creators.name (même clé que my_creator())
  alias       text,                             -- ex. lea@ttpcreators.pro
  label_id    text,                             -- id du libellé Gmail « Créatrices/Léa » (facultatif)
  label_name  text,
  enabled     boolean not null default false,   -- la créatrice voit l'onglet « Mails »
  updated_at  timestamptz not null default now()
);
alter table public.creator_mail_settings enable row level security;
drop policy if exists creator_mail_settings_agency on public.creator_mail_settings;
create policy creator_mail_settings_agency on public.creator_mail_settings for all to authenticated
  using (public.is_agency()) with check (public.is_agency());
drop policy if exists creator_mail_settings_own on public.creator_mail_settings;
create policy creator_mail_settings_own on public.creator_mail_settings for select to authenticated
  using (creator = public.my_creator());

-- 2) Statut d'un fil pour une créatrice (défini par l'agence). Pas de ligne = « Nouvelle demande ».
create table if not exists public.creator_mail_threads (
  creator     text not null,
  thread_id   text not null,
  status      text not null default 'nouvelle'
              check (status in ('nouvelle', 'negociation', 'valide', 'refuse')),
  brand       text,                             -- nom de marque corrigé à la main (facultatif)
  updated_at  timestamptz not null default now(),
  primary key (creator, thread_id)
);
alter table public.creator_mail_threads enable row level security;
drop policy if exists creator_mail_threads_agency on public.creator_mail_threads;
create policy creator_mail_threads_agency on public.creator_mail_threads for all to authenticated
  using (public.is_agency()) with check (public.is_agency());
drop policy if exists creator_mail_threads_own on public.creator_mail_threads;
create policy creator_mail_threads_own on public.creator_mail_threads for select to authenticated
  using (creator = public.my_creator());

-- 3) Notes « Écrire à mon manager » (jamais envoyées à la marque).
--    AUCUNE écriture directe pour une créatrice : l'insertion passe par la fonction
--    serveur creator-mail, qui vérifie d'abord que le fil lui appartient.
create table if not exists public.creator_mail_notes (
  id              uuid primary key default gen_random_uuid(),
  creator         text not null,
  thread_id       text not null,
  author_user_id  uuid,
  body            text not null check (char_length(body) between 1 and 4000),
  created_at      timestamptz not null default now(),
  agency_read_at  timestamptz
);
create index if not exists creator_mail_notes_thread_idx on public.creator_mail_notes (creator, thread_id, created_at);
alter table public.creator_mail_notes enable row level security;
drop policy if exists creator_mail_notes_agency_read on public.creator_mail_notes;
create policy creator_mail_notes_agency_read on public.creator_mail_notes for select to authenticated
  using (public.is_agency());
drop policy if exists creator_mail_notes_agency_update on public.creator_mail_notes;
create policy creator_mail_notes_agency_update on public.creator_mail_notes for update to authenticated
  using (public.is_agency()) with check (public.is_agency());
drop policy if exists creator_mail_notes_own on public.creator_mail_notes;
create policy creator_mail_notes_own on public.creator_mail_notes for select to authenticated
  using (creator = public.my_creator());
