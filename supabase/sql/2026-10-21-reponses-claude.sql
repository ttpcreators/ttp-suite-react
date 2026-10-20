-- ============================================================================
-- 2026-10-21 : réponses de mails préparées par Claude (connecteur TTP Suite, avec
-- l'abonnement Claude : aucune clé API payante). Claude dépose le texte avec l'outil
-- « preparer_reponse_mail » ; la page Mails l'insère dans la zone de réponse du fil.
-- Rien n'est jamais envoyé tout seul. Agence seulement (RLS). Déjà foldé dans SETUP.sql.
-- Peut être relancé sans risque.
-- ============================================================================
create table if not exists public.mail_reply_drafts (
  id         uuid primary key default gen_random_uuid(),
  thread_id  text not null,
  box        text not null,
  body       text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  used_at    timestamptz
);
create index if not exists mail_reply_drafts_thread_idx on public.mail_reply_drafts (thread_id, created_at desc);
alter table public.mail_reply_drafts enable row level security;
revoke all on public.mail_reply_drafts from anon;
drop policy if exists mail_reply_drafts_agency on public.mail_reply_drafts;
create policy mail_reply_drafts_agency on public.mail_reply_drafts for all to authenticated
  using (public.is_agency()) with check (public.is_agency());

-- Contrôle : doit afficher « mail_reply_drafts · RLS : true ».
select relname as table_name, 'RLS : ' || relrowsecurity as securite
  from pg_class where relname = 'mail_reply_drafts';
