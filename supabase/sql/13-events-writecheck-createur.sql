-- ============================================================================
-- 13-events-writecheck-createur.sql
-- ----------------------------------------------------------------------------
-- Durcissement RLS (audit agence↔créateur) : le WITH CHECK de events_scoped
-- exigeait seulement que le nom du créateur SOIT PRÉSENT dans `who`, pas qu'il
-- y soit SEUL. Un créateur authentifié pouvait donc, via l'API REST (hors UI),
-- écrire un évènement nommant AUSSI un autre créateur (who = 'Moi, Victime') et
-- l'injecter dans le planning d'autrui.
--
-- Correctif : en ÉCRITURE (with check), on impose l'égalité stricte who = son
-- nom (l'UI n'assigne de toute façon qu'un seul créateur). En LECTURE (using),
-- on garde string_to_array pour qu'un créateur puisse toujours LIRE un évènement
-- multi-noms créé par l'agence.
--
-- À exécuter une fois sur la base live (SQL Editor). Aucun impact sur l'usage
-- normal de l'app (l'espace créateur code déjà who = son nom).
-- ============================================================================

drop policy if exists events_scoped on public.events;

create policy events_scoped on public.events for all to authenticated
  using       (public.is_agency() or public.my_creator() = any(string_to_array(coalesce(who, ''), ', ')))
  with check  (public.is_agency() or who = public.my_creator());

-- Vérifier :  select policyname, cmd, with_check from pg_policies where tablename = 'events';
