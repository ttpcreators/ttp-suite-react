-- Sécurité CRITIQUE : ne jamais faire confiance au creator_name du signup
-- ---------------------------------------------------------------------------
-- FAILLE (confirmée en live) : l'inscription publique (/auth/v1/signup, clé anon)
-- est activée, et le trigger handle_new_user recopiait le `creator_name` fourni
-- dans les métadonnées du signup — une valeur 100 % contrôlée par le client.
-- Comme les noms des créatrices sont publics (vue public_roster / roster du site),
-- n'IMPORTE qui pouvait s'inscrire en se déclarant « CANDICE MAISSA », obtenir
-- my_creator() = « CANDICE MAISSA », et donc — via la policy RLS
-- `using (is_agency() or name = my_creator())` — accéder à SA fiche et à toutes
-- ses données cloisonnées (coordonnées, SIREN, CA, factures, briefs, messages,
-- media kit…). Usurpation d'identité + fuite de données privées.
--
-- CORRECTIF : le rattachement d'un compte à une créatrice se fait EXCLUSIVEMENT
-- côté serveur, par la fonction admin `create-access` (réservée à l'agence, clé
-- service_role), qui upsert profiles juste après avoir créé le compte. Le trigger
-- ne doit donc JAMAIS déduire le creator_name du client : un signup public reste
-- creator_name = NULL → my_creator() = NULL → ne matche aucune fiche → aucun accès.
--
-- À exécuter dans le SQL Editor (projet zizvggziggswhrbuyhuo). Déjà foldé dans
-- SETUP.sql. À COMPLÉTER par la désactivation de l'inscription publique dans le
-- dashboard (Authentication → Sign In / Providers → « Allow new users to sign up »
-- OFF) : la création de comptes passe de toute façon par create-access (API admin),
-- que ce réglage n'affecte pas.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  -- Rôle TOUJOURS 'creator' et creator_name TOUJOURS NULL ici (aucune confiance
  -- aux métadonnées client). La promotion agence + le rattachement créatrice sont
  -- faits ailleurs : section 4 (liste d'emails agence) et create-access (admin).
  insert into public.profiles (user_id, role, creator_name)
  values (new.id, 'creator', null)
  on conflict (user_id) do nothing;
  return new;
end $$;
