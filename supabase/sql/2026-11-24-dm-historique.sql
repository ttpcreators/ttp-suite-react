-- TITRE : TTP Suite · DM Instagram : date du premier message (2026-11-24)
-- ============================================================================
-- Plan « MCP TTP autonomie » : import de TOUT l'historique des DM de @ttpcreators
-- (action « backfill » de ig-inbox, outil Claude importer_historique_instagram,
-- _shared/igHistoriqueDb.ts). Pour chaque conversation, on garde aussi la date du
-- premier message : nouvelle colonne ig_threads.first_at.
-- Avant ce SQL, l'import marche déjà (sans cette date) et le dit dans sa réponse.
-- Ordre conseillé : ce SQL, puis le déploiement de ig-inbox et ttp-mcp.
-- Relançable sans risque. Contrôle en fin de fichier.
-- ============================================================================

alter table public.ig_threads add column if not exists first_at timestamptz;

-- Reprise : pour les conversations déjà là, le plus ancien message connu (au plus 20 par
-- conversation chez Meta : c'est une date approchée pour les longues conversations).
update public.ig_threads t
   set first_at = m.premier
  from (select thread_id, min(at) as premier from public.ig_messages group by thread_id) m
 where m.thread_id = t.id and t.first_at is null;

-- Contrôle.
select count(*) as conversations, count(first_at) as avec_premier_message, min(first_at) as plus_ancien
  from public.ig_threads;
