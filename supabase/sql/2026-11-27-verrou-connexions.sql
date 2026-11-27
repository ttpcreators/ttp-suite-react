-- ============================================================================
-- 2026-11-27 · Verrou des agents et file d'envoi : qui propose, qui valide, connexions Claude
-- Titre Supabase : « Verrou · connexions Claude, origine des propositions, file d'envoi »
-- ----------------------------------------------------------------------------
-- Relançable sans risque (add column if not exists, create or replace, alter policy, revoke).
-- Aucun réglage ne change tant qu'un fondateur ne touche à rien : aucune connexion n'est
-- cochée « agent », aucun valideur n'est choisi.
--
-- Pourquoi (enquête du 27/11 sur les connexions Claude et la file d'envoi, contre-vérifiée,
-- puis deux relectures) :
--   • agent.actions ne disait pas quelle connexion avait fait une proposition : celles
--     d'Alfred et des Claude des fondateurs étaient mélangées ;
--   • un fondateur ne voyait que ses propres connexions (RLS de mcp_grants) : ni celle d'un
--     autre compte, ni la case « agent », ni de quoi la couper sans SQL ;
--   • le rôle authenticated gardait TRUNCATE, TRIGGER et REFERENCES (et MAINTAIN, Postgres 17)
--     sur mcp_log, le journal du connecteur, et sur mcp_grants ;
--   • juste avant un envoi de la file, seul le brouillon était revérifié, pas la validation ;
--     et une case « agent » cochée après la programmation ne valait pas pour la file ;
--   • une connexion coupée pouvait être rallumée par son propriétaire (revoked_at remis à vide
--     par l'API, la règle acceptait toute valeur), et ses jetons restaient valables.
--
-- 1. agent.actions.cree_par (compte) et grant_id (connexion du connecteur) : posés par le
--    serveur (proposer_action, d'après le jeton). Le déclencheur agent.action_validation les
--    fige : une proposition écrite depuis l'app prend le compte connecté et aucune connexion,
--    et ni l'un ni l'autre ne change ensuite.
-- 2. mcp_grants.valideur : le seul compte dont la validation compte pour cette connexion
--    d'agent (null = tout fondateur, comme avant). Lu par ttp-mcp/verrou.ts.
-- 3. envoi_file.proposition : la proposition validée d'un brouillon programmé par un agent,
--    relue juste avant l'envoi (validation retirée ou écartée : le mail ne part pas).
--    envoi_file.grant_id : la connexion qui a programmé l'envoi (programmer_envoi), relue juste
--    avant l'envoi : cochée « agent autonome » depuis, une ligne sans validation ne part pas ;
--    valideur choisi depuis, seule sa validation compte. Les lignes programmées avant ce SQL et
--    le déploiement de ttp-mcp n'ont pas de connexion notée : elles partent comme avant.
-- 4. public.connexions_claude() et public.connexion_claude_regler(id, reglage) : la page
--    Paramètres › Connexions Claude et la page Agents (fondateurs seulement, SECURITY
--    DEFINER, search_path fixé). Elles ne lisent jamais mcp_tokens ; couper une connexion
--    révoque aussi ses jetons (écriture seule). Chaque réglage est noté dans agent.journal
--    (« connexion_reglee »).
-- 5. authenticated, anon : plus de TRUNCATE, TRIGGER, REFERENCES ni MAINTAIN sur mcp_log et
--    mcp_grants. Lire ses propres lignes et couper ses propres connexions : inchangé.
-- 6. Règle mcp_grants_own_revoke : son propriétaire peut toujours couper sa connexion, mais
--    plus remettre revoked_at à vide (une connexion coupée le reste).
--
-- L'app et ttp-mcp marchent avant et après ce SQL (repli quand une colonne ou une fonction
-- manque). Ordre libre avec la fusion et le déploiement de ttp-mcp.
-- Pas encore reporté dans SETUP.sql : le fichier daté fait foi.
-- ============================================================================

-- 1. Qui a fait la proposition --------------------------------------------------
alter table agent.actions
  add column if not exists cree_par uuid,
  add column if not exists grant_id uuid;
comment on column agent.actions.cree_par is 'Compte qui a déposé la proposition (connecteur : le compte du jeton ; app : la session)';
comment on column agent.actions.grant_id is 'Connexion du connecteur (mcp_grants.id) qui a déposé la proposition ; null si écrite depuis l''app';

-- Même déclencheur que le SQL 2026-11-27-securite-alfred, plus le compte et la connexion.
create or replace function agent.action_validation() returns trigger
  language plpgsql set search_path = public, agent, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    -- Une proposition déposée « validée » d'office ne compte jamais comme validée.
    new.valide_par := null;
    new.valide_le := null;
    -- Écrite depuis l'app (session) : le compte connecté, jamais une connexion du connecteur.
    if auth.uid() is not null then
      new.cree_par := auth.uid();
      new.grant_id := null;
    end if;
    return new;
  end if;
  new.outil := old.outil;
  new.cree_par := old.cree_par;
  new.grant_id := old.grant_id;
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

-- 2. Qui valide pour une connexion d'agent ----------------------------------------
do $$
begin
  if to_regclass('public.mcp_grants') is not null then
    alter table public.mcp_grants add column if not exists agent boolean not null default false;
    alter table public.mcp_grants add column if not exists valideur uuid;
    comment on column public.mcp_grants.valideur is 'Seul compte dont la validation (page Agents) compte pour cette connexion d''agent ; null = tout fondateur (ttp-mcp/verrou.ts)';
  end if;
end $$;

-- 3. File d'envoi : la proposition validée et la connexion qui a programmé ----------------
do $$
begin
  if to_regclass('public.envoi_file') is not null then
    alter table public.envoi_file add column if not exists valide_le timestamptz;
    alter table public.envoi_file add column if not exists proposition uuid;
    alter table public.envoi_file add column if not exists grant_id uuid;
    comment on column public.envoi_file.proposition is 'Proposition agent.actions validée d''un brouillon programmé par un agent, relue juste avant l''envoi';
    comment on column public.envoi_file.grant_id is 'Connexion du connecteur (mcp_grants.id) qui a programmé l''envoi, relue juste avant l''envoi : cochée « agent autonome » depuis, une ligne sans validation ne part pas ; valideur choisi depuis, seule sa validation compte';
  end if;
end $$;

-- 4. Paramètres › Connexions Claude (fondateurs) ---------------------------------------
-- Toutes les connexions de l'agence, actives et coupées, avec leur compte et les appels des
-- 7 derniers jours. Jamais les jetons.
create or replace function public.connexions_claude()
returns table (
  id uuid, nom text, compte uuid, compte_nom text, cree_le timestamptz, dernier_usage timestamptz,
  coupee_le timestamptz, agent boolean, valideur uuid, appels_7j bigint
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_founder() then
    raise exception 'Réservé aux fondateurs' using errcode = '42501';
  end if;
  return query
    select g.id, coalesce(nullif(btrim(g.client_name), ''), 'Claude'), g.user_id, p.display_name, g.created_at, g.last_used_at,
           g.revoked_at, g.agent, g.valideur, coalesce(c.n, 0)::bigint
      from public.mcp_grants g
      left join public.profiles p on p.user_id = g.user_id
      left join (
        select l.grant_id, count(*) as n
          from public.mcp_log l
         where l.at > now() - interval '7 days'
         group by l.grant_id
      ) c on c.grant_id = g.id
     order by g.revoked_at is not null, g.last_used_at desc nulls last, g.created_at desc;
end $$;

-- Un réglage d'un fondateur sur une connexion : {"agent": true|false}, {"valideur": "<uuid>"|null}
-- ou {"couper": true}. Le valideur doit être un compte fondateur. Noté dans le journal des agents.
create or replace function public.connexion_claude_regler(p_id uuid, p_reglage jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  g public.mcp_grants%rowtype;
  v_valideur uuid;
  v_fait text[] := '{}';
  v_qui text;
  v_compte text;
begin
  if not public.is_founder() then
    raise exception 'Réservé aux fondateurs' using errcode = '42501';
  end if;
  if p_reglage is null or jsonb_typeof(p_reglage) <> 'object' then
    raise exception 'Réglage illisible' using errcode = '22023';
  end if;
  select * into g from public.mcp_grants where id = p_id for update;
  if not found then
    raise exception 'Connexion introuvable' using errcode = 'P0002';
  end if;
  if g.revoked_at is not null then
    raise exception 'Connexion déjà coupée' using errcode = '22023';
  end if;

  if p_reglage ? 'agent' then
    if jsonb_typeof(p_reglage -> 'agent') <> 'boolean' then
      raise exception 'Case agent illisible' using errcode = '22023';
    end if;
    if (p_reglage ->> 'agent')::boolean is distinct from g.agent then
      update public.mcp_grants set agent = (p_reglage ->> 'agent')::boolean where id = p_id;
      v_fait := v_fait || case when (p_reglage ->> 'agent')::boolean then 'agent autonome coché' else 'agent autonome décoché' end;
    end if;
  end if;

  if p_reglage ? 'valideur' then
    if jsonb_typeof(p_reglage -> 'valideur') = 'null' then
      v_valideur := null;
    elsif jsonb_typeof(p_reglage -> 'valideur') = 'string'
      and (p_reglage ->> 'valideur') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_valideur := (p_reglage ->> 'valideur')::uuid;
      if not exists (select 1 from public.profiles p
                      where p.user_id = v_valideur and p.role = 'agency' and coalesce(p.agency_role, 'member') = 'founder') then
        raise exception 'Le valideur doit être un compte fondateur' using errcode = '22023';
      end if;
    else
      raise exception 'Valideur illisible' using errcode = '22023';
    end if;
    if v_valideur is distinct from g.valideur then
      update public.mcp_grants set valideur = v_valideur where id = p_id;
      v_fait := v_fait || ('validation : ' || coalesce(
        (select coalesce(nullif(btrim(p.display_name), ''), 'compte sans nom') from public.profiles p where p.user_id = v_valideur),
        'tout fondateur'));
    end if;
  end if;

  if p_reglage ? 'couper' then
    if jsonb_typeof(p_reglage -> 'couper') <> 'boolean' then
      raise exception 'Coupure illisible' using errcode = '22023';
    end if;
    if (p_reglage ->> 'couper')::boolean then
      update public.mcp_grants set revoked_at = now() where id = p_id and revoked_at is null;
      -- Ses jetons aussi (une écriture seule : les jetons ne sont jamais lus ici).
      update public.mcp_tokens set revoked_at = now() where grant_id = p_id and revoked_at is null;
      v_fait := v_fait || 'connexion coupée'::text;
    end if;
  end if;

  if cardinality(v_fait) > 0 then
    select coalesce(nullif(btrim(p.display_name), ''), 'Un fondateur') into v_qui from public.profiles p where p.user_id = auth.uid();
    select coalesce(nullif(btrim(p.display_name), ''), 'compte sans nom') into v_compte from public.profiles p where p.user_id = g.user_id;
    begin
      insert into agent.journal (action, detail)
      values ('connexion_reglee', left(format('%s : connexion « %s » de %s, %s',
        coalesce(v_qui, 'Un fondateur'), coalesce(nullif(btrim(g.client_name), ''), 'Claude'), coalesce(v_compte, 'compte inconnu'),
        array_to_string(v_fait, ', ')), 300));
    exception when others then
      null; -- le journal ne bloque jamais le réglage
    end;
  end if;

  select * into g from public.mcp_grants where id = p_id;
  return jsonb_build_object('id', g.id, 'agent', g.agent, 'valideur', g.valideur, 'coupee_le', g.revoked_at, 'fait', to_jsonb(v_fait));
end $$;

revoke all on function public.connexions_claude() from public, anon;
revoke all on function public.connexion_claude_regler(uuid, jsonb) from public, anon;
grant execute on function public.connexions_claude() to authenticated;
grant execute on function public.connexion_claude_regler(uuid, jsonb) to authenticated;

-- 5. Droits en trop sur le journal du connecteur et les connexions -----------------------
do $$
declare t text;
begin
  foreach t in array array['public.mcp_log', 'public.mcp_grants'] loop
    if to_regclass(t) is not null then
      execute format('revoke truncate, trigger, references on %s from authenticated, anon, public', t);
      -- Postgres 17 et plus : MAINTAIN (VACUUM, REINDEX, LOCK…) n'a rien à faire là non plus.
      if current_setting('server_version_num')::int >= 170000 then
        execute format('revoke maintain on %s from authenticated, anon, public', t);
      end if;
    end if;
  end loop;
end $$;

-- 6. Une connexion coupée le reste -----------------------------------------------------
-- Avant : la règle acceptait toute valeur de revoked_at sur ses propres lignes, vide comprise.
-- Un PATCH revoked_at=null par l'API rallumait une connexion coupée par un autre fondateur, sans
-- trace. Couper sa propre connexion (Paramètres › Assistants IA) reste possible.
do $$
begin
  if to_regclass('public.mcp_grants') is not null
     and exists (select 1 from pg_policy where polname = 'mcp_grants_own_revoke' and polrelid = to_regclass('public.mcp_grants')) then
    execute 'alter policy mcp_grants_own_revoke on public.mcp_grants '
         || 'using (user_id = auth.uid()) with check (user_id = auth.uid() and revoked_at is not null)';
  end if;
end $$;

-- Contrôle (une ligne) : attendu « true · true · true · true · true · true · 0 · true · 0 »
--   (le dernier 0 : aucune connexion cochée « agent » tant qu'un fondateur ne l'a pas décidé).
-- Essai ensuite dans l'app : Paramètres › Connexions Claude avec un compte fondateur liste les
-- connexions ; select public.connexions_claude(); dans le SQL Editor répond « Réservé aux fondateurs ».
select
  (select count(*) from information_schema.columns
    where table_schema = 'agent' and table_name = 'actions' and column_name in ('cree_par', 'grant_id')) = 2      as qui_propose_ok,
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'mcp_grants' and column_name = 'valideur')             as valideur_ok,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'envoi_file' and column_name in ('proposition', 'grant_id')) = 2 as file_ok,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('connexions_claude', 'connexion_claude_regler') and p.prosecdef
      and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
      and not has_function_privilege('anon', p.oid, 'execute')
      and has_function_privilege('authenticated', p.oid, 'execute')) = 2                                        as fonctions_ok,
  coalesce((select pg_get_expr(polwithcheck, polrelid) from pg_policy
             where polname = 'mcp_grants_own_revoke' and polrelid = 'public.mcp_grants'::regclass) ilike '%revoked_at IS NOT NULL%', false) as coupee_le_reste,
  position('update public.mcp_tokens' in pg_get_functiondef('public.connexion_claude_regler(uuid, jsonb)'::regprocedure)) > 0 as jetons_coupes_ok,
  (select count(*) from pg_class c, aclexplode(c.relacl) a
    where c.oid in ('public.mcp_log'::regclass, 'public.mcp_grants'::regclass)
      and a.grantee in ('authenticated'::regrole, 'anon'::regrole)
      and a.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'))                                  as droits_en_trop,
  has_table_privilege('authenticated', 'public.mcp_grants', 'SELECT')
    and has_column_privilege('authenticated', 'public.mcp_grants', 'revoked_at', 'UPDATE')
    and has_table_privilege('authenticated', 'public.mcp_log', 'SELECT')                                         as lecture_et_coupure_ok,
  (select count(*) from public.mcp_grants where agent)                                                           as connexions_agent;
