-- ════════════════════════════════════════════════════════════════════════════
-- TTP Suite · Le rôle ttp_agent ne peut plus se connecter (2026-11-27)
-- Le rôle Postgres ttp_agent (agent · phase 5, sql/2026-09-27-agent-role.sql) avait une
-- connexion directe à la base, avec un mot de passe gardé hors du dépôt. Aucun code du dépôt
-- ne s'y connecte : Alfred et Claude passent par le connecteur ttp-mcp. Sa connexion est donc
-- coupée. Ses droits et ses règles sur les schémas agent et agent_lecture restent en place :
-- sans connexion, personne ne peut s'en servir.
-- Déjà appliqué en prod le 27/11/2026 à 15 h 35 UTC (16 h 35 à Paris), migration
-- ttp_agent_sans_connexion_2026_11_27, avec la même instruction. Ce fichier en garde la trace.
-- Pas encore reporté dans SETUP.sql (bloc « AGENT · droits du rôle ttp_agent ») : en attendant,
-- ce fichier fait foi. Base recréée de zéro : le lancer APRÈS 2026-09-27-agent-role.sql, qui
-- recrée le rôle avec connexion. Relancer agent-role.sql sur la prod ne rouvre rien : il ne
-- recrée pas un rôle qui existe déjà.
-- Rouvrir la connexion (alter role ttp_agent login password '…') : seulement sur décision de
-- Marc, jamais avec un mot de passe écrit dans un fichier.
-- Relançable sans risque : ne fait rien si le rôle n'existe pas.
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'ttp_agent') then
    alter role ttp_agent nologin;
  end if;
end $$;

-- Contrôle : une ligne « ttp_agent · false » attendue (aucune ligne : rôle absent, rien à couper).
select rolname, rolcanlogin from pg_roles where rolname = 'ttp_agent';
