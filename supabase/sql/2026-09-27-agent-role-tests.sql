-- ============================================================================
-- AGENT · PHASE 5 — tests de sécurité du rôle ttp_agent
-- Titre Supabase : « Agent · Phase 5 · tests sécurité ttp_agent »
-- ============================================================================
-- S'exécute dans le SQL Editor (en postgres) mais BASCULE en ttp_agent via
-- SET LOCAL ROLE : chaque test s'exécute donc avec les droits réels de l'agent.
-- Résultats dans les NOTICE (onglet messages/résultats) — à coller à Claude.
-- Ne modifie rien d'existant (le seul INSERT va dans agent.journal, l'espace
-- de l'agent, et y reste comme trace du test).
-- ============================================================================

do $$
declare n int;
begin
  set local role ttp_agent;
  raise notice '— Tests exécutés en tant que : % —', current_user;

  -- 1) Lire une vue agent_lecture (attendu : OK)
  begin
    select count(*) into n from agent_lecture.creatrices;
    raise notice '1. lire agent_lecture.creatrices : ✅ OK (% lignes)', n;
  exception when others then
    raise notice '1. lire agent_lecture.creatrices : ❌ PROBLÈME — refusé (%: %)', sqlstate, sqlerrm;
  end;

  -- 2) Lire les collabs + étapes (attendu : OK)
  begin
    select count(*) into n from agent_lecture.collabs;
    raise notice '2. lire agent_lecture.collabs : ✅ OK (% lignes)', n;
  exception when others then
    raise notice '2. lire agent_lecture.collabs : ❌ PROBLÈME — refusé (%: %)', sqlstate, sqlerrm;
  end;

  -- 3) Lire les échéances extraites du blob (attendu : OK)
  begin
    select count(*) into n from agent_lecture.echeances;
    raise notice '3. lire agent_lecture.echeances : ✅ OK (% lignes)', n;
  exception when others then
    raise notice '3. lire agent_lecture.echeances : ❌ PROBLÈME — refusé (%: %)', sqlstate, sqlerrm;
  end;

  -- 4) Écrire dans agent.journal (attendu : OK)
  begin
    insert into agent.journal (action, detail) values ('test_securite_phase5', 'insert de test');
    raise notice '4. écrire dans agent.journal : ✅ OK';
  exception when others then
    raise notice '4. écrire dans agent.journal : ❌ PROBLÈME — refusé (%: %)', sqlstate, sqlerrm;
  end;

  -- 5) Mettre à jour dans agent.journal (attendu : OK)
  begin
    update agent.journal set detail = 'insert de test (mis à jour)' where action = 'test_securite_phase5';
    raise notice '5. mettre à jour agent.journal : ✅ OK';
  exception when others then
    raise notice '5. mettre à jour agent.journal : ❌ PROBLÈME — refusé (%: %)', sqlstate, sqlerrm;
  end;

  -- 6) Lire une table de public (attendu : REFUS)
  begin
    select count(*) into n from public.creators;
    raise notice '6. lire public.creators : ❌ PROBLÈME — la lecture a réussi (% lignes)', n;
  exception when others then
    raise notice '6. lire public.creators : ✅ refusé comme prévu (%)', sqlstate;
  end;

  -- 7) Lire le blob brut module_rows (attendu : REFUS)
  begin
    select count(*) into n from public.module_rows;
    raise notice '7. lire public.module_rows (blob) : ❌ PROBLÈME — la lecture a réussi', n;
  exception when others then
    raise notice '7. lire public.module_rows (blob) : ✅ refusé comme prévu (%)', sqlstate;
  end;

  -- 8) Lire auth.users (attendu : REFUS)
  begin
    select count(*) into n from auth.users;
    raise notice '8. lire auth.users : ❌ PROBLÈME — la lecture a réussi', n;
  exception when others then
    raise notice '8. lire auth.users : ✅ refusé comme prévu (%)', sqlstate;
  end;

  -- 9) Lire une colonne sensible (attendu : REFUS — la colonne n'existe pas dans la vue)
  begin
    execute 'select birth from agent_lecture.creatrices limit 1';
    raise notice '9. colonne sensible birth via la vue : ❌ PROBLÈME — accessible';
  exception when others then
    raise notice '9. colonne sensible birth via la vue : ✅ inexistante/refusée comme prévu (%)', sqlstate;
  end;

  -- 10) Supprimer une ligne (attendu : REFUS — pas de DELETE)
  begin
    delete from agent.journal where action = 'test_securite_phase5';
    raise notice '10. delete dans agent.journal : ❌ PROBLÈME — la suppression a réussi';
  exception when others then
    raise notice '10. delete dans agent.journal : ✅ refusé comme prévu (%)', sqlstate;
  end;

  -- 11) Mémoire créatrices : catégorie interdite (attendu : REFUS — contrainte)
  begin
    insert into agent.memoire_createurs (creatrice, categorie, info)
      values ('ZZZ-test', 'sante', 'ne doit jamais passer');
    raise notice '11. mémoire catégorie interdite : ❌ PROBLÈME — l''insert a réussi';
  exception when others then
    raise notice '11. mémoire catégorie interdite : ✅ refusé comme prévu (%)', sqlstate;
  end;

  raise notice '— Fin des tests —';
end $$;
