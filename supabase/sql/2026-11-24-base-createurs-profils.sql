-- TITRE : TTP Suite · Base créateurs : agence et date de lecture des profils (2026-11-24)
-- ============================================================================
-- Plan « MCP TTP autonomie » : les outils Claude lire_profil_instagram,
-- lire_profils_instagram et scanner_base_createurs lisent les comptes Instagram
-- (Business Discovery de Meta) et mettent à jour la Base créateurs (ig_profiles).
-- Abonnés, bio, email, site, engagement et dernier post vont dans ig_profiles.data
-- (comme le Sourcing). Ce SQL ajoute trois colonnes qui ne doivent PAS être effacées
-- quand le Sourcing réécrit data :
--   agence        « oui », « non » ou « a_verifier » (détection : _shared/agenceDetection.ts) ;
--   agence_nom    le nom de l'agence trouvée (ou son @, ou le domaine de son email) ;
--   profil_lu_at  date de la dernière lecture par ces outils (le scan relit après 30 jours).
-- Avant ce SQL, les outils marchent déjà : ils rangent ces trois valeurs dans data
-- (agence, agence_nom, profilLu) et le disent dans leur réponse.
-- Rien à déployer en même temps. Relançable sans risque. Contrôle en fin de fichier.
-- ============================================================================

alter table public.ig_profiles add column if not exists agence text
  check (agence is null or agence in ('oui', 'non', 'a_verifier'));
alter table public.ig_profiles add column if not exists agence_nom text;
alter table public.ig_profiles add column if not exists profil_lu_at timestamptz;

-- File du scan : jamais lus d'abord, puis les lectures les plus anciennes.
create index if not exists ig_profiles_profil_lu_idx on public.ig_profiles (profil_lu_at asc nulls first);

-- Reprise de ce qui a déjà été lu avant ce SQL (valeurs rangées dans data).
update public.ig_profiles
   set agence = case when data->>'agence' in ('oui', 'non', 'a_verifier') then data->>'agence' end,
       agence_nom = nullif(data->>'agence_nom', ''),
       profil_lu_at = (data->>'profilLu')::timestamptz
 where profil_lu_at is null
   and data ? 'profilLu';

-- Contrôle : les 3 colonnes existent, et combien de profils sont déjà lus.
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'ig_profiles' and column_name in ('agence', 'agence_nom', 'profil_lu_at')
 order by column_name;
select count(*) filter (where profil_lu_at is not null) as profils_lus,
       count(*) filter (where agence = 'oui') as en_agence,
       count(*) filter (where agence = 'a_verifier') as a_verifier
  from public.ig_profiles;
