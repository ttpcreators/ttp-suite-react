-- ============================================================================
-- 2026-11-28 · Comptes : un nouveau mot de passe coupe les connexions Claude du compte
-- Titre Supabase : « Connexions Claude coupées au changement de mot de passe »
-- ----------------------------------------------------------------------------
-- Pourquoi (audit des 14 attaques du 28/11, point 9, correction 14) : une connexion Claude
-- (mcp_grants) garde un jeton de renouvellement de 60 jours, renouvelé à chaque usage. Elle
-- survit aujourd'hui à un changement de mot de passe et à une récupération par « Mot de
-- passe oublié ». Changer son mot de passe doit suffire à reprendre la main sur son compte.
--
-- Quoi :
--   1. public.couper_connexions_claude() + déclencheur couper_connexions_claude sur
--      auth.users : quand le mot de passe change (app, lien « Mot de passe oublié »,
--      page Accès) ou qu'un lien de récupération ou de connexion par mail est utilisé
--      (recovery_token vidé par Supabase Auth), toutes les connexions Claude encore
--      ouvertes du compte reçoivent revoked_at = now(). Le connecteur refuse alors leurs
--      jetons (ttp-mcp/oauth.ts relit revoked_at à chaque appel). Il faut reconnecter Claude
--      (et l'agent de l'iMac) ensuite.
--   2. mcp_clients.ip_hash (empreinte salée de l'adresse IP, jamais l'adresse) et son index :
--      le connecteur plafonne les enregistrements à 20 par heure et par adresse.
-- L'app coupe aussi les connexions elle-même après un changement de mot de passe ou un lien
-- « Mot de passe oublié », et create-access après un « Nouveau mot de passe » : sans ce SQL,
-- seul un changement fait hors de l'app passerait à travers.
--
-- Ordre : indépendant de la fusion et du déploiement de ttp-mcp (le code fait sans la
-- colonne tant qu'elle manque).
-- Relançable sans risque (create or replace, if not exists, drop trigger if exists ; aucune
-- donnée touchée au lancement).
-- Contrôle : la requête à la fin. Attendu : true · true · true · false
-- ============================================================================

-- 1. Connexions Claude coupées quand le mot de passe change ou qu'un lien de récupération sert.
create or replace function public.couper_connexions_claude()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password
     or (coalesce(old.recovery_token, '') <> '' and coalesce(new.recovery_token, '') = '') then
    update public.mcp_grants
       set revoked_at = now()
     where user_id = new.id
       and revoked_at is null;
  end if;
  return new;
end;
$$;

revoke execute on function public.couper_connexions_claude() from public, anon, authenticated;

drop trigger if exists couper_connexions_claude on auth.users;
create trigger couper_connexions_claude
  after update of encrypted_password, recovery_token on auth.users
  for each row
  execute function public.couper_connexions_claude();

-- 2. Plafond des enregistrements du connecteur par adresse IP.
alter table public.mcp_clients add column if not exists ip_hash text;
create index if not exists mcp_clients_ip_hash_idx on public.mcp_clients (ip_hash, created_at);

-- Contrôle. Attendu : true · true · true · false
select
  exists (select 1 from pg_trigger where tgname = 'couper_connexions_claude' and tgrelid = 'auth.users'::regclass) as declencheur,
  exists (select 1 from pg_proc where proname = 'couper_connexions_claude' and prosecdef) as fonction_definer,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mcp_clients' and column_name = 'ip_hash') as colonne_ip_hash,
  has_function_privilege('authenticated', 'public.couper_connexions_claude()', 'execute') as appelable_par_un_compte;
