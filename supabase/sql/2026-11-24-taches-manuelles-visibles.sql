-- ============================================================================
-- 2026-11-24 (correction de « Tâches internes privées ») : les tâches écrites À LA
-- MAIN par l'agence pour un créateur (étiquette CRÉATEUR, ou PERSO ajoutée depuis son
-- espace) redeviennent visibles par lui. Bug : la to-do d'une créatrice était vide
-- (« Aucune tâche ») alors que Marc lui avait écrit des tâches.
-- Restent internes : les tâches d'Alfred et du connecteur (étiquette « Claude · … »)
-- et les rappels automatiques des collabs (« Résumer le brief pour… », etc.).
-- Titre Supabase : « Tâches écrites à la main visibles »
-- Relançable sans risque.
-- ============================================================================
update public.todos set visible_createur = true
 where source = 'agency' and not visible_createur and tag in ('CRÉATEUR', 'PERSO')
   and (cardinality(creators) > 0 or creator is not null)
   and text !~* '^(Résumer le brief pour|Relancer .+ pour (le contenu|le paiement)|Envoyer le contenu à .+ pour validation|Relever les stats à 7 jours|Créer la facture|Reverser |Préparer le bilan pour)';
