-- ============================================================================
-- 2026-11-25 : sécurité, les visiteurs anonymes n'appellent plus les fonctions de déclencheur.
-- Audit du 24/11, point M27 (« ok fais » de Gianni du 25/11).
-- ----------------------------------------------------------------------------
-- Le contrôle de sécurité de Supabase signale 23 fonctions « SECURITY DEFINER » appelables
-- par le rôle anon. Toutes sont des fonctions de déclencheur (elles renvoient « trigger ») :
-- un déclencheur s'exécute sans regarder ce droit, donc le retirer ne change rien au
-- fonctionnement de l'app, et un visiteur anonyme ne peut plus les appeler par l'API.
-- Les 4 fonctions qui ne sont pas des déclencheurs (is_agency, is_founder, my_creator,
-- agent.qui_agit) gardent ce droit : la RLS et les vues publiques des media kits s'en
-- servent, et pour un anonyme elles répondent seulement « non » ou rien.
-- Relançable sans risque. Pas de retour arrière nécessaire ; sinon :
--   grant execute on function <nom>() to anon;
-- ============================================================================

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and n.nspname in ('public', 'agent')
      and pg_get_function_result(p.oid) = 'trigger'
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke execute on function %s from anon, public', f.sig);
  end loop;
end $$;

-- Contrôle : 0 fonction de déclencheur encore appelable par anon.
select count(*) as declencheurs_anon
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef and n.nspname in ('public', 'agent')
  and pg_get_function_result(p.oid) = 'trigger'
  and has_function_privilege('anon', p.oid, 'execute');
