-- ============================================================================
-- AGENT · PHASE 5 — rôle Postgres ttp_agent (droits minimaux)
-- Titre Supabase : « Agent · Phase 5 · rôle ttp_agent »
-- ============================================================================
-- Le rôle avec lequel l'agent IA se connecte à la base. La BASE elle-même
-- impose ses limites (pas une consigne donnée à l'agent) :
--   • SELECT sur les vues du schéma agent_lecture (données curées, sans sensible) ;
--   • SELECT + INSERT + UPDATE sur les tables du schéma agent. PAS de DELETE ;
--   • aucun droit sur public, sur auth, ni sur le Storage ;
--   • jamais la clé service_role : c'est une connexion Postgres directe.
--
-- 🔑 MOT DE PASSE : remplacer REMPLACE_MOI ci-dessous AVANT de lancer (le mot
--    de passe est remis à Marc hors dépôt ; ce fichier n'en contient jamais).
--    ⚠️ Ne PAS enregistrer la requête dans Supabase avec le vrai mot de passe :
--    lancer, puis effacer l'éditeur (ou enregistrer avec le placeholder).
--
-- ➕ AJOUT PUR et idempotent : ne touche aucune donnée. Si le rôle existe déjà,
--    il n'est pas recréé (changer le mot de passe : alter role ttp_agent password '…').
-- ============================================================================

-- 1) Le rôle -----------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ttp_agent') then
    create role ttp_agent login password 'REMPLACE_MOI'
      nosuperuser nocreatedb nocreaterole noreplication
      connection limit 5;
  end if;
end $$;
-- Garde-fous d'exécution : requêtes bornées, pas de transactions qui traînent.
alter role ttp_agent set statement_timeout = '30s';
alter role ttp_agent set idle_in_transaction_session_timeout = '60s';

-- 2) Lecture : les vues agent_lecture -----------------------------------------
grant usage on schema agent_lecture to ttp_agent;
grant select on all tables in schema agent_lecture to ttp_agent;
alter default privileges in schema agent_lecture grant select on tables to ttp_agent;

-- 3) Écriture : les tables du schéma agent (PAS de DELETE) --------------------
grant usage on schema agent to ttp_agent;
grant select, insert, update on all tables in schema agent to ttp_agent;
alter default privileges in schema agent grant select, insert, update on tables to ttp_agent;

-- 4) Policies RLS pour ttp_agent sur agent.* ----------------------------------
-- La RLS est activée sur ces tables (Phase 4) : sans policies dédiées, le rôle
-- ne verrait aucune ligne. On lui ouvre EXACTEMENT select / insert / update
-- (le DELETE reste doublement fermé : ni privilège, ni policy).
do $$
declare t text;
begin
  foreach t in array array['cockpits','actions','prospects','cercle','memoire_createurs','lecons','journal']
  loop
    execute format('drop policy if exists %I_ttp_agent_sel on agent.%I;', t, t);
    execute format('drop policy if exists %I_ttp_agent_ins on agent.%I;', t, t);
    execute format('drop policy if exists %I_ttp_agent_upd on agent.%I;', t, t);
    execute format('create policy %I_ttp_agent_sel on agent.%I for select to ttp_agent using (true);', t, t);
    execute format('create policy %I_ttp_agent_ins on agent.%I for insert to ttp_agent with check (true);', t, t);
    execute format('create policy %I_ttp_agent_upd on agent.%I for update to ttp_agent using (true) with check (true);', t, t);
  end loop;
end $$;

-- 5) Fermetures explicites (ceinture et bretelles) -----------------------------
-- public : aucune table accordée (l'USAGE hérité du pseudo-rôle PUBLIC ne donne
-- accès à rien sans GRANT sur les tables). auth/storage : aucun usage.
revoke all on all tables in schema public from ttp_agent;
revoke create on schema public from ttp_agent;

-- ============================================================================
-- Après application : lancer le fichier de TESTS
-- (2026-09-27-agent-role-tests.sql) et coller le résultat des NOTICE à Claude.
-- ============================================================================
