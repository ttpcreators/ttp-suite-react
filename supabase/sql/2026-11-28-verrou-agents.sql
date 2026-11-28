-- ============================================================================
-- 2026-11-28 · Verrou des agents : validations annoncées, réglages des connexions, leçons
-- Titre Supabase : « Verrou · validation annoncée, journal des connexions, leçons confirmées »
-- ----------------------------------------------------------------------------
-- Relançable sans risque (add column if not exists, create or replace, drop trigger if exists).
-- L'app et ttp-mcp marchent avant et après ce SQL (repli quand une colonne manque). Ordre libre
-- avec la fusion et le déploiement de ttp-mcp.
--
-- Pourquoi (audit des 14 attaques du 28/11, contre-vérifié) :
--   • agent.action_validee annonçait « validé dans la page Agents » à Alfred dès qu'une
--     proposition passait « valide », même sans valideur (écriture faite côté serveur, sans
--     session) : seule une validation faite par un compte connecté doit être annoncée ;
--   • un changement de la case « agent autonome », du valideur ou de la coupure d'une connexion
--     Claude ne laissait une trace que s'il passait par connexion_claude_regler ;
--   • agent.lecons ne disait pas qui avait écrit une leçon, et toute leçon était présentée
--     « à respecter » aux agents, même écrite par un agent ou un Claude ;
--   • agent.journal et agent.memoire_createurs ne disaient pas quelle connexion avait écrit.
--
-- 1. agent.action_validee : l'évènement « valide_dans_app » seulement si valide_par est posé
--    (le déclencheur agent.action_validation le pose d'après la session, jamais le serveur).
-- 2. Déclencheur after update sur public.mcp_grants : tout changement de agent, valideur ou
--    revoked_at est noté dans agent.journal (« connexion_modifiee »), d'où qu'il vienne.
-- 3. agent.lecons.cree_par, grant_id, confirmee. Une leçon écrite dans l'app (session d'un
--    fondateur) est confirmée d'office ; écrite par le connecteur (serveur), elle attend sa
--    confirmation dans la page Agents, seul endroit qui peut la confirmer. Les leçons déjà là
--    restent confirmées. lire_agent ne présente « à respecter » que les leçons confirmées.
-- 4. agent.journal.grant_id et agent.memoire_createurs.grant_id : la connexion du connecteur
--    qui a écrit (posée par ttp-mcp ; vide pour une écriture de l'app).
--
-- Pas encore reporté dans SETUP.sql : le fichier daté fait foi.
-- ============================================================================

-- 1. Une validation n'est annoncée que si elle vient d'un compte connecté ---------------
create or replace function agent.action_validee() returns trigger
language plpgsql security definer set search_path = public, agent as $$
begin
  if new.statut = 'valide' and coalesce(old.statut, '') <> 'valide' and new.valide_par is not null then
    insert into agent.evenements (type, cible, detail, lien, auteur)
    values ('valide_dans_app', new.cible, coalesce(new.contexte, '') || ' [action ' || new.id || ']', '/?open=view&view=agent', agent.qui_agit());
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists alfred_action_validee on agent.actions;
create trigger alfred_action_validee after update on agent.actions
  for each row execute function agent.action_validee();
revoke execute on function agent.action_validee() from public, anon, authenticated;

-- 2. Journal de tout réglage d'une connexion Claude ------------------------------------
create or replace function public.mcp_grants_journal() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_qui text;
begin
  if new.agent is distinct from old.agent or new.valideur is distinct from old.valideur
     or new.revoked_at is distinct from old.revoked_at then
    begin
      select coalesce(nullif(btrim(p.display_name), ''), 'compte sans nom') into v_qui
        from public.profiles p where p.user_id = auth.uid();
      insert into agent.journal (action, detail)
      values ('connexion_modifiee', left(format('connexion %s (%s) : agent %s → %s, valideur %s → %s%s, par %s',
        left(old.id::text, 8), coalesce(nullif(btrim(old.client_name), ''), 'Claude'),
        old.agent, new.agent,
        coalesce(left(old.valideur::text, 8), 'aucun'), coalesce(left(new.valideur::text, 8), 'aucun'),
        case when new.revoked_at is distinct from old.revoked_at
             then case when new.revoked_at is null then ', rallumée' else ', coupée' end else '' end,
        coalesce(v_qui, case when auth.uid() is null then coalesce(nullif(auth.role(), ''), session_user::text) else 'compte inconnu' end)), 300));
    exception when others then
      null; -- le journal ne bloque jamais le réglage
    end;
  end if;
  return new;
end $$;
do $$
begin
  if to_regclass('public.mcp_grants') is not null then
    execute 'drop trigger if exists mcp_grants_journal on public.mcp_grants';
    execute 'create trigger mcp_grants_journal after update on public.mcp_grants for each row execute function public.mcp_grants_journal()';
  end if;
end $$;
revoke execute on function public.mcp_grants_journal() from public, anon, authenticated;

-- 3. Leçons : qui les écrit, et celles qui sont confirmées --------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'agent' and table_name = 'lecons' and column_name = 'confirmee') then
    -- Les leçons déjà là restent suivies (confirmées) ; les suivantes attendent leur confirmation.
    alter table agent.lecons add column confirmee boolean not null default true;
    alter table agent.lecons alter column confirmee set default false;
  end if;
end $$;
alter table agent.lecons
  add column if not exists cree_par uuid,
  add column if not exists grant_id uuid;
comment on column agent.lecons.confirmee is 'Leçon confirmée par un fondateur dans la page Agents (ou écrite par lui dans l''app) : seule une leçon confirmée est présentée « à respecter » aux agents (ttp-mcp, lire_agent)';
comment on column agent.lecons.grant_id is 'Connexion du connecteur (mcp_grants.id) qui a écrit la leçon ; null si écrite depuis l''app';

create or replace function agent.lecon_origine() returns trigger
language plpgsql set search_path = public, agent, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      -- Écrite dans l'app (la RLS la réserve aux fondateurs) : confirmée d'office.
      new.cree_par := auth.uid();
      new.grant_id := null;
      new.confirmee := true;
    else
      -- Écrite par le serveur (connecteur) : à confirmer dans la page Agents.
      new.confirmee := false;
    end if;
    return new;
  end if;
  new.cree_par := old.cree_par;
  new.grant_id := old.grant_id;
  -- Seule une session (un fondateur dans la page Agents) change la confirmation.
  if auth.uid() is null then
    new.confirmee := old.confirmee;
  end if;
  return new;
end $$;
drop trigger if exists alfred_lecon_origine on agent.lecons;
create trigger alfred_lecon_origine before insert or update on agent.lecons
  for each row execute function agent.lecon_origine();
revoke execute on function agent.lecon_origine() from public, anon, authenticated;

-- 4. Journal et mémoire : la connexion qui écrit ------------------------------------------
alter table agent.journal add column if not exists grant_id uuid;
alter table agent.memoire_createurs add column if not exists grant_id uuid;
comment on column agent.journal.grant_id is 'Connexion du connecteur (mcp_grants.id) qui a écrit l''entrée ; null si écrite depuis l''app ou par la base';
comment on column agent.memoire_createurs.grant_id is 'Connexion du connecteur (mcp_grants.id) qui a écrit la note ; null si écrite depuis l''app';

-- Contrôle (une ligne) : attendu « true · true · true · true · true · 0 »
--   (le dernier : aucune leçon déjà là ne devient « à confirmer »).
-- Essai ensuite avec un compte de test ZZZ seulement : une leçon notée par le connecteur
-- apparaît « proposée » dans la page Agents, et « Confirmer » la fait suivre.
select
  position('valide_par is not null' in pg_get_functiondef('agent.action_validee()'::regprocedure)) > 0           as annonce_ok,
  exists (select 1 from pg_trigger where tgname = 'mcp_grants_journal' and tgrelid = 'public.mcp_grants'::regclass) as journal_connexions_ok,
  (select count(*) from information_schema.columns
    where table_schema = 'agent' and table_name = 'lecons' and column_name in ('cree_par', 'grant_id', 'confirmee')) = 3 as lecons_ok,
  exists (select 1 from pg_trigger where tgname = 'alfred_lecon_origine' and tgrelid = 'agent.lecons'::regclass)  as lecon_origine_ok,
  (select count(*) from information_schema.columns
    where (table_schema, table_name, column_name) in (('agent', 'journal', 'grant_id'), ('agent', 'memoire_createurs', 'grant_id'))) = 2 as grant_ok,
  (select count(*) from agent.lecons where not confirmee and cree_le < now() - interval '1 hour')                as lecons_a_confirmer_anciennes;
