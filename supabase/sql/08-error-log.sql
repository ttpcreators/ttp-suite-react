-- ============================================================================
-- 08-error-log.sql
-- ----------------------------------------------------------------------------
-- Journal des crashs de rendu (remontés par l'ErrorBoundary → Edge Function
-- report-error). L'agence reçoit une notif push à la 1re occurrence ; tout est
-- tracé ici pour diagnostic.
--
-- Écriture : uniquement via report-error (service role, bypass RLS).
-- Lecture  : réservée à l'agence.
--
-- À exécuter une fois sur la base live (SQL Editor).
-- ============================================================================

create table if not exists public.error_log (
  id              uuid primary key default gen_random_uuid(),
  message         text,
  page            text,
  stack           text,
  component_stack text,
  url             text,
  user_agent      text,
  role            text,
  created_at      timestamptz default now()
);

alter table public.error_log enable row level security;

-- Lecture agence uniquement (aucune policy d'écriture → seul le service role écrit).
drop policy if exists error_log_agency_read on public.error_log;
create policy error_log_agency_read on public.error_log
  for select to authenticated using (public.is_agency());

-- Consulter les derniers bugs :
--   select created_at, page, message, url from public.error_log order by created_at desc limit 50;
