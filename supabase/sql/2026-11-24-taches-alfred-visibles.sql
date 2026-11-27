-- ============================================================================
-- 2026-11-24 : choix de Marc, les tâches d'Alfred (et du connecteur Claude, étiquette
-- « Claude · … ») sont visibles par les créateurs qu'elles citent, telles quelles
-- (titre et détails) : « ça fait sérieux et impliqué dans mon travail ».
-- Restent internes : les rappels automatiques des collabs et les rendez-vous « Tâche : … ».
-- Titre Supabase : « Tâches d'Alfred visibles »
--
-- NE PAS RELANCER (exécuté le 24/11). C'était un rattrapage unique des anciennes tâches.
-- Depuis, Alfred garde exprès certaines tâches internes (commission, autre créateur,
-- conflit) : relancé tel quel, ce script les rendrait visibles. La mise à jour est donc
-- neutralisée (« where false », audit du 27/11, point C9) : relancé, il ne touche rien.
-- Pour rendre visible une tâche précise : la case « Visible par … » de sa fiche, dans To-do.
-- ============================================================================
update public.todos set visible_createur = true
 where false -- neutralisé le 27/11 ; filtre d'origine gardé pour l'historique :
   and source = 'agency' and not visible_createur and tag like 'Claude%'
   and (cardinality(creators) > 0 or creator is not null);
