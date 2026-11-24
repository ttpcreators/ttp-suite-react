-- ============================================================================
-- 2026-11-24 : choix de Marc, les tâches d'Alfred (et du connecteur Claude, étiquette
-- « Claude · … ») sont visibles par les créateurs qu'elles citent, telles quelles
-- (titre et détails) : « ça fait sérieux et impliqué dans mon travail ».
-- Restent internes : les rappels automatiques des collabs et les rendez-vous « Tâche : … ».
-- Titre Supabase : « Tâches d'Alfred visibles »
-- Relançable sans risque.
-- ============================================================================
update public.todos set visible_createur = true
 where source = 'agency' and not visible_createur and tag like 'Claude%'
   and (cardinality(creators) > 0 or creator is not null);
