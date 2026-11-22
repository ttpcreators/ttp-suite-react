-- TITRE : TTP Suite · Alfred : droits du serveur sur ses tables (2026-11-22)
-- ============================================================================
-- Trouvé au contrôle de santé du 22/11 : le serveur (rôle service_role, celui de la fonction
-- alfred-pont) n'avait aucun droit sur agent.evenements, agent.demandes et agent.skills_privees.
-- Le pont répondait sans erreur visible, mais avec des listes vides : les nouvelles de l'app,
-- les demandes « Demander à Alfred » et les skills privées n'arrivaient jamais à l'iMac.
-- Peut être relancé sans risque.
-- ============================================================================
grant usage on schema agent to service_role;
grant select, insert, update on agent.evenements to service_role;
grant select, insert, update on agent.demandes to service_role;
grant select, insert, update on agent.skills_privees to service_role;

-- Contrôle : 3 lignes, chacune INSERT,SELECT,UPDATE.
select table_name, string_agg(privilege_type, ',' order by privilege_type) droits
  from information_schema.role_table_grants
 where table_schema = 'agent' and grantee = 'service_role'
   and table_name in ('evenements', 'demandes', 'skills_privees')
 group by table_name order by table_name;
