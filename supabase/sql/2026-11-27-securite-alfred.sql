-- ============================================================================
-- 2026-11-27 · Sécurité : validation dans l'app pour les agents autonomes (connecteur Claude)
-- ----------------------------------------------------------------------------
-- Relançable sans risque (add column if not exists, create or replace, drop trigger if exists).
-- Rien ne change tant qu'aucune connexion du connecteur n'est marquée « agent ».
--
-- 1. mcp_grants.agent : une connexion du connecteur (ttp-mcp) marquée « agent autonome »,
--    par la case de la page d'accord (app.ttpcreators.pro/connecteur/). Pour une telle
--    connexion, les envois et les actions irréversibles attendent une validation faite dans
--    l'app (ttp-mcp/verrou.ts). L'app ne peut toujours écrire que revoked_at (inchangé).
-- 2. agent.actions :
--    • valide_par, valide_le : posés par la base quand une proposition passe « valide » (page
--      Agents), d'après la session (auth.uid()). Null quand l'écriture vient du serveur : une
--      validation ne peut venir que d'un compte connecté à l'app ;
--    • outil : l'appel d'outil exact qu'un agent fait valider (proposer_action), qui ne change
--      plus ensuite.
-- 3. envoi_file.valide_le : date de validation d'un brouillon programmé par un agent,
--    revérifiée juste avant l'envoi.
--
-- Foldé dans SETUP.sql.
-- ============================================================================

-- 1. Connexion d'agent --------------------------------------------------------
do $$
begin
  if to_regclass('public.mcp_grants') is not null then
    alter table public.mcp_grants add column if not exists agent boolean not null default false;
    comment on column public.mcp_grants.agent is 'Connexion d''un agent autonome (Alfred) : envois et actions irréversibles validés dans l''app (ttp-mcp/verrou.ts)';
  end if;
end $$;

-- 2. Validations des propositions ---------------------------------------------
alter table agent.actions
  add column if not exists valide_par uuid,
  add column if not exists valide_le timestamptz,
  add column if not exists outil jsonb;

create or replace function agent.action_validation() returns trigger
  language plpgsql set search_path = public, agent, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    -- Une proposition déposée « validée » d'office ne compte jamais comme validée.
    new.valide_par := null;
    new.valide_le := null;
    return new;
  end if;
  new.outil := old.outil;
  if new.statut = 'valide' and old.statut is distinct from 'valide' then
    new.valide_par := auth.uid();
    new.valide_le := now();
  else
    new.valide_par := old.valide_par;
    new.valide_le := old.valide_le;
  end if;
  return new;
end $$;
drop trigger if exists alfred_action_validation on agent.actions;
create trigger alfred_action_validation before insert or update on agent.actions
  for each row execute function agent.action_validation();

-- 3. File d'envoi ---------------------------------------------------------------
do $$
begin
  if to_regclass('public.envoi_file') is not null then
    alter table public.envoi_file add column if not exists valide_le timestamptz;
  end if;
end $$;

-- Pour marquer à la main une connexion déjà créée (si la case n'a pas été cochée) :
--   select id, client_name, created_at, last_used_at from public.mcp_grants where revoked_at is null order by created_at desc;
--   update public.mcp_grants set agent = true where id = 'COLLE_ICI';

-- Contrôle (une ligne) : attendu « true · true · true · true · 0 » (0 tant qu'Alfred n'est pas reconnecté)
select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'mcp_grants' and column_name = 'agent')          as connexion_agent_ok,
  (select count(*) from information_schema.columns
    where table_schema = 'agent' and table_name = 'actions'
      and column_name in ('valide_par', 'valide_le', 'outil')) = 3                                         as validations_ok,
  exists (select 1 from pg_trigger
           where tgname = 'alfred_action_validation' and tgrelid = 'agent.actions'::regclass)             as declencheur_ok,
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'envoi_file' and column_name = 'valide_le')      as file_envoi_ok,
  (select count(*) from public.mcp_grants where agent)                                                     as connexions_agent;
