-- ============================================================================
-- 2026-11-27 · Vague 1 : la base reconnaît les écritures du connecteur Claude (Alfred et le
-- Claude de chaque membre de l'équipe) comme venant de l'agence
-- Titre Supabase : « Acteur du connecteur »
-- ----------------------------------------------------------------------------
-- Pourquoi (audit du 27/11, points WU1, A1, D9) : le connecteur (ttp-mcp) écrit avec la
-- clé service_role, donc sans compte connecté. activity_actor() renvoyait null et les
-- déclencheurs des repères « nouveau » (tâches, idées, briefs, mails) s'arrêtaient : rien de
-- ce qu'Alfred crée pour un créateur ne lui était signalé.
--
-- Quoi : le connecteur enverra un en-tête HTTP x-ttp-acteur (« alfred:<id du compte> » ou
-- « claude:<id du compte> », voir supabase/functions/_shared/acteurConnecteur.ts).
--   • acteur_connecteur() lit cet en-tête SEULEMENT pour une requête service_role sans
--     compte connecté. Un compte connecté (créateur ou agence) ou un visiteur ne peut donc
--     pas s'en servir. Valeur hors du format attendu, ou illisible : ignorée, comme absente.
--     Elle ne fait jamais échouer une écriture.
--   • activity_actor() : en-tête valide → 'agency'. Pas de compte et pas d'en-tête → null
--     comme avant (crons, autres fonctions serveur : règle du 23/10). Le reste ne change pas.
--   • activity_actor_name() : « Alfred », ou « Claude · <prénom affiché> » du compte agence
--     lu dans l'en-tête (« Claude » sinon), 60 caractères au plus. Le reste ne change pas.
--   • log_agency_activity ne change pas (sinon les écritures d'Alfred partiraient dans les
--     push de l'équipe au nom de Marc).
--   Les règles des repères restent : une tâche suivie par l'agence ne donne rien au créateur.
--
-- Ordre : ce SQL d'abord ; sans en-tête rien ne change. Le connecteur enverra l'en-tête
-- dans la vague suivante (déploiement de ttp-mcp), sauf sa route cron /file-envoi.
-- Contrôle : le bloc d'essai ci-dessous s'arrête en erreur si la lecture de l'en-tête ne se
-- comporte pas comme prévu (rien n'est alors gardé si le script part en une fois) ; puis
-- la requête à la fin. Attendu : true · true · true · true · false
-- Relançable sans risque (create or replace, aucune donnée touchée).
-- Pas encore dans SETUP.sql (à replier après la réécriture de SETUP.sql en cours).
-- Après ce SQL, ne plus relancer 2026-10-23-notifications-nouveautes.sql : il remettrait
-- l'ancienne activity_actor sans aucune erreur (son en-tête le dit).
-- ============================================================================

-- Valeur de l'en-tête du connecteur (« alfred:<id> », « claude:<id> », sans l'id parfois),
-- ou null.
create or replace function public.acteur_connecteur() returns text
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v text;
begin
  -- Seulement la clé service_role, sans compte connecté.
  if auth.uid() is not null or coalesce(auth.role(), '') <> 'service_role' then
    return null;
  end if;
  v := lower(btrim(nullif(current_setting('request.headers', true), '')::json ->> 'x-ttp-acteur'));
  if v ~ '^(alfred|claude)(:[0-9a-f-]{36})?$' then
    return v;
  end if;
  return null;
exception when others then
  return null; -- valeur illisible : comme absente
end $$;
revoke all on function public.acteur_connecteur() from public, anon, authenticated;

-- Qui écrit : 'agency' (compte agence, ou connecteur), 'creator' (compte créateur), null
-- (pas de compte et pas d'en-tête du connecteur : on ne note rien).
create or replace function public.activity_actor() returns text
  language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when auth.uid() is null then (case when public.acteur_connecteur() is not null then 'agency' end)
    when public.is_agency() then 'agency'
    when public.my_creator() is not null then 'creator'
    else null end;
$$;

-- Nom affiché de l'auteur dans un repère.
create or replace function public.activity_actor_name() returns text
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v text;
  v_nom text;
begin
  if auth.uid() is null then
    v := public.acteur_connecteur();
    if v is null then return null; end if;
    if v like 'alfred%' then return 'Alfred'; end if;
    begin
      select nullif(btrim(p.display_name), '') into v_nom
        from public.profiles p
       where p.role = 'agency' and p.user_id = nullif(substr(v, 8), '')::uuid;
    exception when others then
      v_nom := null; -- id illisible
    end;
    return left(case when v_nom is null then 'Claude' else 'Claude · ' || v_nom end, 60);
  end if;
  return (select coalesce(nullif(btrim(p.display_name), ''), case when p.role = 'agency' then 'Agence' else p.creator_name end)
            from public.profiles p where p.user_id = auth.uid());
end $$;

-- Essai, sans rien écrire : simule une requête du connecteur dans cette transaction.
do $$
declare
  a text; n text; a_connecte text; a_faux text; a_sans text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.headers', '{"x-ttp-acteur":"alfred"}', true);
  a := public.activity_actor();
  n := public.activity_actor_name();
  perform set_config('request.headers', '{"x-ttp-acteur":"Alfred · Marc"}', true);
  a_faux := public.activity_actor();
  perform set_config('request.headers', '{}', true);
  a_sans := public.activity_actor();
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  perform set_config('request.headers', '{"x-ttp-acteur":"alfred"}', true);
  a_connecte := public.acteur_connecteur();
  perform set_config('request.headers', '', true);
  perform set_config('request.jwt.claims', '', true);
  if a is distinct from 'agency' or n is distinct from 'Alfred'
     or a_faux is not null or a_sans is not null or a_connecte is not null then
    raise exception 'Essai de l''en-tête du connecteur raté : % · % · % · % · %', a, n, a_faux, a_sans, a_connecte;
  end if;
end $$;

-- Contrôle (une ligne). Attendu : true · true · true · true · false
select
  public.activity_actor() is null as sans_compte_rien,
  public.activity_actor_name() is null as sans_compte_sans_nom,
  position('acteur_connecteur' in pg_get_functiondef('public.activity_actor'::regproc)) > 0 as acteur_ok,
  position('Alfred' in pg_get_functiondef('public.activity_actor_name'::regproc)) > 0 as nom_ok,
  has_function_privilege('authenticated', 'public.acteur_connecteur()', 'execute') as connecte_peut_lire;
