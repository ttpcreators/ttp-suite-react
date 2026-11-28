-- ============================================================================
-- 2026-11-28 · Comptes : la fiche profil d'un fondateur n'est modifiable que par lui-même
-- Titre Supabase : « Profils des fondateurs protégés »
-- ----------------------------------------------------------------------------
-- Pourquoi (audit des 14 attaques du 28/11, relecture du lot « comptes ») : la règle
-- profiles_founder_write laisse un fondateur modifier ou effacer n'importe quelle ligne de
-- public.profiles depuis l'app ou l'API, y compris celle d'un autre fondateur. La règle
-- « jamais le compte d'un autre fondateur » de create-access (« Nouveau mot de passe ») lit
-- justement cette ligne : elle doit rester fiable.
--
-- Quoi :
--   1. public.proteger_profils_fondateurs() + déclencheur proteger_profils_fondateurs
--      (BEFORE UPDATE OR DELETE sur public.profiles). Pour un appel fait avec la session
--      d'un compte (auth.uid() posé), la ligne d'un AUTRE fondateur ne peut ni changer de
--      role, d'agency_role ou de user_id, ni être effacée. Le reste de la ligne (nom affiché…)
--      reste modifiable comme avant. Sa propre ligne : inchangé.
--      Les fonctions serveur (service_role : create-access…), Supabase Auth et le SQL Editor
--      n'ont pas de auth.uid() : ils restent libres. Passer un fondateur en membre ou retirer
--      un compte fondateur se fait donc dans le SQL Editor ou le tableau de bord Supabase.
--   2. TRUNCATE retiré à anon et authenticated sur public.profiles (un TRUNCATE ignore les
--      règles RLS et les déclencheurs de ligne ; l'app ne s'en sert pas).
--
-- Ordre : indépendant. create-access refuse déjà, sans ce SQL, un « Nouveau mot de passe »
-- sur un compte sans profil (sauf le sien) ; ce SQL empêche qu'un profil de fondateur soit
-- d'abord modifié ou effacé pour contourner ce refus.
-- Relançable sans risque (create or replace, drop trigger if exists, revoke ; aucune donnée
-- touchée au lancement).
-- Contrôle : la requête à la fin. Attendu : true · false · false
-- ============================================================================

-- 1. La ligne d'un autre fondateur : ni rôle changé, ni suppression, avec une session de compte.
create or replace function public.proteger_profils_fondateurs()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  appelant uuid := auth.uid();
begin
  if appelant is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and old.role = 'agency'
     and old.agency_role = 'founder'
     and old.user_id <> appelant then
    if tg_op = 'DELETE' then
      raise exception 'profil_fondateur_protege' using errcode = '42501';
    end if;
    if new.role is distinct from old.role
       or new.agency_role is distinct from old.agency_role
       or new.user_id is distinct from old.user_id then
      raise exception 'profil_fondateur_protege' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.proteger_profils_fondateurs() from public, anon, authenticated;

drop trigger if exists proteger_profils_fondateurs on public.profiles;
create trigger proteger_profils_fondateurs
  before update or delete on public.profiles
  for each row
  execute function public.proteger_profils_fondateurs();

-- 2. Pas de TRUNCATE depuis un compte.
revoke truncate on public.profiles from anon, authenticated;

-- Contrôle. Attendu : true · false · false
select
  exists (select 1 from pg_trigger where tgname = 'proteger_profils_fondateurs' and tgrelid = 'public.profiles'::regclass) as declencheur,
  has_table_privilege('authenticated', 'public.profiles', 'truncate') as truncate_compte,
  has_table_privilege('anon', 'public.profiles', 'truncate') as truncate_anon;
