-- ============================================================================
-- 2026-11-24 : journal du connecteur Claude, raison d'un appel raté (audit du 24/11, M1)
-- ----------------------------------------------------------------------------
-- `mcp_log` gardait la demande (summary) et « réussi ou non » (ok), pas la raison de
-- l'échec. Nouvelle colonne `error` : le message renvoyé à Claude quand un outil échoue,
-- sur une ligne, 400 caractères au plus (ttp-mcp/tools.ts, _shared/mcpJournal.ts).
-- Rien ne change pour les droits : chaque compte lit toujours son propre journal.
-- Avant ce SQL, ttp-mcp écrit la ligne sans la raison (repli). Sans risque à relancer.
-- ============================================================================
alter table public.mcp_log add column if not exists error text;

comment on column public.mcp_log.error is 'Raison d''un appel raté (message renvoyé à Claude), null si réussi';

-- Les échecs récents se lisent d'un coup.
create index if not exists mcp_log_echecs_idx on public.mcp_log (at desc) where not ok;

notify pgrst, 'reload schema';

-- Contrôle : 1 · 1
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'mcp_log' and column_name = 'error') as colonne_1,
  (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'mcp_log_echecs_idx') as index_1;
