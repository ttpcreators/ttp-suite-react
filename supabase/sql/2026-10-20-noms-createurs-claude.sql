-- ============================================================================
-- 2026-10-20 : remet le nom EXACT du créateur sur les tâches et rendez-vous
-- créés par le connecteur Claude avant le correctif (il écrivait le nom en
-- minuscules : « léa martin » au lieu de « LÉA MARTIN »). L'app et la RLS
-- comparent le nom exact : ces lignes étaient invisibles dans l'espace créateur.
-- Données seulement, aucun changement de schéma. Peut être relancé sans risque.
-- ============================================================================

update public.todos t
   set creator = c.name
  from public.creators c
 where lower(t.creator) = lower(c.name)
   and t.creator <> c.name;

-- Rendez-vous : seulement ceux qui concernent UN créateur (pas les listes « A, B »).
update public.events e
   set who = c.name
  from public.creators c
 where lower(e.who) = lower(c.name)
   and e.who <> c.name;

-- Contrôle : nombre de lignes encore mal écrites (doit afficher 0 et 0).
select
  (select count(*) from public.todos t join public.creators c on lower(t.creator) = lower(c.name) where t.creator <> c.name) as taches_a_corriger,
  (select count(*) from public.events e join public.creators c on lower(e.who) = lower(c.name) where e.who <> c.name) as rdv_a_corriger;
