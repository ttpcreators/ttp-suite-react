-- ============================================================================
-- 2026-11-25 : journal des connexions Instagram des créatrices (ig_connexions)
-- Titre Supabase : « Instagram · journal des connexions »
-- ----------------------------------------------------------------------------
-- Avant : aucune créatrice n'avait réussi à connecter son Instagram (ig_accounts
-- vide) et chaque échec était silencieux (retour « ?instagram=error », rien de noté).
-- Désormais ig-callback écrit UNE ligne par tentative, réussie ou non : date,
-- créatrice, d'où ça part (espace, agence, lien), étape où ça s'arrête, raison
-- courte (refus, pas_pro, pas_autorise, expire, lien_invalide, agence), message
-- BRUT de Meta (sans jeton ni clé), @ et type du compte.
--
-- Pourquoi une table et pas creators.ig.connexion : ig-sync réécrit creators.ig en
-- entier à chaque passage (une écriture faite pendant le passage serait perdue), et
-- il faut l'historique (nombre d'essais) et les tentatives sans créatrice connue
-- (lien ou state illisible).
--
-- Droits : écriture par le serveur seulement (aucune règle d'écriture). Lecture :
-- l'agence (fiche créatrice) et la créatrice pour SES lignes (son espace affiche le
-- résultat même si elle revient d'Instagram sur un autre navigateur).
-- Sans risque à relancer. Avant ce SQL, ig-callback marche quand même (la ligne
-- n'est pas écrite, l'échec reste dans le journal de la fonction).
-- ============================================================================

create table if not exists public.ig_connexions (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  creator_id   uuid references public.creators(id) on delete cascade,
  via          text not null default 'espace',   -- espace | agence | lien | inconnu
  etape        text not null,                     -- lien, etat, configuration, autorisation, echange, jeton_long, profil, compte_pas_pro, enregistrement, ok
  ok           boolean not null default false,
  raison       text,                              -- null si ok
  message      text,                              -- message brut de Meta (400 caractères au plus)
  ig_username  text,
  account_type text
);

comment on table public.ig_connexions is 'Une ligne par tentative de connexion Instagram d''une créatrice (ig-callback). Lecture : agence, et la créatrice pour ses lignes.';

create index if not exists ig_connexions_creator_idx on public.ig_connexions (creator_id, at desc);

alter table public.ig_connexions enable row level security;
revoke all on public.ig_connexions from anon, authenticated;
grant select on public.ig_connexions to authenticated;

drop policy if exists ig_connexions_lecture on public.ig_connexions;
create policy ig_connexions_lecture on public.ig_connexions
  for select to authenticated
  using (
    public.is_agency()
    or creator_id in (select c.id from public.creators c where c.name = public.my_creator())
  );

notify pgrst, 'reload schema';

-- Contrôle : 1 · 1 · 0
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'ig_connexions') as table_1,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'ig_connexions' and policyname = 'ig_connexions_lecture') as regle_1,
  (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'ig_connexions' and grantee = 'anon') as droits_anon_0;
