-- ════════════════════════════════════════════════════════════════════════════
-- Journal des bugs : « Marquer résolu » (2026-10-03). AJOUT uniquement, relançable.
-- L'agence voit les bugs (déjà en place) et peut maintenant les marquer résolus.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.error_log add column if not exists resolved_at timestamptz;
create index if not exists error_log_created_idx on public.error_log (created_at desc);

drop policy if exists error_log_agency_update on public.error_log;
create policy error_log_agency_update on public.error_log
  for update to authenticated using (public.is_agency()) with check (public.is_agency());
