-- ============================================================================
-- 2026-11-24 (correction de « Tâches internes privées ») : les tâches écrites À LA
-- MAIN par l'agence pour un créateur (étiquette CRÉATEUR, ou PERSO ajoutée depuis son
-- espace) redeviennent visibles par lui. Bug : la to-do d'une créatrice était vide
-- (« Aucune tâche ») alors que Marc lui avait écrit des tâches.
-- Restent internes : les tâches d'Alfred et du connecteur (étiquette « Claude · … »)
-- et les rappels automatiques des collabs (« Résumer le brief pour… », etc.).
-- Note du 27/11 : pour les tâches d'Alfred, remplacé par « Tâches d'Alfred visibles »
-- (24/11, 2026-11-24-taches-alfred-visibles.sql) : elles sont visibles par défaut.
-- Titre Supabase : « Tâches écrites à la main visibles »
--
-- NE PAS RELANCER (exécuté le 24/11). C'était un rattrapage unique : relancé tel quel, il
-- republierait une tâche écrite à la main que l'agence a rendue interne depuis. La mise à
-- jour est donc neutralisée (« where false », audit du 27/11, point C9) : relancé, il ne
-- touche rien.
-- ============================================================================
update public.todos set visible_createur = true
 where false -- neutralisé le 27/11 ; filtre d'origine gardé pour l'historique :
   and source = 'agency' and not visible_createur and tag in ('CRÉATEUR', 'PERSO')
   and (cardinality(creators) > 0 or creator is not null)
   and text !~* '^(Résumer le brief pour|Relancer .+ pour (le contenu|le paiement)|Envoyer le contenu à .+ pour validation|Relever les stats à 7 jours|Créer la facture|Reverser |Préparer le bilan pour)';
