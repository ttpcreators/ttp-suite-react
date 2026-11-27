-- ============================================================================
-- TTP Suite — SCRIPT MAÎTRE UNIQUE (schéma + sécurité)
-- ============================================================================
-- C'EST LE SEUL SCRIPT À UTILISER. Il remplace toutes les anciennes migrations
-- numérotées (0001→0009), qui sont conservées uniquement pour l'historique.
--
-- • Idempotent : tu peux le relancer autant de fois que tu veux, sans rien casser.
-- • Il (re)crée les tables manquantes, les fonctions, le trigger, le rôle agence,
--   puis REMET la sécurité finale d'aplomb (supprime TOUTE policy existante puis
--   recrée le bon modèle).
--
-- MODÈLE DE SÉCURITÉ :
--   • anonyme (non connecté)  → AUCUN accès
--   • agence (rôle 'agency')  → accès total
--   • créateur connecté       → uniquement SES données
--
-- À LANCER : Supabase → SQL Editor → coller CE fichier en entier → Run.
-- ⚠️ NE RELANCE JAMAIS l'ancienne 0002 : elle rouvre l'accès anonyme.
-- ============================================================================

create extension if not exists "pgcrypto";
-- Tâches planifiées (pg_cron, qui s'installe dans pg_catalog) et appels HTTP depuis la base
-- (pg_net, dans public comme en production : sans clause schema, comme dans les scripts
-- datés 05-cron-alertes-email.sql et suivants). Seules les extensions sont ici : les tâches
-- planifiées restent dans les scripts datés de sql/, jamais dans ce fichier.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ----------------------------------------------------------------------------
-- 1) TABLES (créées seulement si absentes — ne touche pas aux données existantes)
-- ----------------------------------------------------------------------------
create table if not exists public.creators (
  id uuid primary key default gen_random_uuid(),
  sort_order int not null default 0,
  name text not null, handle text, niche text, platform text,
  followers text, reach text, er text, ca text,
  status text default 'actif', tone text default 'cyan', trend int default 0,
  ville text, phone text, email text, address text, siren text, birth text,
  exclu boolean default false, commission text,
  stats jsonb,
  created_at timestamptz default now()
);
-- colonnes coordonnées ajoutées si la table existait sans elles (sans risque)
alter table public.creators add column if not exists ville text;
alter table public.creators add column if not exists phone text;
alter table public.creators add column if not exists email text;
alter table public.creators add column if not exists address text;
alter table public.creators add column if not exists siren text;
alter table public.creators add column if not exists birth text;
alter table public.creators add column if not exists exclu boolean default false;
alter table public.creators add column if not exists commission text;
alter table public.creators add column if not exists stats jsonb;
alter table public.creators add column if not exists stats_history jsonb;
alter table public.creators add column if not exists followers_history jsonb;
alter table public.creators add column if not exists photo_url text;
alter table public.creators add column if not exists email_pro text;
alter table public.creators add column if not exists instagram text;
alter table public.creators add column if not exists tiktok text;
alter table public.creators add column if not exists stats_month text;   -- sql/11 : mois de dernière MAJ des datas
alter table public.creators add column if not exists mediakit jsonb;     -- sql/14 : contenu du media kit (bio, audience, stats par plateforme, marques, photos)
-- sql/2026-11-27-mediakit-objet : un media kit est un objet (ou vide), jamais du texte (le site ne lit qu'un objet).
alter table public.creators drop constraint if exists creators_mediakit_objet;
alter table public.creators add constraint creators_mediakit_objet check (mediakit is null or jsonb_typeof(mediakit) in ('object', 'null'));
alter table public.creators add column if not exists ig jsonb;           -- chiffres Instagram (Meta), écrits par ig-sync (sql/2026-10-13-instagram-api)

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  ref text, party text, amount text, date text, status text default 'brouillon',
  creator text,
  sort_order int default 0, created_at timestamptz default now()
);
alter table public.invoices add column if not exists creator text;
-- Date de paiement, remplie par le déclencheur invoices_paid_at, et numéro de facture
-- unique (les brouillons sans numéro ne comptent pas) (sql/2026-11-01-factures-garde-fous).
alter table public.invoices add column if not exists paid_at timestamptz;
create unique index if not exists invoices_ref_unique on public.invoices (ref)
  where coalesce(trim(ref), '') <> '';

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  brand text not null, person text, role text, tag text,
  email text, phone text, tone text default 'cyan',
  sort_order int default 0, created_at timestamptz default now()
);
alter table public.contacts add column if not exists first_name text;
alter table public.contacts add column if not exists last_name text;
alter table public.contacts add column if not exists creator text;       -- sql/12 : contact ajouté par un créateur (NULL = agence)
alter table public.contacts add column if not exists instagram text;     -- @ de la marque (sql/2026-09-08-contacts-instagram-city)
alter table public.contacts add column if not exists city text;          -- ville de la marque
alter table public.contacts add column if not exists touches jsonb;      -- journal de contact multi-canal (sql/2026-09-28-contacts-touches)
alter table public.contacts add column if not exists ig jsonb;           -- chiffres Instagram de la marque, écrits par ig-sync (sql/2026-10-13-instagram-api)
alter table public.contacts add column if not exists linkedin text;      -- profil LinkedIn de la personne, rempli par « Trouver des contacts » (sql/2026-10-28-contacts-linkedin)
-- Séquence de prospection en cours (règles dans supabase/functions/_shared/sequence.ts) et
-- état de l'adresse (rebond, domaine sans serveur mail) (sql/2026-11-20-sequences-contacts).
alter table public.contacts add column if not exists sequence jsonb;
alter table public.contacts add column if not exists email_check jsonb;
-- Contacts à relancer : séquence en cours, triés par date de la prochaine étape.
create index if not exists contacts_sequence_prochaine_idx
  on public.contacts ((sequence ->> 'prochaine'))
  where (sequence ->> 'statut') = 'en_cours';

create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  brand text not null, contact text, value text,
  stage text default 'Prospection', tone text default 'cyan',
  sort_order int default 0, created_at timestamptz default now()
);

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  text text not null, descr text, tag text, due text,
  creator text, priority text default 'moyenne', source text default 'agency',
  done boolean default false, sort_order int default 0, created_at timestamptz default now()
);
alter table public.todos add column if not exists status text default 'À faire';  -- sql/04
update public.todos set status = case when done then 'Fait' else 'À faire' end where status is null;
-- « Visible par le créateur » : une tâche de l'agence n'est lue par le créateur que si elle
-- est cochée (sql/2026-11-24-taches-internes-privees). Créée ici, avant les règles todos_read,
-- todos_update et todos_delete, la fonction todos_activity et la règle des pièces jointes.
alter table public.todos add column if not exists visible_createur boolean not null default false;

create table if not exists public.briefs (
  id uuid primary key default gen_random_uuid(),
  brand text, creator text, who text, deliverables text, due text,
  status text default 'cours', tone text default 'cyan',
  consignes text, budget text, objectif text, validated boolean default false,
  note text, sort_order int default 0, created_at timestamptz default now()
);

-- Collabs : cycle de vie complet d'une collaboration (11 étapes datées) —
-- étape courante sur `collabs.step`, historique daté dans `collab_steps`.
-- (cf. sql/2026-09-27-collabs.sql) — sert de socle à l'agent (détection de ce qui stagne).
create table if not exists public.collabs (
  id uuid primary key default gen_random_uuid(),
  brand text not null, creator text, contact text, title text,
  deliverables text, cachet text,
  step int not null default 1 check (step between 1 and 11),
  status text not null default 'active', brief_id uuid, note text,
  sort_order int default 0,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists collabs_sort_idx    on public.collabs (sort_order);
create index if not exists collabs_creator_idx on public.collabs (creator);
create index if not exists collabs_step_idx     on public.collabs (step);
alter table public.collabs add column if not exists ig jsonb;            -- publications de la marque repérées par ig-sync (sql/2026-10-13-instagram-api)
create table if not exists public.collab_steps (
  id uuid primary key default gen_random_uuid(),
  collab_id uuid not null references public.collabs(id) on delete cascade,
  step int not null check (step between 1 and 11),
  reached_at timestamptz default now(), note text
);
create index if not exists collab_steps_collab_idx on public.collab_steps (collab_id);

-- Gifting : cadeaux/dotations produits reçus par les créateurs (cf. sql/gifting.sql).
create table if not exists public.gifting (
  id uuid primary key default gen_random_uuid(),
  creator text, brand text, product text, value text,
  contact_name text, contact_email text, received_on date,
  content_expected boolean default false, deliverables text,
  status text default 'recu', mentions text, note text,
  source text default 'agency', sort_order int default 0,
  created_at timestamptz default now()
);

create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  text text not null, creator text, status text default 'À explorer',
  source text default 'agency', sort_order int default 0, created_at timestamptz default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  day int, date text, time text, title text, type text default 'call', who text,
  source text default 'agency',
  sort_order int default 0, created_at timestamptz default now()
);
-- date complète (YYYY-MM-DD) d'un événement : ajoutée si la table existait sans elle.
alter table public.events add column if not exists date text;
-- source ('agency'|'creator') : permet à la cloche de signaler un évènement ajouté
-- par un créateur (comme todos/ideas). Ajoutée si la table existait sans elle.
alter table public.events add column if not exists source text default 'agency';
alter table public.events add column if not exists description text;                       -- sql/09 (Planning + sync Google)
-- Colonnes de synchronisation Google Agenda (migrations/20260702_google_calendar.sql) :
alter table public.events add column if not exists google_event_id text;
alter table public.events add column if not exists google_etag     text;
alter table public.events add column if not exists updated_at      timestamptz not null default now();
alter table public.events add column if not exists last_synced_at  timestamptz;
alter table public.events add column if not exists sync_source     text default 'agence';
alter table public.events add column if not exists deleted         boolean not null default false;
alter table public.events add column if not exists deleted_at      timestamptz;
-- Rendez-vous interne de l'agence, jamais lu par le créateur (sql/2026-11-24-taches-internes-privees).
-- Créée ici, avant les règles events_read et events_write et le déclencheur events_interne_auto.
alter table public.events add column if not exists interne         boolean not null default false;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_key text not null, sender text not null default 'me', body text not null,
  creator text, sort_order int default 0, created_at timestamptz default now()
);

create table if not exists public.module_rows (
  id uuid primary key default gen_random_uuid(),
  module text not null, a text, b text, c text, tone text default 'cyan',
  sort_order int default 0, created_at timestamptz default now()
);

-- Documents : métadonnées des fichiers (le binaire vit dans le bucket Storage
-- `documents`). `creator` = nom du créateur propriétaire (null = doc agence).
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  creator text, name text not null, type text default 'autre',
  size text, path text not null, sort_order int default 0,
  created_at timestamptz default now()
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'creator',
  creator_name text,
  created_at timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- 2) INDEX (listes rapides à grande échelle)
-- ----------------------------------------------------------------------------
create index if not exists creators_sort_idx   on public.creators (sort_order);
create index if not exists contacts_sort_idx    on public.contacts  (sort_order);
create index if not exists prospects_sort_idx   on public.prospects (sort_order);
create index if not exists invoices_sort_idx    on public.invoices  (sort_order);
create index if not exists todos_creator_idx    on public.todos     (creator);
create index if not exists briefs_creator_idx   on public.briefs    (creator);
create index if not exists gifting_creator_idx  on public.gifting   (creator);
create index if not exists gifting_sort_idx     on public.gifting   (sort_order);
create index if not exists ideas_creator_idx    on public.ideas     (creator);
create index if not exists events_who_idx        on public.events    (who);
create index if not exists messages_thread_idx  on public.messages (thread_key, created_at);
create index if not exists messages_creator_idx on public.messages (creator);

-- ----------------------------------------------------------------------------
-- 3) FONCTIONS RÔLE + TRIGGER D'INSCRIPTION
-- ----------------------------------------------------------------------------
create or replace function public.is_agency() returns boolean
  language sql stable security definer as $$
  select coalesce((select p.role = 'agency' from public.profiles p where p.user_id = auth.uid()), false);
$$;

-- Niveau agence : 'founder' (accès total, Marc & Gianni) | 'member' (tout sauf
-- Finance & Accès). is_founder() = agence ET fondateur. Voir sql/2026-09-08-agency-roles.sql.
alter table public.profiles add column if not exists agency_role text not null default 'member';
create or replace function public.is_founder() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'agency'
      and coalesce(p.agency_role, 'member') = 'founder'
  );
$$;

-- Clés « argent » du blob agence, rangées dans la ligne '__finance_state__' (fondateurs).
-- + comptaSettings, collabCashMode : page Compta (sql/2026-10-29-compta.sql).
-- + quotes : les devis, rangés avec l'argent comme les factures (audit du 2 nov.,
--   sql/2026-11-02-corrections-audit.sql). Sans elle, les montants des devis partiraient
--   dans la ligne commune '__app_state__', que lisent tous les comptes agence.
create or replace function public.app_finance_key(p_key text) returns boolean
language sql immutable set search_path = public as $$
  select p_key = any (array['invoiceDetails', 'invoiceBankAccounts', 'invoiceIssuer', 'creatorPayouts', 'creatorCommission', 'comptaSettings', 'collabCashMode', 'quotes']);
$$;

create or replace function public.my_creator() returns text
  language sql stable security definer as $$
  select creator_name from public.profiles where user_id = auth.uid();
$$;

-- À l'inscription, on ne fait JAMAIS confiance aux métadonnées envoyées par le
-- client. NI le rôle (sinon un compte se déclarerait 'agency'), NI le creator_name
-- (sinon n'importe qui s'inscrirait en « CANDICE MAISSA » et récupérerait, via la
-- policy RLS `name = my_creator()`, l'accès à sa fiche + ses données privées — les
-- noms étant publics dans public_roster). Donc ici : rôle TOUJOURS 'creator',
-- creator_name TOUJOURS NULL. Le rattachement à une créatrice est fait UNIQUEMENT
-- côté serveur par la fonction admin create-access (réservée à l'agence), qui upsert
-- profiles juste après. Un signup public reste creator_name = NULL → my_creator()
-- = NULL → ne matche aucune fiche. La promotion agence se fait via la section 4.
-- (cf. supabase/sql/securite-signup-creator-name.sql)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (user_id, role, creator_name)
  values (new.id, 'creator', null)
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 4) RÔLE AGENCE (fait AVANT le verrouillage → pas de lock-out)
-- ----------------------------------------------------------------------------
-- SÉCURITÉ (audit 2026-07-13) : uniquement des emails d'un domaine POSSÉDÉ + email
-- confirmé. Le placeholder 'agence@ttp.com' (domaine non contrôlé) a été retiré : il
-- était squattable via signup public → relancer SETUP.sql aurait promu ce compte en
-- agence. Bootstrap ponctuel d'un compte réel = sql/admin-role-agence.sql (par user_id).
insert into public.profiles (user_id, role)
  select id, 'agency' from auth.users
   where email in ('partnerships@ttpcreators.pro','marcbouraoui@gmail.com')
     and email_confirmed_at is not null
  on conflict (user_id) do update set role = 'agency';

-- ----------------------------------------------------------------------------
-- 5) SÉCURITÉ : on supprime TOUTE policy existante, RLS ON partout,
--    puis on recrée UNIQUEMENT le bon modèle.
-- ----------------------------------------------------------------------------
do $$
declare r record; t text;
declare tbls text[] := array[
  'creators','contacts','invoices','prospects','module_rows',
  'todos','briefs','gifting','ideas','events','messages','profiles','documents',
  'collabs','collab_steps'
];
begin
  for r in select policyname, tablename from pg_policies
            where schemaname='public' and tablename = any(tbls)
  loop execute format('drop policy if exists %I on public.%I;', r.policyname, r.tablename); end loop;
  foreach t in array tbls loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- CREATORS : agence = tout ; créateur = sa propre fiche EN LECTURE + UPDATE seulement.
-- INSERT et DELETE réservés à l'agence : sinon (creators_guard n'étant que BEFORE
-- UPDATE) un créateur pouvait FORGER à l'INSERT une fiche à son nom avec ca/commission/
-- status/exclu/sort_order arbitraires, ou supprimer sa fiche. (audit 2026-07-13)
create policy creators_read           on public.creators for select to authenticated
  using (public.is_agency() or name = public.my_creator());
create policy creators_creator_update on public.creators for update to authenticated
  using (public.is_agency() or name = public.my_creator())
  with check (public.is_agency() or name = public.my_creator());
create policy creators_agency_insert  on public.creators for insert to authenticated
  with check (public.is_agency());
create policy creators_agency_delete  on public.creators for delete to authenticated
  using (public.is_agency());

-- GARDE-FOU colonnes sensibles : la policy `for all` ci-dessus laisse un créateur
-- écrire SA fiche — donc, via un appel API direct (hors UI), modifier des colonnes
-- qui ne le regardent pas : ca (CA, calculé depuis les factures), commission, status
-- (actif/inactif), exclu (exclusivité), sort_order (ordre roster de l'agence).
-- Même logique que pour invoices : on ferme le trou côté base, pas seulement côté UI.
-- Un trigger BEFORE UPDATE force ces colonnes à conserver leur ANCIENNE valeur quand
-- l'auteur n'est pas l'agence. L'agence n'est jamais affectée ; les vraies éditions du
-- créateur (coordonnées, réseaux, followers/ER/reach, bio, media kit…) passent normalement.
-- Langue de l'espace créateur (sql/2026-10-21-langue-createur.sql).
alter table public.creators add column if not exists lang text not null default 'fr';
alter table public.creators drop constraint if exists creators_lang_check;
alter table public.creators add constraint creators_lang_check check (lang in ('fr', 'en'));

-- Sans compte connecté (serveur, SQL Editor) : rien n'est bloqué (sql/2026-10-25-audit).
-- Tarifs du media kit verrouillés pour le créateur (sql/2026-11-27-securite-14).
create or replace function public.creators_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
  k text;
begin
  if auth.uid() is not null and not public.is_agency() then
    new.ca         := old.ca;
    new.commission := old.commission;
    new.status     := old.status;
    new.exclu      := old.exclu;
    new.sort_order := old.sort_order;
    if new.mediakit is distinct from old.mediakit then
      if jsonb_typeof(new.mediakit) is distinct from 'object' then
        new.mediakit := old.mediakit;
      else
        v := new.mediakit - array['hideRates', 'rates', 'ratesNote', 'ratesNoteEn'];
        if jsonb_typeof(old.mediakit) = 'object' then
          foreach k in array array['hideRates', 'rates', 'ratesNote', 'ratesNoteEn'] loop
            if old.mediakit ? k then v := v || jsonb_build_object(k, old.mediakit -> k); end if;
          end loop;
        end if;
        new.mediakit := v;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists creators_guard_upd on public.creators;
create trigger creators_guard_upd before update on public.creators
  for each row execute function public.creators_guard();

-- Chiffres Instagram (colonne `ig`) : écrits par l'agence et le serveur (ig-sync)
-- seulement ; une créatrice ne peut pas les gonfler par un appel direct à l'API.
-- (sql/2026-10-13-instagram-api ; collabs : écriture déjà réservée à l'agence.)
create or replace function public.ig_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if public.is_agency()
     or coalesce(auth.role(), '') = 'service_role'
     or current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.ig := null;
  else
    new.ig := old.ig;
  end if;
  return new;
end $$;
drop trigger if exists creators_ig_guard on public.creators;
create trigger creators_ig_guard before insert or update on public.creators
  for each row execute function public.ig_guard();
drop trigger if exists contacts_ig_guard on public.contacts;
create trigger contacts_ig_guard before insert or update on public.contacts
  for each row execute function public.ig_guard();

-- Jetons Instagram des créatrices qui ont connecté leur compte (ig-connect /
-- ig-callback). AUCUNE politique : illisible depuis l'app, serveur seulement.
create table if not exists public.ig_accounts (
  creator_id   uuid primary key references public.creators(id) on delete cascade,
  ig_user_id   text not null,
  username     text,
  token        text not null,
  expires_at   timestamptz,
  scopes       text,
  connected_at timestamptz default now(),
  refreshed_at timestamptz
);
alter table public.ig_accounts enable row level security;
revoke all on public.ig_accounts from anon, authenticated;

-- Journal des connexions Instagram (sql/2026-11-25-ig-connexions) : une ligne par
-- tentative (ig-callback), réussie ou non, avec l'étape, la raison et le message brut
-- de Meta. Écriture serveur ; lecture agence + la créatrice pour ses lignes.
create table if not exists public.ig_connexions (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  creator_id   uuid references public.creators(id) on delete cascade,
  via          text not null default 'espace',
  etape        text not null,
  ok           boolean not null default false,
  raison       text,
  message      text,
  ig_username  text,
  account_type text
);
-- Description de la table, la même qu'en production (sql/2026-11-25-ig-connexions).
comment on table public.ig_connexions is 'Une ligne par tentative de connexion Instagram d''une créatrice (ig-callback). Lecture : agence, et la créatrice pour ses lignes.';
create index if not exists ig_connexions_creator_idx on public.ig_connexions (creator_id, at desc);
alter table public.ig_connexions enable row level security;
revoke all on public.ig_connexions from anon, authenticated;
grant select on public.ig_connexions to authenticated;
drop policy if exists ig_connexions_lecture on public.ig_connexions;
create policy ig_connexions_lecture on public.ig_connexions
  for select to authenticated
  using (public.is_agency() or creator_id in (select c.id from public.creators c where c.name = public.my_creator()));

-- Sourcing + Radar à marques (sql/2026-10-13-instagram-sourcing) : profils Instagram
-- lus par ig-sourcing (gardés 7 j) et marques citées par les créatrices. Écriture
-- serveur seulement ; l'agence lit, et change le statut d'une marque du radar.
create table if not exists public.ig_profiles (
  username   text primary key,
  data       jsonb,
  why        text,
  scanned_at timestamptz,
  at         timestamptz not null default now()
);
create table if not exists public.ig_radar (
  brand      text primary key,
  posts      jsonb not null default '[]'::jsonb,
  status     text not null default 'nouveau' check (status in ('nouveau', 'ignore', 'pipeline')),
  first_seen timestamptz default now(),
  last_seen  timestamptz default now()
);
-- Agence détectée et date de lecture par les outils Claude (sql/2026-11-24-base-createurs-profils).
alter table public.ig_profiles add column if not exists agence text
  check (agence is null or agence in ('oui', 'non', 'a_verifier'));
alter table public.ig_profiles add column if not exists agence_nom text;
alter table public.ig_profiles add column if not exists profil_lu_at timestamptz;
create index if not exists ig_profiles_profil_lu_idx on public.ig_profiles (profil_lu_at asc nulls first);
alter table public.ig_profiles enable row level security;
alter table public.ig_radar    enable row level security;
revoke all on public.ig_profiles from anon;
revoke all on public.ig_radar    from anon;
drop policy if exists ig_profiles_agency_read on public.ig_profiles;
create policy ig_profiles_agency_read on public.ig_profiles for select to authenticated using (public.is_agency());
drop policy if exists ig_radar_agency_read on public.ig_radar;
create policy ig_radar_agency_read on public.ig_radar for select to authenticated using (public.is_agency());
drop policy if exists ig_radar_agency_update on public.ig_radar;
create policy ig_radar_agency_update on public.ig_radar for update to authenticated
  using (public.is_agency()) with check (public.is_agency());
-- Marques chaudes du radar (sql/2026-11-25-radar-marques-chaudes.sql, rendue rapide par sql/2026-11-27-marques-chaudes-rapide.sql) : lues par le connecteur.
create or replace function public.radar_marques_chaudes(p_jours int default 30, p_limite int default 50)
returns table (marque text, payes int, createurs text[], roster text[], dernier timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  -- Rapide (2026-11-27) : le carnet est normalisé une seule fois (cles), et les marques
  -- confirmées, hors carnet, sont choisies AVANT de déplier leurs posts.
  with cles as materialized (
    select regexp_replace(regexp_replace(lower(coalesce(c.instagram, '')), '^(https?://(www\.)?instagram\.com/|@)', ''), '[/?#].*$', '') as k
    from public.contacts c
    union
    select lower(replace(coalesce(c.brand, ''), ' ', '')) from public.contacts c
  ), marques as (
    select r.brand, r.posts
    from public.ig_radar r
    join public.ig_profiles ip on ip.username = r.brand and (ip.data->>'isBrand') = 'true'
    where r.status = 'nouveau'
      and r.last_seen > now() - make_interval(days => greatest(least(p_jours, 90), 1))
      and not exists (select 1 from cles where cles.k = r.brand)
  ), p as (
    select m.brand, e
    from marques m
    cross join lateral jsonb_array_elements(coalesce(m.posts, '[]'::jsonb)) e
    where jsonb_typeof(e) = 'object'
      and (e->>'paid') = 'true'
      -- CASE : la conversion n'est tentée que sur une date bien formée (ordre garanti).
      and (case when (e->>'at') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then (e->>'at')::timestamptz end)
          > now() - make_interval(days => greatest(least(p_jours, 90), 1))
  ), agg as (
    select brand,
           count(*)::int as payes,
           array_agg(distinct e->>'c') filter (where coalesce(e->>'c', '') <> '') as createurs,
           array_agg(distinct e->>'c') filter (where (e->>'roster') = 'true' and coalesce(e->>'c', '') <> '') as roster,
           max(case when (e->>'at') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then (e->>'at')::timestamptz end) as dernier
    from p
    group by brand
  )
  select a.brand, a.payes, coalesce(a.createurs, '{}'), coalesce(a.roster, '{}'), a.dernier
  from agg a
  order by cardinality(coalesce(a.createurs, '{}')) desc, a.payes desc, a.dernier desc
  limit greatest(least(p_limite, 200), 1);
$$;

revoke all on function public.radar_marques_chaudes(int, int) from public, anon, authenticated;
grant execute on function public.radar_marques_chaudes(int, int) to service_role;

-- Compteur de demandes à Meta (sql/2026-10-13-instagram-quota) : une ligne, écrite
-- par les fonctions Instagram, lue par l'agence (Sourcing, Scouting).
create table if not exists public.ig_quota (
  id   int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  at   timestamptz not null default now()
);
alter table public.ig_quota enable row level security;
revoke all on public.ig_quota from anon;
drop policy if exists ig_quota_agency_read on public.ig_quota;
create policy ig_quota_agency_read on public.ig_quota for select to authenticated using (public.is_agency());

-- YouTube · Sourcing (sql/2026-10-14-youtube-sourcing) : chaînes lues par yt-sourcing
-- (cache 7 j) et unités YouTube consommées par jour. Lecture agence, écriture serveur.
create table if not exists public.yt_channels (
  id   text primary key,
  data jsonb not null,
  at   timestamptz not null default now()
);
create table if not exists public.yt_quota (
  day   date primary key,
  units int not null default 0
);
alter table public.yt_channels enable row level security;
alter table public.yt_quota    enable row level security;
revoke all on public.yt_channels from anon;
revoke all on public.yt_quota    from anon;
drop policy if exists yt_channels_agency_read on public.yt_channels;
create policy yt_channels_agency_read on public.yt_channels for select to authenticated using (public.is_agency());
drop policy if exists yt_quota_agency_read on public.yt_quota;
create policy yt_quota_agency_read on public.yt_quota for select to authenticated using (public.is_agency());

-- TikTok · connexion des créatrices (sql/2026-10-14-tiktok-connexion ; cron tt-sync-quotidien
-- dans ce fichier daté) : jetons dans tt_accounts (aucune politique), chiffres dans
-- creators.tt / collabs.tt (écrits par tt-sync, garde tt_guard comme pour ig).
create table if not exists public.tt_accounts (
  creator_id         uuid primary key references public.creators(id) on delete cascade,
  open_id            text not null,
  username           text,
  token              text not null,
  expires_at         timestamptz,
  refresh_token      text,
  refresh_expires_at timestamptz,
  scopes             text,
  connected_at       timestamptz default now(),
  refreshed_at       timestamptz
);
alter table public.tt_accounts enable row level security;
revoke all on public.tt_accounts from anon, authenticated;

alter table public.creators add column if not exists tt jsonb;
alter table public.collabs  add column if not exists tt jsonb;

-- Même garde que creators.ig : une créatrice ne peut pas écrire ses propres chiffres.
create or replace function public.tt_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if public.is_agency()
     or coalesce(auth.role(), '') = 'service_role'
     or current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.tt := null;
  else
    new.tt := old.tt;
  end if;
  return new;
end $$;
drop trigger if exists creators_tt_guard on public.creators;
create trigger creators_tt_guard before insert or update on public.creators
  for each row execute function public.tt_guard();

-- TikTok · radar à collabs (sql/2026-10-14-tiktok-radar ; cron tt-radar-quotidien dans ce
-- fichier daté) : contenus sponsorisés en France (API Commercial Content de TikTok).
create table if not exists public.tt_commercial (
  id         text primary key,                 -- id du contenu chez TikTok
  created    date,                             -- date de publication
  label      text,                             -- « Paid partnership »…
  brands     text[] not null default '{}',     -- marques qui paient
  creator    text,                             -- @ TikTok de la créatrice (minuscules)
  video_url  text,
  cover      text,
  country    text not null default 'FR',
  fetched_at timestamptz not null default now()
);
create index if not exists tt_commercial_created_idx on public.tt_commercial (created desc);
create index if not exists tt_commercial_creator_idx on public.tt_commercial (creator);
create table if not exists public.tt_brand_status (
  brand  text primary key,                     -- nom de marque en minuscules, sans accents
  status text not null default 'nouveau' check (status in ('nouveau', 'ignore', 'pipeline')),
  at     timestamptz not null default now()
);
alter table public.tt_commercial   enable row level security;
alter table public.tt_brand_status enable row level security;
revoke all on public.tt_commercial   from anon;
revoke all on public.tt_brand_status from anon;
drop policy if exists tt_commercial_agency_read on public.tt_commercial;
create policy tt_commercial_agency_read on public.tt_commercial for select to authenticated using (public.is_agency());
drop policy if exists tt_brand_status_agency on public.tt_brand_status;
create policy tt_brand_status_agency on public.tt_brand_status for all to authenticated
  using (public.is_agency()) with check (public.is_agency());

-- YouTube · radar à collabs (sql/2026-10-14-youtube-radar ; cron yt-radar-quotidien dans ce
-- fichier daté) : vidéos sponsorisées des créatrices, regroupées par marque.
create table if not exists public.yt_radar (
  brand      text primary key,                -- clé de marque (minuscules, sans ponctuation)
  name       text not null,                   -- nom affiché
  posts      jsonb not null default '[]'::jsonb,
  status     text not null default 'nouveau' check (status in ('nouveau', 'ignore', 'pipeline')),
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);
alter table public.yt_radar enable row level security;
revoke all on public.yt_radar from anon;
drop policy if exists yt_radar_agency_read on public.yt_radar;
create policy yt_radar_agency_read on public.yt_radar for select to authenticated using (public.is_agency());
drop policy if exists yt_radar_agency_update on public.yt_radar;
create policy yt_radar_agency_update on public.yt_radar for update to authenticated
  using (public.is_agency()) with check (public.is_agency());

-- YouTube · connexion des créatrices (sql/2026-10-14-youtube-connexion ; cron yt-sync-quotidien
-- dans ce fichier daté) : jetons dans yt_accounts (aucune politique), chiffres dans creators.yt.
create table if not exists public.yt_accounts (
  creator_id    uuid primary key references public.creators(id) on delete cascade,
  channel_id    text not null,
  title         text,
  token         text,
  expires_at    timestamptz,
  refresh_token text not null,
  scopes        text,
  connected_at  timestamptz default now(),
  refreshed_at  timestamptz
);
alter table public.yt_accounts enable row level security;
revoke all on public.yt_accounts from anon, authenticated;

alter table public.creators add column if not exists yt jsonb;

alter table public.collabs add column if not exists yt jsonb;

create or replace function public.yt_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if public.is_agency()
     or coalesce(auth.role(), '') = 'service_role'
     or current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.yt := null;
  else
    new.yt := old.yt;
  end if;
  return new;
end $$;
drop trigger if exists creators_yt_guard on public.creators;
create trigger creators_yt_guard before insert or update on public.creators
  for each row execute function public.yt_guard();

-- Instagram · DM de TTP, posts programmés, agences concurrentes
-- (sql/2026-10-14-instagram-dm-posts-concurrents ; crons ig-inbox-horaire et
-- ig-publish-minute dans ce fichier daté, pas ici).
-- 1. Messages privés ---------------------------------------------------------
create table if not exists public.ig_threads (
  id           text primary key,              -- id de conversation chez Meta
  username     text,                          -- @ de l'interlocuteur, minuscules
  name         text,
  igsid        text,                          -- id Instagram de l'interlocuteur (propre à TTP)
  picture      text,
  followers    int,
  updated_at   timestamptz,                   -- dernier message
  last_text    text,
  last_from_me boolean,
  emails       text[] not null default '{}',  -- emails donnés par l'interlocuteur
  contact_id   uuid references public.contacts(id) on delete set null,
  hidden       boolean not null default false,
  synced_at    timestamptz not null default now()
);
-- Date du premier message (import de l'historique, sql/2026-11-24-dm-historique).
alter table public.ig_threads add column if not exists first_at timestamptz;
create index if not exists ig_threads_updated_idx  on public.ig_threads (updated_at desc);
create index if not exists ig_threads_username_idx on public.ig_threads (username);
create table if not exists public.ig_messages (
  id        text primary key,                 -- id du message chez Meta
  thread_id text not null references public.ig_threads(id) on delete cascade,
  at        timestamptz not null,
  me        boolean not null default false,   -- envoyé par TTP
  text      text not null default ''
);
create index if not exists ig_messages_thread_idx on public.ig_messages (thread_id, at);
-- Photos, vidéos, vocaux et partages d'un message, lus à part par ig-inbox :
-- [{ kind, path?, src?, link?, name? }] (sql/2026-10-28-dm-instagram-medias).
alter table public.ig_messages add column if not exists media jsonb;
alter table public.ig_threads  enable row level security;
alter table public.ig_messages enable row level security;
revoke all on public.ig_threads  from anon;
revoke all on public.ig_messages from anon;
drop policy if exists ig_threads_agency_read on public.ig_threads;
create policy ig_threads_agency_read on public.ig_threads for select to authenticated using (public.is_agency());
drop policy if exists ig_threads_agency_update on public.ig_threads;
create policy ig_threads_agency_update on public.ig_threads for update to authenticated
  using (public.is_agency()) with check (public.is_agency());
drop policy if exists ig_messages_agency_read on public.ig_messages;
create policy ig_messages_agency_read on public.ig_messages for select to authenticated using (public.is_agency());
-- Fichiers des DM (photos, vidéos, vocaux, partages : colonne media ci-dessus, même script
-- sql/2026-10-28-dm-instagram-medias) : ig-inbox les recopie dans ce bucket PRIVÉ, car leurs
-- adresses chez Meta expirent. Lecture par l'agence seulement (liens signés d'une heure),
-- écriture par le serveur seulement. Pas de limite de taille ni de type, comme en production.
insert into storage.buckets (id, name, public)
  values ('ig-media', 'ig-media', false)
  on conflict (id) do update set public = false;
drop policy if exists ig_media_agency_read on storage.objects;
create policy ig_media_agency_read on storage.objects for select to authenticated
  using (bucket_id = 'ig-media' and public.is_agency());

-- 2. Posts programmés ----------------------------------------------------------
create table if not exists public.ig_planned (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'post' check (kind in ('post', 'carrousel', 'reel', 'story')),
  caption       text not null default '' check (char_length(caption) <= 2200),
  media         jsonb not null default '[]'::jsonb,   -- [{ url, path, type: image|video, w, h }]
  cover_url     text,                                 -- couverture d'un reel (facultative)
  collaborators text[] not null default '{}',         -- 3 @ max, invités en collaboration
  share_to_feed boolean not null default true,        -- reel : aussi dans la grille
  template      text,                                 -- signature | collab | null
  ref           jsonb,                                -- { creator, collab_id, brand }
  scheduled_at  timestamptz,                          -- null = brouillon
  status        text not null default 'brouillon'
                check (status in ('brouillon', 'programme', 'en_cours', 'publie', 'erreur')),
  container_id  text,                                 -- préparation chez Meta (serveur)
  children      jsonb,                                -- carrousel : une préparation par photo
  started_at    timestamptz,
  media_id      text,
  permalink     text,
  error         text,
  attempts      int not null default 0,
  lock_until    timestamptz,                          -- verrou : jamais publié deux fois
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  published_at  timestamptz
);
create index if not exists ig_planned_due_idx on public.ig_planned (status, scheduled_at);
-- Un contenu modifié repart de zéro chez Meta (sinon on publierait l'ancienne version).
create or replace function public.ig_planned_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    if (new.kind, new.caption, new.media, new.cover_url, new.collaborators, new.share_to_feed)
       is distinct from (old.kind, old.caption, old.media, old.cover_url, old.collaborators, old.share_to_feed) then
      new.container_id := null;
      new.children := null;
      new.started_at := null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ig_planned_touch on public.ig_planned;
create trigger ig_planned_touch before insert or update on public.ig_planned
  for each row execute function public.ig_planned_touch();
alter table public.ig_planned enable row level security;
revoke all on public.ig_planned from anon;
drop policy if exists ig_planned_agency on public.ig_planned;
create policy ig_planned_agency on public.ig_planned for all to authenticated
  using (public.is_agency()) with check (public.is_agency());

-- Photos et vidéos des posts : lecture publique (Meta les télécharge), écriture agence.
insert into storage.buckets (id, name, public, allowed_mime_types)
  values ('ig-posts', 'ig-posts', true, array['image/jpeg', 'video/mp4', 'video/quicktime'])
  on conflict (id) do update set public = true, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists ig_posts_obj_agency on storage.objects;
create policy ig_posts_obj_agency on storage.objects for all to authenticated
  using (bucket_id = 'ig-posts' and public.is_agency())
  with check (bucket_id = 'ig-posts' and public.is_agency());

-- 3. Agences concurrentes ------------------------------------------------------
create table if not exists public.ig_rivals (
  username  text primary key check (username ~ '^[a-z0-9._]{1,30}$'),
  self      boolean not null default false,          -- le compte de TTP, pour comparer
  data      jsonb,                                   -- dernier relevé (abonnés, rythme…)
  history   jsonb not null default '[]'::jsonb,      -- [{ d, f, p }] un point par jour
  creators  jsonb not null default '[]'::jsonb,      -- créatrices mises en avant
  brands    jsonb not null default '[]'::jsonb,      -- marques avec qui elle travaille
  why       text,                                    -- raison si illisible (compte perso…)
  added_at  timestamptz not null default now(),
  read_at   timestamptz
);
alter table public.ig_rivals enable row level security;
revoke all on public.ig_rivals from anon;
drop policy if exists ig_rivals_agency_read on public.ig_rivals;
create policy ig_rivals_agency_read on public.ig_rivals for select to authenticated using (public.is_agency());
drop policy if exists ig_rivals_agency_insert on public.ig_rivals;
create policy ig_rivals_agency_insert on public.ig_rivals for insert to authenticated with check (public.is_agency());
drop policy if exists ig_rivals_agency_delete on public.ig_rivals;
create policy ig_rivals_agency_delete on public.ig_rivals for delete to authenticated using (public.is_agency() and not self);

-- 4. Dernier passage des fonctions -----------------------------------------------
create table if not exists public.ig_sync_state (
  key  text primary key,
  data jsonb not null default '{}'::jsonb,
  at   timestamptz not null default now()
);
alter table public.ig_sync_state enable row level security;
revoke all on public.ig_sync_state from anon;
drop policy if exists ig_sync_state_agency_read on public.ig_sync_state;
create policy ig_sync_state_agency_read on public.ig_sync_state for select to authenticated using (public.is_agency());


-- DONNÉES AGENCE PURES : agence seulement
-- contacts : partagés — l'agence voit/gère tout ; le créateur voit ceux de l'agence
-- (creator NULL) + ajoute/gère les siens (creator = son nom). (sql/12)
-- LECTURE large (agence + contacts partagés `creator is null` + les siens) MAIS
-- ÉCRITURE (INSERT/UPDATE/DELETE) réservée à `is_agency() or creator = my_creator()` :
-- sans ce découpage, la branche `creator is null` dans un `for all` laissait tout
-- compte connecté SUPPRIMER/réattribuer le carnet partagé de l'agence. (audit 2026-07-13)
create policy contacts_read  on public.contacts for select to authenticated
  using (public.is_agency() or creator is null or creator = public.my_creator());
create policy contacts_write on public.contacts for all to authenticated
  using (public.is_agency() or creator = public.my_creator())
  with check (public.is_agency() or creator = public.my_creator());
-- invoices : ÉCRITURE réservée à l'agence ; le créateur ne peut que LIRE les siennes.
-- (Comme documents : un `for all` incluant le créateur le laissait modifier/insérer/
--  supprimer ses propres factures — falsifier le CA, effacer une facture en retard.)
-- Finance : l'accès AGENCE aux factures est réservé aux FONDATEURS (is_founder()).
create policy invoices_agency       on public.invoices for all    to authenticated
  using (public.is_founder()) with check (public.is_founder());
create policy invoices_creator_read on public.invoices for select to authenticated
  using (public.is_founder() or creator = public.my_creator());
create policy prospects_agency   on public.prospects   for all to authenticated using (public.is_agency()) with check (public.is_agency());
-- module_rows : blob agence ; la ligne '__finance_state__' (argent) aux seuls fondateurs
-- (sql/2026-10-25-finance-fondateurs.sql).
create policy module_rows_agency on public.module_rows for all to authenticated
  using (public.is_agency() and (module <> '__finance_state__' or public.is_founder()))
  with check (public.is_agency() and (module <> '__finance_state__' or public.is_founder()));

-- DONNÉES PAR CRÉATEUR : agence = tout ; créateur = uniquement les siennes
create policy todos_scoped  on public.todos  for all to authenticated
  using (public.is_agency() or creator = public.my_creator()) with check (public.is_agency() or creator = public.my_creator());
create policy briefs_scoped on public.briefs for all to authenticated
  using (public.is_agency() or creator = public.my_creator()) with check (public.is_agency() or creator = public.my_creator());
create policy gifting_scoped on public.gifting for all to authenticated
  using (public.is_agency() or creator = public.my_creator()) with check (public.is_agency() or creator = public.my_creator());
create policy ideas_scoped  on public.ideas  for all to authenticated
  using (public.is_agency() or creator = public.my_creator()) with check (public.is_agency() or creator = public.my_creator());

-- COLLABS : agence = tout ; créatrice = ses collabs. `collab_steps` = historique
-- daté (lecture agence + créatrice liée ; écrit surtout par le trigger DEFINER).
create policy collabs_scoped on public.collabs for all to authenticated
  using (public.is_agency() or creator = public.my_creator())
  with check (public.is_agency() or creator = public.my_creator());
create policy collab_steps_read on public.collab_steps for select to authenticated
  using (public.is_agency() or exists (
    select 1 from public.collabs c where c.id = collab_steps.collab_id and c.creator = public.my_creator()));
create policy collab_steps_agency on public.collab_steps for all to authenticated
  using (public.is_agency()) with check (public.is_agency());
-- updated_at auto + journalisation datée de chaque changement d'étape.
create or replace function public.collabs_touch() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists collabs_touch_upd on public.collabs;
create trigger collabs_touch_upd before update on public.collabs
  for each row execute function public.collabs_touch();
create or replace function public.collabs_log_step() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.collab_steps(collab_id, step, reached_at)
      values (new.id, new.step, coalesce(new.created_at, now()));
  elsif (tg_op = 'UPDATE' and new.step is distinct from old.step) then
    insert into public.collab_steps(collab_id, step, reached_at) values (new.id, new.step, now());
  end if;
  return new;
end $$;
drop trigger if exists collabs_log_step_ins on public.collabs;
create trigger collabs_log_step_ins after insert on public.collabs
  for each row execute function public.collabs_log_step();
drop trigger if exists collabs_log_step_upd on public.collabs;
create trigger collabs_log_step_upd after update on public.collabs
  for each row execute function public.collabs_log_step();

-- Collab au centre (sql/2026-10-23-collab-id.sql) : collab_id sur factures, tâches,
-- rendez-vous, briefs, gifting ; un créateur ne relie qu'à SES collabs.
-- 1) Colonne collab_id + index
alter table public.invoices add column if not exists collab_id uuid references public.collabs(id) on delete set null;
alter table public.todos    add column if not exists collab_id uuid references public.collabs(id) on delete set null;
alter table public.events   add column if not exists collab_id uuid references public.collabs(id) on delete set null;
alter table public.briefs   add column if not exists collab_id uuid references public.collabs(id) on delete set null;
alter table public.gifting  add column if not exists collab_id uuid references public.collabs(id) on delete set null;
create index if not exists invoices_collab_idx on public.invoices (collab_id);
create index if not exists todos_collab_idx    on public.todos (collab_id);
create index if not exists events_collab_idx   on public.events (collab_id);
create index if not exists briefs_collab_idx   on public.briefs (collab_id);
create index if not exists gifting_collab_idx  on public.gifting (collab_id);
-- Prospects : proposition venue de Tarifs + lien contact / collab (sql/2026-10-23-prospects-proposition.sql).
alter table public.prospects add column if not exists creator      text;
alter table public.prospects add column if not exists deliverables text;
alter table public.prospects add column if not exists proposal     jsonb;
alter table public.prospects add column if not exists contact_id   uuid references public.contacts(id) on delete set null;
alter table public.prospects add column if not exists collab_id    uuid references public.collabs(id) on delete set null;
create index if not exists prospects_contact_idx on public.prospects (contact_id);
create index if not exists prospects_collab_idx  on public.prospects (collab_id);

-- Espace créateur › Missions › « En discussion » (sql/2026-10-23-negociations-createur.sql) :
-- colonnes non sensibles de SES négociations, sans ouvrir la table prospects.
create or replace function public.creator_discussions(p_creator text default null)
returns table (id uuid, brand text, deliverables text, stage text, created_at timestamptz)
  language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.brand, p.deliverables, p.stage, p.created_at
    from public.prospects p
   where p.collab_id is null
     and lower(btrim(coalesce(p.creator, ''))) <> ''
     and lower(btrim(p.creator)) = lower(btrim(
           case when public.is_agency() then coalesce(p_creator, '') else coalesce(public.my_creator(), '') end))
   order by p.created_at desc
   limit 50;
$$;
revoke all on function public.creator_discussions(text) from public, anon;
grant execute on function public.creator_discussions(text) to authenticated;

-- Espace créateur › Agenda (sql/2026-11-04-echeances-createur.sql) : les fins de contrat
-- (`contractDeadlines`) et les exclusivités CONFIRMÉES (`exclusivites`, pas celles « à
-- confirmer ») du créateur connecté, lues dans le blob agence (module_rows, qu'il ne peut
-- pas lire). Rien d'autre ne sort (ni montant, ni droits). L'agence peut demander celles
-- d'un créateur précis (p_creator), comme creator_discussions. Appelée par
-- supabase.rpc('creator_echeances') dans src/views/CreatorSpace.tsx.
create or replace function public.creator_echeances(p_creator text default null)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  with me as (
    select lower(btrim(case when public.is_agency() then coalesce(p_creator, '') else coalesce(public.my_creator(), '') end)) as n
  ), blob as (
    select a::jsonb as j from public.module_rows where module = '__app_state__' limit 1
  ), dl as (
    select d from blob, me,
      jsonb_array_elements(case when jsonb_typeof(blob.j -> 'contractDeadlines') = 'array' then blob.j -> 'contractDeadlines' else '[]'::jsonb end) d
    where me.n <> '' and jsonb_typeof(d) = 'object' and lower(btrim(coalesce(d ->> 'creator', ''))) = me.n
  ), ex as (
    select x from blob, me,
      jsonb_array_elements(case when jsonb_typeof(blob.j -> 'exclusivites') = 'array' then blob.j -> 'exclusivites' else '[]'::jsonb end) x
    where me.n <> '' and jsonb_typeof(x) = 'object'
      and lower(btrim(coalesce(x ->> 'creator', ''))) = me.n
      and coalesce(x -> 'pending', 'false'::jsonb) <> 'true'::jsonb
  )
  select jsonb_build_object(
    'contrats', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d ->> 'id', 'creator', d ->> 'creator', 'type', d ->> 'type', 'start', d ->> 'start', 'months', d -> 'months')) from dl), '[]'::jsonb),
    'exclusivites', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x ->> 'id', 'creator', x ->> 'creator', 'brand', x ->> 'brand', 'scope', x ->> 'scope',
        'competitors', coalesce(x -> 'competitors', '[]'::jsonb), 'start', x ->> 'start', 'end', x ->> 'end')) from ex), '[]'::jsonb)
  );
$$;
revoke all on function public.creator_echeances(text) from public, anon;
grant execute on function public.creator_echeances(text) to authenticated;


-- 2) Garde : hors agence, collab_id doit être vide ou une collab du créateur connecté.
--    Sans compte connecté (serveur, SQL Editor) : rien n'est bloqué (sql/2026-10-25-audit).
create or replace function public.collab_link_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.collab_id is null or auth.uid() is null or public.is_agency() then return new; end if;
  if tg_op = 'UPDATE' and new.collab_id is not distinct from old.collab_id then return new; end if;
  if not exists (select 1 from public.collabs c where c.id = new.collab_id and c.creator = public.my_creator()) then
    raise exception 'collab_id interdit' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists todos_collab_link_guard on public.todos;
create trigger todos_collab_link_guard before insert or update of collab_id on public.todos
  for each row execute function public.collab_link_guard();
drop trigger if exists events_collab_link_guard on public.events;
create trigger events_collab_link_guard before insert or update of collab_id on public.events
  for each row execute function public.collab_link_guard();
drop trigger if exists gifting_collab_link_guard on public.gifting;
create trigger gifting_collab_link_guard before insert or update of collab_id on public.gifting
  for each row execute function public.collab_link_guard();
drop trigger if exists briefs_collab_link_guard on public.briefs;
create trigger briefs_collab_link_guard before insert or update of collab_id on public.briefs
  for each row execute function public.collab_link_guard();
drop trigger if exists invoices_collab_link_guard on public.invoices;
create trigger invoices_collab_link_guard before insert or update of collab_id on public.invoices
  for each row execute function public.collab_link_guard();

-- Briefs ⇄ Collabs (sql/2026-11-04-briefs-collabs-synchro.sql) : toujours à jour, sans
-- saisie à la main.
-- 1) Une nouvelle collab (active ou gagnée) crée son brief (marque, créateur, livrables),
--    relié par briefs.collab_id et collabs.brief_id.
-- 2) L'étape de la collab fixe le statut du brief : 1 Signature → « attente »,
--    2 Brief transmis à 5 Validation → « cours », 6 Publication et après → « terminé ».
-- 3) Un brief passé « cours » ou « terminé » par l'agence fait AVANCER la collab (étape 2
--    ou 6 au moins), jamais reculer. Un créateur qui change le statut de son brief ne
--    touche pas à la collab.
-- La condition pg_trigger_depth() < 2 des déclencheurs de mise à jour évite la boucle
-- collab ⇄ brief. Le rattrapage des collabs existantes du script daté (données) n'est pas
-- repris ici.
create or replace function public.brief_status_for_step(p_step integer)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when coalesce(p_step, 1) <= 1 then 'attente'
              when p_step <= 5 then 'cours'
              else 'terminé' end
$$;

-- Étape minimale qu'un statut de brief impose à sa collab (null = aucune).
create or replace function public.collab_step_for_brief(p_status text)
returns integer language sql immutable set search_path = public, pg_temp as $$
  select case lower(coalesce(p_status, ''))
              when 'cours' then 2
              when 'terminé' then 6
              when 'termine' then 6
              else null end
$$;

-- Collab créée → son brief ; étape changée (UPDATE) → statut du brief.
create or replace function public.collabs_sync_brief()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_brief uuid;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('active', 'gagnee') then return new; end if;
    select id into v_brief from public.briefs where collab_id = new.id limit 1;
    if v_brief is null then
      insert into public.briefs (brand, creator, deliverables, due, status, collab_id)
      values (new.brand, new.creator, coalesce(new.deliverables, ''), '—',
              public.brief_status_for_step(new.step), new.id)
      returning id into v_brief;
    end if;
    update public.collabs set brief_id = v_brief where id = new.id and brief_id is distinct from v_brief;
    return new;
  end if;
  if new.step is distinct from old.step then
    update public.briefs
       set status = public.brief_status_for_step(new.step)
     where collab_id = new.id
       and status is distinct from public.brief_status_for_step(new.step);
  end if;
  return new;
end $$;
drop trigger if exists collabs_sync_brief_ins on public.collabs;
create trigger collabs_sync_brief_ins after insert on public.collabs
  for each row execute function public.collabs_sync_brief();
drop trigger if exists collabs_sync_brief_upd on public.collabs;
create trigger collabs_sync_brief_upd after update of step on public.collabs
  for each row when (pg_trigger_depth() < 2) execute function public.collabs_sync_brief();

-- Brief « cours » ou « terminé » (par l'agence, ou sans compte connecté) → la collab
-- avance, jamais ne recule.
create or replace function public.briefs_sync_collab()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_min integer := public.collab_step_for_brief(new.status);
begin
  if new.collab_id is null or v_min is null then return new; end if;
  if new.status is not distinct from old.status and new.collab_id is not distinct from old.collab_id then return new; end if;
  if auth.uid() is not null and not public.is_agency() then return new; end if;
  update public.collabs set step = v_min where id = new.collab_id and coalesce(step, 1) < v_min;
  return new;
end $$;
drop trigger if exists briefs_sync_collab_upd on public.briefs;
create trigger briefs_sync_collab_upd after update of status, collab_id on public.briefs
  for each row when (pg_trigger_depth() < 2) execute function public.briefs_sync_collab();
-- Droits comme en production (sql/2026-11-25-securite-fonctions-anon.sql, puis
-- sql/2026-11-27-securite-lot2.sql) : ces deux fonctions de déclencheur ne s'appellent pas
-- directement ; seuls le propriétaire et service_role gardent le droit d'exécution. Posé
-- ici, juste après leur création : les boucles de sécurité de la fin du fichier le font
-- aussi, mais ce retrait tient même si l'ordre des blocs change.
revoke execute on function public.briefs_sync_collab(), public.collabs_sync_brief() from public, anon, authenticated;

-- events : un événement peut concerner plusieurs créateurs (who = "Nom A, Nom B").
-- LECTURE : le créateur voit tout évènement où son nom figure (liste "Nom A, Nom B"),
-- sauf un rendez-vous INTERNE de l'agence (interne = true, par exemple les « Tâche : … »
-- recopiés des tâches internes) (sql/13, sql/2026-11-24-taches-internes-privees).
-- ÉCRITURE/SUPPRESSION : réservée aux évènements qui le concernent LUI SEUL (who = son
-- nom, strict) et qui ne sont pas internes. Sinon un créateur listé pouvait supprimer un
-- évènement multi-créateurs et propager la suppression à l'agenda Google via
-- events_guard_delete (audit 2026-07-13), ou modifier, supprimer ou créer un rendez-vous
-- interne (2026-11-24). Il ne peut pas non plus taguer d'autres créateurs à sa place.
-- La colonne interne est créée en section 1, avec les autres colonnes d'events.
drop policy if exists events_read  on public.events;
create policy events_read  on public.events for select to authenticated
  using (public.is_agency() or (
    public.my_creator() = any(string_to_array(coalesce(who, ''), ', ')) and not interne));
drop policy if exists events_write on public.events;
create policy events_write on public.events for all to authenticated
  using (public.is_agency() or (who = public.my_creator() and not interne))
  with check (public.is_agency() or (who = public.my_creator() and not interne));

-- MESSAGES : agence = tout ; créateur = les siens + annonces globales (creator NULL).
-- Même découpage que contacts : la branche `creator is null` reste en LECTURE mais
-- jamais en écriture (sinon tout compte supprime/détourne les annonces). (audit 2026-07-13)
create policy messages_read  on public.messages for select to authenticated
  using (public.is_agency() or creator = public.my_creator() or creator is null);
create policy messages_write on public.messages for all to authenticated
  using (public.is_agency() or creator = public.my_creator())
  with check (public.is_agency() or creator = public.my_creator());

-- PROFILES : chacun lit le sien ; l'agence gère tout
create policy profiles_self   on public.profiles for select to authenticated using (user_id = auth.uid());
create policy profiles_agency on public.profiles for all    to authenticated using (public.is_agency()) with check (public.is_agency());

-- DOCUMENTS (métadonnées) : l'agence gère TOUT ; le créateur peut seulement LIRE
-- les siens. Le créateur ne doit PAS pouvoir INSÉRER une ligne : sinon il forge
-- une ligne (creator=lui, path=celui d'un autre) et la policy Storage
-- documents_obj_creator_read lui signerait alors le fichier d'un autre créateur.
drop policy if exists documents_scoped on public.documents;
create policy documents_agency on public.documents for all to authenticated
  using (public.is_agency()) with check (public.is_agency());
create policy documents_creator_read on public.documents for select to authenticated
  using (public.is_agency() or creator = public.my_creator());
-- Dépôt de facture par le créateur (cf. sql/creator-depot-facture.sql) : INSERT autorisé
-- UNIQUEMENT pour lui-même ET dans SON dossier `creator-uploads/<auth.uid()>/…`. La
-- contrainte de chemin est ce qui empêche de forger une ligne pointant vers le fichier
-- d'un autre créateur (que documents_obj_creator_read lui signerait). Pas d'UPDATE/DELETE.
create policy documents_creator_insert on public.documents for insert to authenticated
  with check (
    creator = public.my_creator()
    and path like 'creator-uploads/' || auth.uid()::text || '/%'
  );

-- ----------------------------------------------------------------------------
-- 6) STORAGE : bucket privé `documents` (binaires des fichiers)
--    Accès réservé aux comptes connectés (anonyme = rien). Le cloisonnement
--    par créateur est assuré par la table `documents` ci-dessus + URLs signées.
-- ----------------------------------------------------------------------------
-- 25 Mo au plus par fichier, types libres (sql/2026-11-27-securite-lot2).
insert into storage.buckets (id, name, public, file_size_limit)
  values ('documents','documents', false, 26214400)
  on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- Bucket privé `documents` : l'AGENCE gère tout ; un CRÉATEUR ne peut que LIRE
-- (créer une URL signée) les fichiers rattachés à une de SES fiches documents.
-- (Avant : tout compte authentifié avait accès total au bucket entier.)
drop policy if exists documents_obj_auth on storage.objects;
drop policy if exists documents_obj_agency on storage.objects;
drop policy if exists documents_obj_creator_read on storage.objects;
create policy documents_obj_agency on storage.objects for all to authenticated
  using (bucket_id = 'documents' and public.is_agency())
  with check (bucket_id = 'documents' and public.is_agency());
-- (audit 2026-11-11) sans ce drop, relancer SETUP.sql s'arrêtait ici : « policy already exists ».
drop policy if exists documents_obj_creator_insert on storage.objects;
create policy documents_obj_creator_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and name like 'creator-uploads/' || auth.uid()::text || '/%'
  );
create policy documents_obj_creator_read on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.documents d
       where d.path = storage.objects.name and d.creator = public.my_creator()
    )
  );

-- Bucket PUBLIC pour les photos de profil (avatars) : lecture publique (URL
-- permanente), écriture réservée aux comptes connectés. Permet que la photo
-- posée par l'agence OU le créateur soit visible partout (cross-device).
-- Photos seulement, sans SVG, 25 Mo maximum (sql/2026-10-25-audit, sql/2026-11-27-securite-14).
insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
  values ('avatars','avatars', true, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif'], 26214400)
  on conflict (id) do update set allowed_mime_types = excluded.allowed_mime_types,
                                 file_size_limit    = excluded.file_size_limit;

-- Journal des réservations de visio, fonction rdv seulement (sql/2026-11-27-securite-14).
create table if not exists public.rdv_journal (
  id bigserial primary key,
  email text not null,
  cree_le timestamptz not null default now()
);
create index if not exists rdv_journal_cree_le on public.rdv_journal (cree_le);
alter table public.rdv_journal enable row level security;
revoke all on public.rdv_journal from anon, authenticated;
grant select, insert on public.rdv_journal to service_role;
grant usage, select on sequence public.rdv_journal_id_seq to service_role;


-- Lecture : publique (bucket public), pas de policy nécessaire.
-- Upload : tout compte connecté peut poser un avatar (chemins horodatés
--   `slug/<timestamp>.ext` → jamais de collision, toujours un INSERT neuf).
-- Écrasement / suppression : réservés à l'AGENCE — sinon n'importe quel
--   créateur connecté pouvait supprimer ou remplacer l'avatar d'un autre.
drop policy if exists avatars_obj_rw on storage.objects;
drop policy if exists avatars_obj_insert on storage.objects;
drop policy if exists avatars_obj_update on storage.objects;
drop policy if exists avatars_obj_delete on storage.objects;
create policy avatars_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars');
create policy avatars_obj_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and public.is_agency())
  with check (bucket_id = 'avatars' and public.is_agency());
create policy avatars_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and public.is_agency());

-- ============================================================================
-- 7) MODULES ADDITIONNELS (migrations repliées — idempotent, rejouable)
--    Tout ce qui a été ajouté après la 1re version du schéma. Les crons pg_cron
--    NE sont PAS inclus ici (opérationnels, nécessitent CRON_SECRET) — voir
--    sql/05, sql/06, sql/07, sql/11 et migrations/ pour les planifications.
-- ============================================================================

-- ─── 7.1 Outil email : séquences / inscriptions / journal (sql/03) ───────────
create table if not exists public.email_sequences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  steps jsonb not null default '[]',        -- [{delay_days, subject, body}]
  active boolean default true,
  created_at timestamptz default now()
);
create table if not exists public.sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid references public.email_sequences(id) on delete cascade,
  contact_email text not null,
  contact_name text,
  step_index int default 0,
  status text default 'active',             -- active | replied | done | stopped
  thread_id text,
  last_sent_at timestamptz,
  next_due_at timestamptz,
  created_at timestamptz default now()
);
create table if not exists public.email_activity (
  id uuid primary key default gen_random_uuid(),
  contact_email text,
  contact_name text,
  direction text default 'out',             -- out | in
  subject text,
  snippet text,
  source text default 'manual',             -- sequence | mediakit | inbox | manual
  thread_id text,
  gmail_message_id text,
  sequence_id uuid,
  created_at timestamptz default now()
);
create index if not exists seq_enroll_due_idx         on public.sequence_enrollments (status, next_due_at);
create index if not exists email_activity_contact_idx on public.email_activity (contact_email, created_at);
create unique index if not exists email_activity_gmail_msg_uidx on public.email_activity (gmail_message_id) where gmail_message_id is not null;
create index if not exists email_activity_dir_created_idx on public.email_activity (direction, created_at desc);
-- Cloche des mails (sql/2026-11-18-cloche-mails-lus.sql) : gmail-poll note quand le mail a
-- été lu dans Gmail ou Spark (read_at) et de quelle boîte il vient (box).
alter table public.email_activity add column if not exists read_at timestamptz;
alter table public.email_activity add column if not exists box text;
-- « Envoyé par » (sql/2026-11-25-mails-envoye-par.sql) : qui de l'équipe a envoyé le mail.
alter table public.email_activity add column if not exists envoye_par uuid;
alter table public.email_activity add column if not exists envoye_par_nom text;
create index if not exists email_activity_thread_idx on public.email_activity (thread_id) where thread_id is not null;
alter table public.email_sequences      enable row level security;
alter table public.sequence_enrollments enable row level security;
alter table public.email_activity       enable row level security;
drop policy if exists email_sequences_agency      on public.email_sequences;
drop policy if exists sequence_enrollments_agency on public.sequence_enrollments;
drop policy if exists email_activity_agency       on public.email_activity;
create policy email_sequences_agency      on public.email_sequences      for all to authenticated using (public.is_agency()) with check (public.is_agency());
create policy sequence_enrollments_agency on public.sequence_enrollments for all to authenticated using (public.is_agency()) with check (public.is_agency());
create policy email_activity_agency       on public.email_activity       for all to authenticated using (public.is_agency()) with check (public.is_agency());

-- ─── 7.2 Journal des crashs de rendu (sql/08) ────────────────────────────────
-- Écriture : uniquement via l'Edge Function report-error (service role, bypass RLS).
-- Lecture  : réservée à l'agence.
create table if not exists public.error_log (
  id              uuid primary key default gen_random_uuid(),
  message         text,
  page            text,
  stack           text,
  component_stack text,
  url             text,
  user_agent      text,
  role            text,
  created_at      timestamptz default now()
);
alter table public.error_log enable row level security;
drop policy if exists error_log_agency_read on public.error_log;
create policy error_log_agency_read on public.error_log
  for select to authenticated using (public.is_agency());
-- « Marquer résolu » (2026-10-03)
alter table public.error_log add column if not exists resolved_at timestamptz;
create index if not exists error_log_created_idx on public.error_log (created_at desc);
drop policy if exists error_log_agency_update on public.error_log;
create policy error_log_agency_update on public.error_log
  for update to authenticated using (public.is_agency()) with check (public.is_agency());

-- ─── 7.3 Abonnements Web Push (push-subscriptions.sql) ───────────────────────
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_id    uuid references auth.users(id) on delete set null,
  ua         text,
  created_at timestamptz default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_sub_ins on public.push_subscriptions;
drop policy if exists push_sub_upd on public.push_subscriptions;
drop policy if exists push_sub_del on public.push_subscriptions;
drop policy if exists push_sub_sel on public.push_subscriptions;
-- Chaque appareil ne gère QUE son propre abonnement ; l'agence peut lire/supprimer.
-- Les Edge Functions (service_role) bypassent la RLS → le push serveur marche.
create policy push_sub_sel on public.push_subscriptions for select to authenticated
  using (public.is_agency() or user_id = auth.uid());
create policy push_sub_ins on public.push_subscriptions for insert to authenticated
  with check (user_id = auth.uid());
create policy push_sub_upd on public.push_subscriptions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_sub_del on public.push_subscriptions for delete to authenticated
  using (public.is_agency() or user_id = auth.uid());

-- ─── 7.4 Blob agence : écriture atomique + backup quotidien (sql/07) ──────────
-- app_state_set : écrit UNE clé du blob __app_state__ en une instruction (jsonb_set
-- sous verrou de ligne) → deux sauvegardes concurrentes ne s'écrasent plus.
-- Le coalesce de la mise à jour compte : jsonb_set(…, NULL) renverrait NULL et effacerait
-- TOUT le blob (2026-10-15). Les clés « argent » (app_finance_key) vont dans la ligne
-- '__finance_state__', réservée aux fondateurs ; app_state_merge et app_state_list font de
-- même (sql/2026-10-25-finance-fondateurs.sql).
create or replace function public.app_state_set(p_key text, p_value jsonb)
returns void
language plpgsql
security invoker              -- respecte la RLS module_rows (agence seule écrit)
set search_path = public
as $$
declare
  v_id     uuid;
  v_module text := case when public.app_finance_key(p_key) then '__finance_state__' else '__app_state__' end;
begin
  if v_module = '__finance_state__' and auth.uid() is not null and not public.is_founder() then
    raise exception 'réservé aux fondateurs' using errcode = '42501';
  end if;
  select id into v_id
    from public.module_rows
   where module = v_module
   order by created_at desc
   limit 1;
  if v_id is null then
    insert into public.module_rows (module, a)
      values (v_module, jsonb_build_object(p_key, coalesce(p_value, 'null'::jsonb))::text);
  else
    update public.module_rows
       set a = jsonb_set(coalesce(nullif(a, ''), '{}')::jsonb, array[p_key], coalesce(p_value, 'null'::jsonb), true)::text
     where id = v_id;
  end if;
end;
$$;
grant execute on function public.app_state_set(text, jsonb) to authenticated;

-- Réponses de mails préparées par Claude (sql/2026-10-21-reponses-claude.sql).
create table if not exists public.mail_reply_drafts (
  id         uuid primary key default gen_random_uuid(),
  thread_id  text not null,
  box        text not null,
  body       text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  used_at    timestamptz
);
create index if not exists mail_reply_drafts_thread_idx on public.mail_reply_drafts (thread_id, created_at desc);
alter table public.mail_reply_drafts enable row level security;
revoke all on public.mail_reply_drafts from anon;
drop policy if exists mail_reply_drafts_agency on public.mail_reply_drafts;
create policy mail_reply_drafts_agency on public.mail_reply_drafts for all to authenticated
  using (public.is_agency()) with check (public.is_agency());

-- Écritures PARTIELLES (sql/2026-10-21-ecritures-partielles.sql) : seulement les entrées
-- touchées, ligne verrouillée → deux postes ne s'écrasent plus.
create or replace function public.app_state_merge(p_key text, p_set jsonb, p_remove text[] default '{}')
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id     uuid;
  v_all    jsonb;
  v_cur    jsonb;
  v_module text := case when public.app_finance_key(p_key) then '__finance_state__' else '__app_state__' end;
begin
  if v_module = '__finance_state__' and auth.uid() is not null and not public.is_founder() then
    raise exception 'réservé aux fondateurs' using errcode = '42501';
  end if;
  select id, coalesce(nullif(a, ''), '{}')::jsonb into v_id, v_all
    from public.module_rows
   where module = v_module
   order by created_at desc
   limit 1
   for update;
  v_cur := v_all -> p_key;
  if v_cur is null or jsonb_typeof(v_cur) <> 'object' then v_cur := '{}'::jsonb; end if;
  v_cur := (v_cur - coalesce(p_remove, '{}')) || coalesce(p_set, '{}'::jsonb);
  if v_id is null then
    insert into public.module_rows (module, a) values (v_module, jsonb_build_object(p_key, v_cur)::text);
  else
    update public.module_rows set a = jsonb_set(v_all, array[p_key], v_cur, true)::text where id = v_id;
  end if;
end;
$$;
grant execute on function public.app_state_merge(text, jsonb, text[]) to authenticated;

-- app_state_list : liste d'entrées {id, …} d'une clé du blob. Les entrées existantes sont
-- remplacées sur place, retirées (p_remove) ou gardées telles quelles ; les nouvelles vont
-- au début ou à la fin selon p_prepend.
create or replace function public.app_state_list(p_key text, p_upsert jsonb, p_remove text[] default '{}', p_prepend boolean default false)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id     uuid;
  v_all    jsonb;
  v_cur    jsonb;
  v_out    jsonb := '[]'::jsonb;
  v_new    jsonb := '[]'::jsonb;
  v_el     jsonb;
  v_up     jsonb;
  v_ids    text[];
  v_module text := case when public.app_finance_key(p_key) then '__finance_state__' else '__app_state__' end;
begin
  if v_module = '__finance_state__' and auth.uid() is not null and not public.is_founder() then
    raise exception 'réservé aux fondateurs' using errcode = '42501';
  end if;
  select id, coalesce(nullif(a, ''), '{}')::jsonb into v_id, v_all
    from public.module_rows
   where module = v_module
   order by created_at desc
   limit 1
   for update;
  v_cur := v_all -> p_key;
  if v_cur is null or jsonb_typeof(v_cur) <> 'array' then v_cur := '[]'::jsonb; end if;
  if p_upsert is null or jsonb_typeof(p_upsert) <> 'array' then p_upsert := '[]'::jsonb; end if;
  select coalesce(array_agg(x ->> 'id'), '{}') into v_ids from jsonb_array_elements(p_upsert) x;
  for v_el in select * from jsonb_array_elements(v_cur) loop
    if (v_el ->> 'id') = any(coalesce(p_remove, '{}')) then continue; end if;
    if (v_el ->> 'id') = any(v_ids) then
      select x into v_up from jsonb_array_elements(p_upsert) x where x ->> 'id' = v_el ->> 'id' limit 1;
      v_out := v_out || jsonb_build_array(v_up);
    else
      v_out := v_out || jsonb_build_array(v_el);
    end if;
  end loop;
  for v_up in select * from jsonb_array_elements(p_upsert) loop
    if not exists (select 1 from jsonb_array_elements(v_cur) y where y ->> 'id' = v_up ->> 'id') then
      v_new := v_new || jsonb_build_array(v_up);
    end if;
  end loop;
  v_out := case when p_prepend then v_new || v_out else v_out || v_new end;
  if v_id is null then
    insert into public.module_rows (module, a) values (v_module, jsonb_build_object(p_key, v_out)::text);
  else
    update public.module_rows set a = jsonb_set(v_all, array[p_key], v_out, true)::text where id = v_id;
  end if;
end;
$$;
grant execute on function public.app_state_list(text, jsonb, text[], boolean) to authenticated;

-- Instantanés quotidiens du blob (30 j d'historique). Le cron ttp-app-state-backup
-- (sql/07) appelle backup_app_state() ; la planification n'est pas incluse ici.
create table if not exists public.app_state_backups (
  id         uuid primary key default gen_random_uuid(),
  snapshot   text not null,
  created_at timestamptz default now()
);
alter table public.app_state_backups enable row level security;
drop policy if exists app_state_backups_agency on public.app_state_backups;
create policy app_state_backups_agency on public.app_state_backups
  for select to authenticated using (public.is_agency());
-- (aucune policy d'écriture : seule backup_app_state, SECURITY DEFINER, écrit)
create or replace function public.backup_app_state()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_state_backups (snapshot)
    select (coalesce(nullif(a.a, ''), '{}')::jsonb || coalesce(nullif(f.a, ''), '{}')::jsonb)::text
      from (select a from public.module_rows where module = '__app_state__' and a is not null
             order by created_at desc limit 1) a
      left join lateral (select a from public.module_rows where module = '__finance_state__'
             order by created_at desc limit 1) f on true;
  delete from public.app_state_backups where created_at < now() - interval '30 days';
end;
$$;
revoke execute on function public.backup_app_state() from public, anon, authenticated;

-- ─── 7.5 Synchronisation Google Agenda (migrations/20260702_google_calendar.sql)
-- Colonnes de sync sur events : déjà ajoutées plus haut (section events). Ici :
-- fonctions trigger, tables singleton, contrainte/index, triggers. Les crons
-- (google-watch-renew, events-purge-tombstones, google-sync-hourly) sont EXCLUS.

-- 7.5.a Fonctions trigger updated_at (+ garde de source d'écriture).
-- touch_updated_at : corps identique à la production, recopié de la migration
-- (migrations/20260702_google_calendar.sql). Le search_path est celui posé par
-- sql/2026-11-27-securite-lot2.sql (la boucle de ce script, en fin de fichier, le repose aussi).
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  -- Discrimine l'origine de l'écriture. Le rôle Postgres effectif est le plus
  -- fiable : les Edge Functions (sync serveur) se connectent en 'service_role',
  -- l'app front en 'authenticated'. On complète avec la claim JWT (défense en
  -- profondeur) au cas où current_user serait masqué.
  v_pg_role  text := current_user;
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
begin
  -- Écriture serveur (sync) UNIQUEMENT si le rôle effectif est service_role.
  -- Toute autre origine (authenticated = UI/front) est traitée comme 'agence'.
  if v_pg_role <> 'service_role' and coalesce(v_jwt_role, '') <> 'service_role' then
    -- Mutation applicative (agence via l'app) : origine 'agence', horodatage now().
    new.sync_source := 'agence';
    new.updated_at := now();
  else
    -- Écriture serveur (sync). Si marquée 'google', on préserve updated_at posé
    -- explicitement par le code de sync (date Google). Sinon on rafraîchit.
    if new.sync_source is distinct from 'google' then
      new.updated_at := now();
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.touch_updated_at_simple()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 7.5.b Table google_tokens (singleton id=1) — SECRETS, RLS deny-all.
create table if not exists public.google_tokens (
  id             int         primary key default 1,
  google_sub     text,
  google_email   text,
  access_token   text,                                     -- SECRET
  refresh_token  text,                                     -- SECRET
  token_type     text        default 'Bearer',
  scope          text,
  expires_at     timestamptz,
  connected      boolean     not null default false,
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'google_tokens_singleton') then
    alter table public.google_tokens add constraint google_tokens_singleton check (id = 1);
  end if;
end $$;
alter table public.google_tokens enable row level security;
revoke all on table public.google_tokens from anon, authenticated;
drop trigger if exists google_tokens_touch on public.google_tokens;
create trigger google_tokens_touch
  before update on public.google_tokens
  for each row execute function public.touch_updated_at_simple();

-- 7.5.c Table sync_state (singleton id=1) — curseur + watch + lease, RLS deny-all.
create table if not exists public.sync_state (
  id                  int         primary key default 1,
  sync_token          text,
  channel_id          text,
  channel_resource_id text,
  channel_token       text,                                -- SECRET
  channel_expiration  timestamptz,
  last_sync_at        timestamptz,
  syncing             boolean     not null default false,
  syncing_at          timestamptz,
  updated_at          timestamptz not null default now()
);
alter table public.sync_state add column if not exists syncing_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sync_state_singleton') then
    alter table public.sync_state add constraint sync_state_singleton check (id = 1);
  end if;
end $$;
alter table public.sync_state enable row level security;
revoke all on table public.sync_state from anon, authenticated;
drop trigger if exists sync_state_touch on public.sync_state;
create trigger sync_state_touch
  before update on public.sync_state
  for each row execute function public.touch_updated_at_simple();

insert into public.google_tokens (id) values (1) on conflict (id) do nothing;
insert into public.sync_state    (id) values (1) on conflict (id) do nothing;

-- 7.5.d Backfill : les events préexistants sont "déjà à jour" (pas de push initial).
update public.events
   set updated_at     = coalesce(created_at, now()),
       last_synced_at = now(),
       sync_source    = 'agence'
 where google_event_id is null
   and last_synced_at is null;

-- 7.5.e Contrainte UNIQUE + index de sync sur events.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_google_event_id_key') then
    alter table public.events add constraint events_google_event_id_key unique (google_event_id);
  end if;
end $$;
create index if not exists events_updated_at_idx on public.events (updated_at);
create index if not exists events_pending_push_idx
  on public.events (updated_at)
  where sync_source = 'agence' and deleted = false;
create index if not exists events_deleted_idx on public.events (deleted);

-- 7.5.f Triggers events : updated_at + garde DELETE (tombstone si déjà synchronisé).
drop trigger if exists events_touch_updated_at on public.events;
create trigger events_touch_updated_at
  before insert or update on public.events
  for each row execute function public.touch_updated_at();

-- Une ligne déjà synchronisée devient une tombstone (deleted = true), propagée à Google ;
-- une ligne jamais synchronisée se supprime vraiment.
create or replace function public.events_guard_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.google_event_id is not null and old.deleted = false then
    -- Transforme le DELETE en soft-delete (tombstone) et ANNULE le DELETE physique.
    update public.events
       set deleted     = true,
           deleted_at  = now(),
           sync_source = 'agence',
           updated_at  = now()
     where id = old.id;
    return null;  -- annule le DELETE physique
  end if;
  return old;     -- laisse supprimer les lignes non synchronisées
end;
$$;
drop trigger if exists events_guard_delete on public.events;
create trigger events_guard_delete
  before delete on public.events
  for each row execute function public.events_guard_delete();

-- ─── 7.6 Vue publique du roster pour le site vitrine (sql/10) ─────────────────
-- La table creators est privée (RLS to authenticated) ; cette vue (security
-- definer) n'expose QUE des colonnes publiques, lisible en anonyme par le site.
create or replace view public.public_roster
with (security_invoker = false) as
  select name, handle, niche, platform, photo_url, sort_order
  from public.creators
  where coalesce(status, 'actif') <> 'inactif';
grant select on public.public_roster to anon, authenticated;

-- ─── 7.7 Vue publique du media kit par créatrice (sql/14) ────────────────────
-- Expose les champs publics + le blob `mediakit` (contenu media kit non sensible)
-- lu en anonyme par le site (ttpcreators.pro/mediakit/<slug>). Ne JAMAIS mettre de
-- donnée sensible dans le blob mediakit (il devient public via cette vue).
create or replace view public.public_mediakit
with (security_invoker = false) as
  select name, handle, niche, platform, photo_url, sort_order, mediakit
  from public.creators
  where coalesce(status, 'actif') <> 'inactif';
grant select on public.public_mediakit to anon, authenticated;

-- ─── 7.8 Media kit AGENCE : contenu éditable du deck global (sql/media-kit-agence) ─
-- Table SINGLETON (id=1) avec un blob `data` jsonb : intro / piliers / KPIs / contact
-- du deck ttpcreators.pro/mediakit/agence/. Édité dans l'app (vue « Media kit agence »),
-- exposé au site par la vue anon public_agency_mediakit. Écriture réservée à l'agence.
create table if not exists public.agency_mediakit (
  id         int primary key default 1,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint agency_mediakit_singleton check (id = 1)
);
insert into public.agency_mediakit (id, data) values (1, '{}'::jsonb)
  on conflict (id) do nothing;
alter table public.agency_mediakit enable row level security;
drop policy if exists agency_mediakit_read  on public.agency_mediakit;
drop policy if exists agency_mediakit_write on public.agency_mediakit;
create policy agency_mediakit_read  on public.agency_mediakit for select to authenticated
  using (true);
create policy agency_mediakit_write on public.agency_mediakit for all to authenticated
  using (public.is_agency()) with check (public.is_agency());
create or replace view public.public_agency_mediakit
with (security_invoker = false) as
  select data from public.agency_mediakit where id = 1;
grant select on public.public_agency_mediakit to anon, authenticated;

-- ----------------------------------------------------------------------------
-- FEUILLE DE ROUTE PARTAGÉE (suivi créateurs) — cf. sql/creator-roadmap.sql
-- L'agence écrit `roadmap` (partageable), le créateur lit + reporte sa cadence
-- dans `self_cadence`. Le suivi complet (mensuel, journal, alertes) reste agence.
-- ----------------------------------------------------------------------------
create table if not exists public.creator_roadmap (
  creator text primary key,
  roadmap jsonb,
  self_cadence jsonb,
  updated_at timestamptz default now()
);
alter table public.creator_roadmap enable row level security;
drop policy if exists creator_roadmap_read on public.creator_roadmap;
create policy creator_roadmap_read on public.creator_roadmap for select to authenticated
  using (public.is_agency() or creator = public.my_creator());
-- Agence : tout. Créateur : créer / mettre à jour SA ligne (cadence), jamais la supprimer
-- (2026-10-15 ; avant, une seule policy FOR ALL lui permettait d'effacer la feuille de route).
drop policy if exists creator_roadmap_write on public.creator_roadmap;
drop policy if exists creator_roadmap_agency on public.creator_roadmap;
drop policy if exists creator_roadmap_creator_ins on public.creator_roadmap;
drop policy if exists creator_roadmap_creator_upd on public.creator_roadmap;
create policy creator_roadmap_agency on public.creator_roadmap for all to authenticated
  using (public.is_agency()) with check (public.is_agency());
create policy creator_roadmap_creator_ins on public.creator_roadmap for insert to authenticated
  with check (creator = public.my_creator());
create policy creator_roadmap_creator_upd on public.creator_roadmap for update to authenticated
  using (creator = public.my_creator()) with check (creator = public.my_creator());
create or replace function public.creator_roadmap_guard() returns trigger
  language plpgsql security definer as $$
begin
  if not public.is_agency() then
    if tg_op = 'INSERT' then new.roadmap := null; else new.roadmap := old.roadmap; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists creator_roadmap_guard_iu on public.creator_roadmap;
create trigger creator_roadmap_guard_iu before insert or update on public.creator_roadmap
  for each row execute function public.creator_roadmap_guard();

-- ----------------------------------------------------------------------------
-- TÂCHES : sous-tâches (checklist) + pièces jointes — cf. sql/todos-subtasks-attachments.sql
-- ----------------------------------------------------------------------------
alter table public.todos add column if not exists subtasks jsonb;
alter table public.todos add column if not exists attachments jsonb;

-- ----------------------------------------------------------------------------
-- IDÉES : sous-tâches (checklist) — cf. sql/ideas-subtasks.sql
-- ----------------------------------------------------------------------------
alter table public.ideas add column if not exists subtasks jsonb;

-- ----------------------------------------------------------------------------
-- CONTACTS : dernier contact (anti sur-contact) — cf. sql/contacts-last-contacted.sql
-- ----------------------------------------------------------------------------
alter table public.contacts add column if not exists last_contacted timestamptz;

-- ----------------------------------------------------------------------------
-- BRIEFS : PDF joint (jsonb {name,path,docId}) — cf. sql/briefs-pdf.sql
-- ----------------------------------------------------------------------------
alter table public.briefs add column if not exists pdf jsonb;
-- BRIEFS : résumé pour le créateur (jsonb) — cf. sql/2026-10-21-resume-brief.sql
alter table public.briefs add column if not exists resume jsonb;

-- ----------------------------------------------------------------------------
-- VIVIER CRÉATEURS : table creator_pool (agence-only) — cf. sql/creator-pool.sql
-- ----------------------------------------------------------------------------
create table if not exists public.creator_pool (
  id uuid primary key default gen_random_uuid(),
  name text not null, handle text, email text, tag text, note text,
  last_contacted timestamptz, sort_order int default 0, created_at timestamptz default now()
);
alter table public.creator_pool enable row level security;
drop policy if exists creator_pool_agency on public.creator_pool;
create policy creator_pool_agency on public.creator_pool for all to authenticated
  using (public.is_agency()) with check (public.is_agency());

-- Scouting des SPORTIFS (2026-10-19, sql/2026-10-19-scouting-sportifs.sql) : à part du
-- scouting créateurs. tag = sport ; club, niveau. Agence seule.
create table if not exists public.athlete_pool (
  id uuid primary key default gen_random_uuid(),
  name text not null, handle text, email text,
  tag text,            -- sport
  club text, level text,
  note text,
  last_contacted timestamptz, sort_order int default 0, created_at timestamptz default now()
);
alter table public.athlete_pool enable row level security;
revoke all on public.athlete_pool from anon;
drop policy if exists athlete_pool_agency on public.athlete_pool;
create policy athlete_pool_agency on public.athlete_pool for all to authenticated
  using (public.is_agency()) with check (public.is_agency());

-- ----------------------------------------------------------------------------
-- AGENT · schéma agent_lecture : vues en lecture seule pour l'agent IA
-- (cf. sql/2026-09-27-agent-lecture.sql — colonnes sensibles exclues, aucun
--  droit accordé ici : le rôle ttp_agent reçoit ses GRANT en Phase 5).
-- ----------------------------------------------------------------------------
create schema if not exists agent_lecture;
revoke all   on schema agent_lecture from public;
revoke usage on schema agent_lecture from anon, authenticated;

create or replace view agent_lecture.creatrices as
select id, name as nom, handle, platform as plateforme, instagram, tiktok,
       niche as univers, followers, reach, er, status as statut, ville,
       email_pro, stats, followers_history, stats_month as stats_maj,
       created_at as arrivee_le
  from public.creators;

create or replace view agent_lecture.collabs as
select id, brand as marque, creator as creatrice, contact, title as libelle,
       deliverables as livrables, cachet, step as etape, status as statut,
       note, created_at as creee_le, updated_at as maj_le
  from public.collabs;

create or replace view agent_lecture.collab_etapes as
select collab_id, step as etape, reached_at as franchie_le, note
  from public.collab_steps;

create or replace view agent_lecture.briefs as
select id, brand as marque, creator as creatrice, deliverables as livrables,
       due as echeance, status as statut, budget, objectif, created_at
  from public.briefs;

create or replace view agent_lecture.planning as
select id, date, time as heure, title as titre, type, who as qui, source, created_at
  from public.events where deleted = false;

create or replace view agent_lecture.echeances as
select d->>'id' as id, d->>'creator' as creatrice, d->>'type' as type,
       case when (d->>'start') ~ '^\d{4}-\d{2}-\d{2}'
            then left(d->>'start', 10)::date else null end as debut,
       case when (d->>'months') ~ '^\d+(\.\d+)?$'
            then (d->>'months')::numeric else null end as duree_mois,
       case when (d->>'start') ~ '^\d{4}-\d{2}-\d{2}' and (d->>'months') ~ '^\d+$'
            then (left(d->>'start', 10)::date
                  + make_interval(months => (d->>'months')::int))::date
            else null end as fin,
       d->>'note' as note
  from (select a from public.module_rows
         where module = '__app_state__' order by created_at desc limit 1) m,
       jsonb_array_elements(
         coalesce(nullif(m.a, '')::jsonb -> 'contractDeadlines', '[]'::jsonb)) as d;

create or replace view agent_lecture.factures as
select id, ref, party as marque, creator as creatrice, date, status as statut, created_at
  from public.invoices;

create or replace view agent_lecture.reversements as
select e.key as creatrice, p->>'id' as id,
       case when (p->>'date') ~ '^\d{4}-\d{2}-\d{2}'
            then left(p->>'date', 10)::date else null end as paye_le
  from (select a from public.module_rows
         where module = '__finance_state__' order by created_at desc limit 1) m,
       jsonb_each(coalesce(nullif(m.a, '')::jsonb -> 'creatorPayouts', '{}'::jsonb)) as e(key, value),
       jsonb_array_elements(
         case when jsonb_typeof(e.value) = 'array' then e.value else '[]'::jsonb end) as p;

create or replace view agent_lecture.contacts_marques as
select c.id, c.brand as marque,
       coalesce(nullif(trim(concat(coalesce(c.first_name, ''), ' ', coalesce(c.last_name, ''))), ''), c.person) as personne,
       c.role, c.tag, c.email, c.phone as telephone, c.instagram, c.city as ville,
       c.last_contacted as dernier_contact, c.created_at,
       t.derniere_touche, t.canal_touche, t.nb_relances, t.derniere_reponse
  from public.contacts c
  left join lateral (
    select max(x.d) as derniere_touche,
           (array_agg(x.canal order by x.d desc))[1] as canal_touche,
           count(*) filter (where x.kind = 'relance') as nb_relances,
           max(x.d) filter (where x.kind = 'reponse') as derniere_reponse
      from (
        select case when (e->>'date') ~ '^\d{4}-\d{2}-\d{2}'
                    then left(e->>'date', 10)::date end as d,
               e->>'canal' as canal, e->>'kind' as kind
          from jsonb_array_elements(
                 case when jsonb_typeof(c.touches) = 'array' then c.touches else '[]'::jsonb end) e
      ) x
     where x.d is not null
  ) t on true
 where c.creator is null;

create or replace view agent_lecture.prospection as
select id, brand as marque, contact, value as valeur, stage as etape, created_at
  from public.prospects;

create or replace view agent_lecture.scouting as
select id, name as nom, handle, email, tag, note,
       last_contacted as dernier_contact, created_at
  from public.creator_pool;

revoke all on all tables in schema agent_lecture from public, anon, authenticated;
alter default privileges in schema agent_lecture
  revoke all on tables from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- AGENT · schéma agent : les 7 tables où l'agent écrit (cf. sql/2026-09-27-
-- agent-schema.sql). App = RLS agence ; rôle ttp_agent = Phase 5. ⚠️ Nécessite
-- d'ajouter `agent` aux « Exposed schemas » du dashboard (jamais agent_lecture).
-- ----------------------------------------------------------------------------
create schema if not exists agent;
revoke all on schema agent from public, anon;
grant usage on schema agent to authenticated;

create table if not exists agent.cockpits (
  id uuid primary key default gen_random_uuid(),
  jour date not null unique, contenu text not null, cree_le timestamptz default now()
);
create table if not exists agent.actions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('brouillon_mail','whatsapp','linkedin','instagram','alerte')),
  cible text, contexte text, contenu text, lien_spark text,
  statut text not null default 'a_valider'
    check (statut in ('a_valider','envoye','modifie_envoye','ecarte')),
  cree_le timestamptz default now(), traite_le timestamptz
);
create index if not exists agent_actions_statut_idx on agent.actions (statut);
-- Types de proposition (2026-11-23, sql/2026-11-23-a-valider-avancer-collab.sql) : + avancer_collab.
alter table agent.actions drop constraint if exists actions_type_check;
alter table agent.actions add constraint actions_type_check
  check (type = any (array['brouillon_mail', 'whatsapp', 'linkedin', 'instagram', 'alerte', 'avancer_collab']));
-- Statut « valide » (2026-11-18, sql/2026-11-18-alfred-relie-a-l-app.sql) : Marc a dit oui
-- dans la page Agents, Alfred n'a pas encore envoyé.
alter table agent.actions drop constraint if exists actions_statut_check;
alter table agent.actions add constraint actions_statut_check
  check (statut = any (array['a_valider', 'valide', 'envoye', 'modifie_envoye', 'ecarte']));
create table if not exists agent.prospects (
  id uuid primary key default gen_random_uuid(),
  marque text not null, signal text, signal_date date, contact text, contact_role text,
  canal text, creatrice text, angle text, premier_message text,
  statut text not null default 'propose'
    check (statut in ('propose','valide','ecarte','contacte','relance_1','relance_2','relance_3','repondu','converti','abandonne')),
  prochaine_relance date, notes text,
  cree_le timestamptz default now(), maj_le timestamptz default now()
);
create index if not exists agent_prospects_statut_idx  on agent.prospects (statut);
create index if not exists agent_prospects_relance_idx on agent.prospects (prochaine_relance);
create table if not exists agent.cercle (
  id uuid primary key default gen_random_uuid(),
  contact text not null, entreprise text,
  type text check (type in ('marque_cliente','agence_partenaire','prospect_chaud')),
  frequence text, dernier_contact date, prochain_pretexte text,
  statut text not null default 'propose' check (statut in ('propose','valide')),
  cree_le timestamptz default now(), maj_le timestamptz default now()
);
create table if not exists agent.memoire_createurs (
  id uuid primary key default gen_random_uuid(),
  creatrice text not null,
  categorie text not null check (categorie in
    ('anniversaire','projet','voyage','examen','objectif','preference_tournage','disponibilite')),
  info text not null, date date, source text, cree_le timestamptz default now()
);
create index if not exists agent_memoire_creatrice_idx on agent.memoire_createurs (creatrice);
create table if not exists agent.lecons (
  id uuid primary key default gen_random_uuid(),
  module text, lecon text not null, cree_le timestamptz default now()
);
create table if not exists agent.journal (
  id uuid primary key default gen_random_uuid(),
  action text not null, detail text, cree_le timestamptz default now()
);
create index if not exists agent_journal_date_idx on agent.journal (cree_le);

create or replace function agent.touch_maj() returns trigger
  language plpgsql as $$ begin new.maj_le := now(); return new; end $$;
drop trigger if exists agent_prospects_touch on agent.prospects;
create trigger agent_prospects_touch before update on agent.prospects
  for each row execute function agent.touch_maj();
drop trigger if exists agent_cercle_touch on agent.cercle;
create trigger agent_cercle_touch before update on agent.cercle
  for each row execute function agent.touch_maj();

do $$
declare t text;
begin
  foreach t in array array['cockpits','actions','prospects','cercle','memoire_createurs','lecons','journal']
  loop
    execute format('alter table agent.%I enable row level security;', t);
    execute format('drop policy if exists %I_agence on agent.%I;', t, t);
    execute format(
      'create policy %I_agence on agent.%I for all to authenticated using (public.is_agency()) with check (public.is_agency());',
      t, t);
  end loop;
end $$;

grant select, insert, update, delete on all tables in schema agent to authenticated;
alter default privileges in schema agent
  grant select, insert, update, delete on tables to authenticated;
revoke all on all tables in schema agent from anon;

-- ----------------------------------------------------------------------------
-- AGENT · fiches des agents et liaison Alfred (2026-10-20, 2026-11-18, 2026-11-22).
-- agent.agents : un agent = une fiche (nom, emoji, rôle, consignes, routines, en pause ou
-- non), créée et réglée dans la page Agents ; moteur « claude » = joué par Claude via le
-- connecteur, « externe » = programme à part (sql/2026-10-20-agents.sql). Le pouls et les
-- réglages d'Alfred : vu_le, passage, passage_le, hors_ligne_alerte_le, reglages
-- (sql/2026-11-18-alfred-relie-a-l-app.sql). Les fiches de départ (Megan, Talent manager)
-- sont des données : elles ne sont pas reprises ici.
-- Placées AVANT le bloc ttp_agent ci-dessous, ces tables reçoivent aussi ses droits.
-- ----------------------------------------------------------------------------
create table if not exists agent.agents (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  nom        text not null,
  emoji      text not null default '🤖',
  role       text,
  moteur     text not null default 'claude' check (moteur in ('claude', 'externe')),
  consignes  text not null default '',
  routines   jsonb not null default '[]'::jsonb,
  actif      boolean not null default true,
  sort_order int not null default 0,
  cree_le    timestamptz not null default now(),
  maj_le     timestamptz not null default now(),
  vu_le      timestamptz,
  passage    text,
  passage_le timestamptz,
  hors_ligne_alerte_le timestamptz,
  reglages   jsonb not null default '{}'::jsonb
);
-- Base où la table existe déjà sans le pouls d'Alfred (sql/2026-11-18-alfred-relie-a-l-app.sql).
alter table agent.agents
  add column if not exists vu_le timestamptz,
  add column if not exists passage text,
  add column if not exists passage_le timestamptz,
  add column if not exists hors_ligne_alerte_le timestamptz,
  add column if not exists reglages jsonb not null default '{}'::jsonb;

-- Quel agent a proposé l'action, pour quel agent est la leçon, quel agent a écrit dans le
-- journal (sql/2026-10-20-agents.sql). Avant les colonnes de validation de agent.actions
-- (plus bas), pour garder l'ordre des colonnes de la production.
alter table agent.actions add column if not exists agent_id uuid references agent.agents(id) on delete set null;
alter table agent.lecons  add column if not exists agent_id uuid references agent.agents(id) on delete cascade;
alter table agent.journal add column if not exists agent_id uuid references agent.agents(id) on delete set null;

drop trigger if exists agents_touch on agent.agents;
create trigger agents_touch before update on agent.agents
  for each row execute function agent.touch_maj();

-- Fondateurs seulement, comme le reste du schéma agent.
alter table agent.agents enable row level security;
drop policy if exists agents_agence on agent.agents;
create policy agents_agence on agent.agents for all to authenticated
  using (public.is_founder()) with check (public.is_founder());
revoke all on agent.agents from anon;
grant select, insert, update, delete on agent.agents to authenticated;

-- Les nouvelles de l'app pour Alfred (tâche cochée, pièce déposée, facture payée, mail
-- validé dans la page Agents, action de Gianni), relevées chaque minute par la fonction
-- alfred-pont (sql/2026-11-18-alfred-relie-a-l-app.sql). Les déclencheurs qui écrivent ici
-- sont plus bas, dans le bloc « Alfred relié à l'app ». Lecture : fondateurs ; aucune
-- règle d'écriture, donc rien n'y est écrit depuis l'app.
create table if not exists agent.evenements (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  cible text,
  detail text,
  lien text,
  auteur text,
  cree_le timestamptz not null default now(),
  livre_le timestamptz
);
create index if not exists evenements_a_livrer on agent.evenements (cree_le) where livre_le is null;
alter table agent.evenements enable row level security;
drop policy if exists evenements_fondateurs on agent.evenements;
create policy evenements_fondateurs on agent.evenements for select using (public.is_founder());
revoke all on agent.evenements from anon;
grant select, insert, update, delete on agent.evenements to authenticated;

-- « Demander à Alfred » depuis l'app (sql/2026-11-18-alfred-relie-a-l-app.sql) : un
-- fondateur lit les demandes et en dépose une ; la réponse vient d'Alfred, par le serveur.
-- L'auteur est posé par la base (déclencheur alfred_demande_auteur, plus bas).
create table if not exists agent.demandes (
  id uuid primary key default gen_random_uuid(),
  texte text not null check (length(texte) between 1 and 2000),
  contexte text,
  lien text,
  auteur text,
  auteur_id uuid default auth.uid(),
  statut text not null default 'nouvelle' check (statut in ('nouvelle', 'recue', 'repondue')),
  reponse text,
  cree_le timestamptz not null default now(),
  recue_le timestamptz,
  repondu_le timestamptz
);
alter table agent.demandes enable row level security;
drop policy if exists demandes_lire on agent.demandes;
create policy demandes_lire on agent.demandes for select using (public.is_founder());
drop policy if exists demandes_ecrire on agent.demandes;
create policy demandes_ecrire on agent.demandes for insert
  with check (public.is_founder() and statut = 'nouvelle' and reponse is null);
revoke all on agent.demandes from anon;
grant select, insert, update, delete on agent.demandes to authenticated;

-- Skills privées d'Alfred, hors du dépôt public (sql/2026-11-18-skills-privees-alfred.sql) :
-- lisibles du seul serveur (RLS sans aucune règle, aucun droit pour anon ni pour les comptes
-- connectés). Leur contenu est inséré directement dans la base, jamais dans ce fichier.
-- Ce retrait doit rester APRÈS le « grant … on all tables in schema agent to
-- authenticated » plus haut, sinon les comptes connectés récupèrent tous les droits.
create table if not exists agent.skills_privees (
  nom text primary key check (nom ~ '^[a-z0-9-]{2,40}$'),
  fichiers jsonb not null,
  maj_le timestamptz not null default now()
);
alter table agent.skills_privees enable row level security;
revoke all on agent.skills_privees from anon, authenticated;
-- Le rôle ttp_agent (bloc suivant) et le serveur (service_role, juste après ce bloc) y
-- reçoivent SELECT, INSERT et UPDATE, comme en production.

-- ----------------------------------------------------------------------------
-- AGENT · rôle ttp_agent et ses droits (sql/2026-09-27-agent-role.sql).
-- Le rôle de l'ancienne agente Megan, qui se connectait directement à la base. Cette
-- connexion directe est fermée depuis le 27/11 (rôle NOLOGIN, sans script daté) : le rôle
-- ne sert plus à se connecter, mais il existe en production avec ses droits et ses règles.
-- Ce fichier le crée s'il manque, SANS connexion ni mot de passe, et remet NOLOGIN à chaque
-- passage. ⚠️ Ne pas suivre sql/2026-09-27-agent-role.sql sur une nouvelle base : il crée
-- le rôle en LOGIN avec un mot de passe (s'il a déjà tourné, « nologin » ci-dessous referme
-- la connexion). Limite de 5 connexions et délais (30 s par requête, 60 s de transaction
-- inactive) : sql/2026-09-27-agent-role.sql. postgres en est membre, comme en production
-- (SET ROLE ttp_agent pour les tests, sql/2026-09-27-agent-role-tests.sql).
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ttp_agent') then
    create role ttp_agent nologin nosuperuser nocreatedb nocreaterole noreplication connection limit 5;
  end if;
end $$;
alter role ttp_agent nologin connection limit 5;
alter role ttp_agent set statement_timeout = '30s';
alter role ttp_agent set idle_in_transaction_session_timeout = '60s';
grant ttp_agent to postgres;

-- Droits et règles du rôle, (re)posés à chaque passage. Le rôle existe toujours ici (bloc
-- juste au-dessus) : le test n'est qu'un garde-fou.
do $$
declare t text;
begin
  if not exists (select 1 from pg_roles where rolname = 'ttp_agent') then
    raise notice 'ttp_agent absent : il aurait dû être créé juste au-dessus';
    return;
  end if;
  execute 'grant usage on schema agent_lecture to ttp_agent';
  execute 'grant select on all tables in schema agent_lecture to ttp_agent';
  execute 'alter default privileges in schema agent_lecture grant select on tables to ttp_agent';
  execute 'grant usage on schema agent to ttp_agent';
  execute 'grant select, insert, update on all tables in schema agent to ttp_agent';
  execute 'alter default privileges in schema agent grant select, insert, update on tables to ttp_agent';
  execute 'revoke all on all tables in schema public from ttp_agent';
  execute 'revoke create on schema public from ttp_agent';
  foreach t in array array['cockpits','actions','prospects','cercle','memoire_createurs','lecons','journal']
  loop
    execute format('drop policy if exists %I_ttp_agent_sel on agent.%I;', t, t);
    execute format('drop policy if exists %I_ttp_agent_ins on agent.%I;', t, t);
    execute format('drop policy if exists %I_ttp_agent_upd on agent.%I;', t, t);
    execute format('create policy %I_ttp_agent_sel on agent.%I for select to ttp_agent using (true);', t, t);
    execute format('create policy %I_ttp_agent_ins on agent.%I for insert to ttp_agent with check (true);', t, t);
    execute format('create policy %I_ttp_agent_upd on agent.%I for update to ttp_agent using (true) with check (true);', t, t);
  end loop;
  -- Megan (rôle ttp_agent) lit les fiches agents, sans les modifier (sql/2026-10-20-agents.sql).
  execute 'drop policy if exists agents_ttp_agent_sel on agent.agents';
  execute 'create policy agents_ttp_agent_sel on agent.agents for select to ttp_agent using (true)';
end $$;

-- Le serveur (clé service_role : ttp-mcp, alfred-pont, agent-watchdog) lit et écrit dans
-- les 11 tables du schéma agent (sql/2026-10-20-agents.sql, puis
-- sql/2026-11-22-alfred-droits-serveur.sql pour evenements, demandes et skills_privees).
-- Sans ces droits : « permission denied for schema agent » (le bug du 22/11). À garder après
-- la création des 11 tables ; placé après le bloc ttp_agent pour retrouver l'ordre des droits
-- de la production (rien d'autre n'en dépend).
grant usage on schema agent to service_role;
grant select, insert, update on all tables in schema agent to service_role;

-- ============================================================================
-- FIN. Vérif rapide (en étant DÉCONNECTÉ, ces requêtes doivent renvoyer 0 ligne) :
--   select * from public.creators;
--   select * from public.contacts;
-- ============================================================================

-- ─── Audit sécurité 2026-10-01 (contenu de sql/2026-10-01-securite-audit.sql) ───
-- ════════════════════════════════════════════════════════════════════════════
-- Audit sécurité du 2026-10-01 : resserrage des droits (AUCUNE donnée modifiée).
-- Idempotent : peut être relancé sans risque. À lancer dans le SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) PROFILS (critique) : un compte « membre » pouvait se passer fondateur, ou
--    rattacher son compte à une créatrice, via l'API. Lecture = agence ;
--    écriture = fondateurs uniquement (l'app ne modifie jamais `profiles` ;
--    create-access passe par la clé serveur).
drop policy if exists profiles_agency on public.profiles;
drop policy if exists profiles_agency_read on public.profiles;
drop policy if exists profiles_founder_write on public.profiles;
create policy profiles_agency_read on public.profiles for select to authenticated
  using (public.is_agency());
create policy profiles_founder_write on public.profiles for all to authenticated
  using (public.is_founder()) with check (public.is_founder());

-- 2) SAUVEGARDES du blob (contient finance + anciens accès) : fondateurs seulement.
drop policy if exists app_state_backups_agency on public.app_state_backups;
create policy app_state_backups_agency on public.app_state_backups
  for select to authenticated using (public.is_founder());

-- 3) CONTACTS : une créatrice voyait (via l'API) tout le carnet partagé de l'agence.
--    Elle ne lit plus que les siens ; l'agence lit tout.
drop policy if exists contacts_read on public.contacts;
create policy contacts_read on public.contacts for select to authenticated
  using (public.is_agency() or creator = public.my_creator());

-- 4) COLLABS : la créatrice LIT ses collabs, seule l'agence écrit.
drop policy if exists collabs_scoped on public.collabs;
drop policy if exists collabs_read on public.collabs;
drop policy if exists collabs_agency_write on public.collabs;
create policy collabs_read on public.collabs for select to authenticated
  using (public.is_agency() or creator = public.my_creator());
create policy collabs_agency_write on public.collabs for all to authenticated
  using (public.is_agency()) with check (public.is_agency());

-- 5) BRIEFS : la créatrice lit les siens et ne peut modifier QUE le statut et son
--    script (consignes). Création / suppression = agence.
drop policy if exists briefs_scoped on public.briefs;
drop policy if exists briefs_read on public.briefs;
drop policy if exists briefs_agency_write on public.briefs;
drop policy if exists briefs_creator_update on public.briefs;
create policy briefs_read on public.briefs for select to authenticated
  using (public.is_agency() or creator = public.my_creator());
create policy briefs_agency_write on public.briefs for all to authenticated
  using (public.is_agency()) with check (public.is_agency());
create policy briefs_creator_update on public.briefs for update to authenticated
  using (creator = public.my_creator()) with check (creator = public.my_creator());
-- La garde briefs_creator_guard (le créateur ne change que le statut et son script, puis
-- aussi « J'ai lu » et son concept) et son déclencheur sont définis une seule fois, plus
-- bas, dans la section « Espace créateur : brief lu, concept… »
-- (sql/2026-11-23-espace-createur-collab.sql), après les colonnes qu'elle lit.

-- 6) MEDIA KIT PUBLIC : quand « Prix masqués » est coché, les tarifs ne doivent pas
--    être lisibles non plus via l'API publique.
create or replace view public.public_mediakit
with (security_invoker = false) as
  select name, handle, niche, platform, photo_url, sort_order,
         case when coalesce((mediakit->>'hideRates')::boolean, false)
              then mediakit - 'rates' - 'ratesNote' - 'ratesNoteEn'
              else mediakit end as mediakit
  from public.creators
  where coalesce(status, 'actif') <> 'inactif';
grant select on public.public_mediakit to anon, authenticated;
-- Vues publiques du site en LECTURE SEULE (2026-10-15) : elles tournent avec les droits du
-- propriétaire, donc sans ce retrait la clé publique pourrait modifier ou supprimer des
-- créateurs à travers elles (droits par défaut de Supabase sur les nouveaux objets).
revoke insert, update, delete, truncate
  on public.public_roster, public.public_mediakit, public.public_agency_mediakit
  from anon, authenticated, public;

-- 7) PIÈCES JOINTES DES TÂCHES : une créatrice ne pouvait ni ouvrir ni supprimer
--    ses propres pièces jointes (ni celles que l'agence joint à SES tâches).
--    La lecture (règle documents_obj_creator_own_read) est définie une seule fois, plus
--    bas, avec les règles des tâches internes privées (version du 2026-11-24,
--    sql/2026-11-24-taches-internes-privees.sql) : l'ancienne version d'ici laissait la
--    créatrice ouvrir les pièces jointes des tâches internes de l'agence.
drop policy if exists documents_obj_creator_own_delete on storage.objects;
create policy documents_obj_creator_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and name like 'creator-uploads/' || auth.uid()::text || '/%');

-- 8) AGENT (Megan) : page réservée aux fondateurs dans l'app → idem en base.
--    (Le rôle technique ttp_agent garde ses propres droits, inchangés.)
do $$
declare t text;
begin
  foreach t in array array['cockpits','actions','prospects','cercle','memoire_createurs','lecons','journal'] loop
    if to_regclass('agent.' || t) is not null then
      execute format('drop policy if exists %I_agence on agent.%I;', t, t);
      execute format('create policy %I_agence on agent.%I for all to authenticated using (public.is_founder()) with check (public.is_founder());', t, t);
    end if;
  end loop;
end $$;

-- 9) Hygiène : fonctions SECURITY DEFINER avec search_path fixé.
alter function public.is_agency() set search_path = public;
alter function public.my_creator() set search_path = public;
alter function public.handle_new_user() set search_path = public;
alter function public.creators_guard() set search_path = public;
alter function public.creator_roadmap_guard() set search_path = public;


-- ════════════════════════════════════════════════════════════════════════════
-- Section « Mails » de l'Espace Créateur (2026-10-02). AJOUT uniquement.
-- Idempotent : peut être relancé sans risque. À lancer dans le SQL Editor.
--
-- Principe : les mails restent dans Gmail (boîte talents@, lecture seule côté
-- serveur). La base ne stocke QUE : le réglage par créatrice (alias, libellé,
-- section activée), le statut de chaque fil (défini par l'agence) et les notes
-- « Écrire à mon manager ». Aucun contenu de mail n'est stocké.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Réglage par créatrice : alias Gmail + libellé manuel facultatif + activation.
create table if not exists public.creator_mail_settings (
  creator     text primary key,                 -- = creators.name (même clé que my_creator())
  alias       text,                             -- ex. lea@ttpcreators.pro
  label_id    text,                             -- id du libellé Gmail « Créatrices/Léa » (facultatif)
  label_name  text,
  enabled     boolean not null default false,   -- la créatrice voit l'onglet « Mails »
  updated_at  timestamptz not null default now()
);
alter table public.creator_mail_settings enable row level security;
-- Un alias = un seul créateur, jamais une boîte partagée (sql/2026-10-14-mails-fiabilite).
create unique index if not exists creator_mail_settings_alias_uidx
  on public.creator_mail_settings (lower(alias)) where alias is not null and alias <> '';
alter table public.creator_mail_settings drop constraint if exists creator_mail_settings_alias_partagee;
alter table public.creator_mail_settings add constraint creator_mail_settings_alias_partagee check (
  alias is null or alias = ''
  or not (lower(split_part(alias, '@', 1)) in ('partnerships', 'talent', 'contact', 'hello', 'booking', 'info', 'admin', 'noreply', 'no-reply')
          and lower(alias) like '%@ttpcreators.pro'));
-- Plusieurs adresses par créateur (sql/2026-10-21-adresses-createurs) : `aliases` = ses
-- adresses EN PLUS de l'alias principal (ex. son adresse perso), en minuscules. Le trigger
-- les normalise, refuse les boîtes communes et une adresse déjà utilisée par un autre créateur.
alter table public.creator_mail_settings add column if not exists aliases text[] not null default '{}';

-- Adresses en plus : minuscules, sans vide ni doublon, sans l'adresse principale (ordre
-- gardé). Un verrou fait passer une écriture à la fois sur ces adresses : deux
-- enregistrements simultanés ne peuvent pas donner la même adresse à deux créateurs.
create or replace function public.creator_mail_settings_addresses()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_main  text := nullif(lower(btrim(coalesce(new.alias, ''))), '');
  v_all   text[];
  v_addr  text;
  v_other text;
begin
  new.aliases := coalesce((
    select array_agg(d.a order by d.pos)
      from (select lower(btrim(x)) as a, min(u.pos) as pos
              from unnest(coalesce(new.aliases, '{}'::text[])) with ordinality as u(x, pos)
             where btrim(coalesce(x, '')) <> ''
             group by lower(btrim(x))) d
     where d.a is distinct from v_main
  ), '{}'::text[]);

  foreach v_addr in array new.aliases loop
    if v_addr !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'Adresse invalide : % (il faut une adresse e-mail complète)', v_addr;
    end if;
    if split_part(v_addr, '@', 1) in ('partnerships', 'talent', 'contact', 'hello', 'booking', 'info', 'admin', 'noreply', 'no-reply')
       and v_addr like '%@ttpcreators.pro' then
      raise exception 'C''est une boîte commune : % ne peut pas être l''adresse d''un créateur', v_addr;
    end if;
  end loop;

  v_all := new.aliases || case when v_main is null then '{}'::text[] else array[v_main] end;
  if cardinality(v_all) = 0 then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('creator_mail_settings_addresses'));

  select x.a, o.creator into v_addr, v_other
    from unnest(v_all) as x(a)
    join public.creator_mail_settings o
      on o.creator <> new.creator
     and (lower(btrim(coalesce(o.alias, ''))) = x.a
          or exists (select 1 from unnest(o.aliases) y where lower(btrim(y)) = x.a))
   limit 1;
  if v_other is not null then
    raise exception 'L''adresse % est déjà utilisée par un autre créateur (%)', v_addr, v_other;
  end if;
  return new;
end $$;

revoke all on function public.creator_mail_settings_addresses() from public, anon, authenticated;

drop trigger if exists creator_mail_settings_addresses on public.creator_mail_settings;
create trigger creator_mail_settings_addresses
  before insert or update of creator, alias, aliases on public.creator_mail_settings
  for each row execute function public.creator_mail_settings_addresses();
drop policy if exists creator_mail_settings_agency on public.creator_mail_settings;
create policy creator_mail_settings_agency on public.creator_mail_settings for all to authenticated
  using (public.is_agency()) with check (public.is_agency());
drop policy if exists creator_mail_settings_own on public.creator_mail_settings;
create policy creator_mail_settings_own on public.creator_mail_settings for select to authenticated
  using (creator = public.my_creator());

-- 2) Statut d'un fil pour une créatrice (défini par l'agence). Pas de ligne = « Nouvelle demande ».
create table if not exists public.creator_mail_threads (
  creator     text not null,
  thread_id   text not null,
  status      text not null default 'nouvelle'
              check (status in ('nouvelle', 'negociation', 'valide', 'refuse')),
  brand       text,                             -- nom de marque corrigé à la main (facultatif)
  updated_at  timestamptz not null default now(),
  primary key (creator, thread_id)
);
alter table public.creator_mail_threads enable row level security;
drop policy if exists creator_mail_threads_agency on public.creator_mail_threads;
create policy creator_mail_threads_agency on public.creator_mail_threads for all to authenticated
  using (public.is_agency()) with check (public.is_agency());
drop policy if exists creator_mail_threads_own on public.creator_mail_threads;
create policy creator_mail_threads_own on public.creator_mail_threads for select to authenticated
  using (creator = public.my_creator());

-- 2b) Décision « J'accepte / Je refuse » (2026-10-03) : seule la décision est stockée.
alter table public.creator_mail_threads add column if not exists decided_by text;
alter table public.creator_mail_threads add column if not exists decided_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'creator_mail_threads_decided_by_check') then
    alter table public.creator_mail_threads
      add constraint creator_mail_threads_decided_by_check check (decided_by is null or decided_by in ('creator', 'agency'));
  end if;
end $$;

-- 3) Notes « Écrire à mon manager » (jamais envoyées à la marque).
--    AUCUNE écriture directe pour une créatrice : l'insertion passe par la fonction
--    serveur creator-mail, qui vérifie d'abord que le fil lui appartient.
create table if not exists public.creator_mail_notes (
  id              uuid primary key default gen_random_uuid(),
  creator         text not null,
  thread_id       text not null,
  author_user_id  uuid,
  body            text not null check (char_length(body) between 1 and 4000),
  created_at      timestamptz not null default now(),
  agency_read_at  timestamptz
);
create index if not exists creator_mail_notes_thread_idx on public.creator_mail_notes (creator, thread_id, created_at);
alter table public.creator_mail_notes enable row level security;
drop policy if exists creator_mail_notes_agency_read on public.creator_mail_notes;
create policy creator_mail_notes_agency_read on public.creator_mail_notes for select to authenticated
  using (public.is_agency());
drop policy if exists creator_mail_notes_agency_update on public.creator_mail_notes;
create policy creator_mail_notes_agency_update on public.creator_mail_notes for update to authenticated
  using (public.is_agency()) with check (public.is_agency());
drop policy if exists creator_mail_notes_own on public.creator_mail_notes;
create policy creator_mail_notes_own on public.creator_mail_notes for select to authenticated
  using (creator = public.my_creator());

-- 4) Historique des statuts (2026-10-03) : « En cours » / « Validé » / « Refusé »,
--    qui, quand et son mot. Créatrice : ajout par la fonction creator-mail seulement
--    (fil vérifié). Agence : ajout direct en son propre nom. Ni modification ni suppression.
create table if not exists public.creator_mail_status_log (
  id              uuid primary key default gen_random_uuid(),
  creator         text not null,
  thread_id       text not null,
  status          text not null check (status in ('encours', 'valide', 'refuse')),
  by_role         text not null check (by_role in ('creator', 'agency')),
  author_user_id  uuid,
  comment         text check (comment is null or char_length(comment) between 1 and 1000),
  created_at      timestamptz not null default now()
);
create index if not exists creator_mail_status_log_thread_idx
  on public.creator_mail_status_log (creator, thread_id, created_at);
alter table public.creator_mail_status_log enable row level security;
drop policy if exists creator_mail_status_log_read on public.creator_mail_status_log;
create policy creator_mail_status_log_read on public.creator_mail_status_log for select to authenticated
  using (public.is_agency() or creator = public.my_creator());
drop policy if exists creator_mail_status_log_agency_insert on public.creator_mail_status_log;
create policy creator_mail_status_log_agency_insert on public.creator_mail_status_log for insert to authenticated
  with check (public.is_agency() and by_role = 'agency' and author_user_id = auth.uid());

-- 5) Remarques de l'agence + statuts « À vérifier » / « À valider » (2026-10-03).
alter table public.creator_mail_notes add column if not exists by_role text not null default 'creator';
alter table public.creator_mail_notes add column if not exists author_name text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'creator_mail_notes_by_role_check') then
    alter table public.creator_mail_notes
      add constraint creator_mail_notes_by_role_check check (by_role in ('creator', 'agency'));
  end if;
end $$;
-- Remarque de l'agence : écrite directement, en son propre nom uniquement.
drop policy if exists creator_mail_notes_agency_insert on public.creator_mail_notes;
create policy creator_mail_notes_agency_insert on public.creator_mail_notes for insert to authenticated
  with check (public.is_agency() and by_role = 'agency' and author_user_id = auth.uid());

alter table public.creator_mail_threads drop constraint if exists creator_mail_threads_status_check;
alter table public.creator_mail_threads add constraint creator_mail_threads_status_check
  check (status in ('nouvelle', 'negociation', 'a_verifier', 'a_valider', 'valide', 'refuse'));
alter table public.creator_mail_status_log drop constraint if exists creator_mail_status_log_status_check;
alter table public.creator_mail_status_log add constraint creator_mail_status_log_status_check
  check (status in ('encours', 'a_verifier', 'a_valider', 'valide', 'refuse'));


-- ════════════════════════════════════════════════════════════════════════════
-- Équipe agence (2026-10-03) : traçabilité du « Fait », to-do « Chaque semaine »,
-- prénom affiché, journal « qui fait quoi » (déclencheur). Les PROPRIÉTAIRES
-- (données) sont posés par sql/2026-10-03-equipe-activite-routines.sql (partie 5).
-- ════════════════════════════════════════════════════════════════════════════
-- 1) To-do : traçabilité du « Fait ».
alter table public.todos add column if not exists done_at timestamptz;
alter table public.todos add column if not exists done_by text;

-- 2) To-do « Chaque semaine » (agence uniquement).
create table if not exists public.todo_routines (
  id          uuid primary key default gen_random_uuid(),
  text        text not null check (char_length(text) between 1 and 300),
  weekday     smallint check (weekday between 1 and 7),          -- 1 = lundi … 7 = dimanche ; vide = n'importe quel jour
  priority    text not null default 'moyenne' check (priority in ('haute', 'moyenne', 'basse')),
  done_log    jsonb not null default '[]'::jsonb,                 -- [{ "at": date ISO, "by": "Marc" }], le plus récent en dernier
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.todo_routines enable row level security;
drop policy if exists todo_routines_agency on public.todo_routines;
create policy todo_routines_agency on public.todo_routines for all to authenticated
  using (public.is_agency()) with check (public.is_agency());

-- 3) Prénom affiché (« Marc », « Gianni »…) et liste réelle des comptes agence.
alter table public.profiles add column if not exists display_name text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_display_name_len') then
    alter table public.profiles add constraint profiles_display_name_len
      check (display_name is null or char_length(display_name) between 1 and 40);
  end if;
end $$;

-- Chacun ne peut changer QUE son propre prénom (rien d'autre dans son profil).
create or replace function public.set_my_display_name(name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_agency() then
    raise exception 'non_autorise';
  end if;
  update public.profiles set display_name = nullif(left(trim(name), 40), '') where user_id = auth.uid();
end $$;
revoke all on function public.set_my_display_name(text) from public, anon;
grant execute on function public.set_my_display_name(text) to authenticated;

-- Comptes agence réels (adresse, niveau, prénom, dernière connexion) : fondateurs seulement.
create or replace function public.agency_accounts()
returns table (user_id uuid, email text, agency_role text, display_name text, last_sign_in_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.user_id, u.email::text, coalesce(p.agency_role, 'member'), p.display_name, u.last_sign_in_at
    from public.profiles p join auth.users u on u.id = p.user_id
   where p.role = 'agency' and public.is_founder()
   order by (coalesce(p.agency_role, 'member') = 'founder') desc, u.email;
$$;
revoke all on function public.agency_accounts() from public, anon;
grant execute on function public.agency_accounts() to authenticated;

-- 4) Journal de l'équipe. Lecture : agence (les lignes « factures » : fondateurs
--    seulement, comme la Finance). Aucune écriture directe : seul le déclencheur
--    ci-dessous ajoute des lignes, au nom du compte connecté.
create table if not exists public.agency_activity (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid,
  actor_name  text,
  verb        text not null,     -- add | done | reopen | delete | status | step
  entity      text not null,     -- table concernée (todos, contacts, collabs…)
  label       text not null,     -- ce qui a été touché (« Relancer Nike »…)
  detail      text,              -- nouveau statut / nouvelle étape
  creator     text,              -- créatrice concernée, s'il y en a une
  pushed_at   timestamptz,       -- notification envoyée à l'équipe
  created_at  timestamptz not null default now()
);
create index if not exists agency_activity_created_idx on public.agency_activity (created_at desc);
create index if not exists agency_activity_actor_idx on public.agency_activity (actor_id, created_at desc);
alter table public.agency_activity enable row level security;
drop policy if exists agency_activity_read on public.agency_activity;
create policy agency_activity_read on public.agency_activity for select to authenticated
  using (public.is_agency() and (entity <> 'invoices' or public.is_founder()));

-- Seules les actions d'un compte agence connecté sont notées (pas les crons, ni la synchro
-- Google, ni les créatrices). La trace ne doit JAMAIS empêcher l'action elle-même
-- (exception when others).
create or replace function public.log_agency_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  n jsonb;
  o jsonb;
  r jsonb;
  v text;
  d text;
  who text;
  lbl text;
begin
  if uid is null or not public.is_agency() then
    return null;
  end if;
  n := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  o := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  r := coalesce(n, o);
  if tg_op = 'INSERT' then
    v := 'add';
  elsif tg_op = 'DELETE' then
    v := 'delete';
  elsif tg_table_name = 'todos' then
    if coalesce(n->>'status', '') = 'Fait' and coalesce(o->>'status', '') <> 'Fait' then v := 'done';
    elsif coalesce(o->>'status', '') = 'Fait' and coalesce(n->>'status', '') <> 'Fait' then v := 'reopen';
    end if;
  elsif tg_table_name = 'todo_routines' then
    if jsonb_array_length(coalesce(n->'done_log', '[]'::jsonb)) > jsonb_array_length(coalesce(o->'done_log', '[]'::jsonb)) then
      v := 'done';
    end if;
  elsif tg_table_name = 'collabs' then
    if (n->>'status') is distinct from (o->>'status') then v := 'status'; d := n->>'status';
    elsif coalesce((n->>'step')::int, 0) > coalesce((o->>'step')::int, 0) then v := 'step'; d := n->>'step';
    end if;
  elsif tg_table_name = 'events' then
    if coalesce((n->>'deleted')::boolean, false) and not coalesce((o->>'deleted')::boolean, false) then v := 'delete'; end if;
  elsif n ? 'status' and (n->>'status') is distinct from (o->>'status') then
    v := 'status'; d := n->>'status';
  end if;
  if v is null then
    return null;
  end if;
  select coalesce(nullif(trim(p.display_name), ''), split_part(u.email::text, '@', 1))
    into who
    from auth.users u left join public.profiles p on p.user_id = u.id
   where u.id = uid;
  lbl := case tg_table_name
    when 'invoices' then concat_ws(' · ', nullif(r->>'ref', ''), nullif(r->>'party', ''))
    else coalesce(nullif(r->>'text', ''), nullif(r->>'brand', ''), nullif(r->>'name', ''),
                  nullif(r->>'title', ''), nullif(r->>'person', ''), nullif(r->>'email', ''))
  end;
  insert into public.agency_activity (actor_id, actor_name, verb, entity, label, detail, creator)
  values (uid, left(coalesce(who, 'Quelqu''un'), 40), v, tg_table_name,
          left(coalesce(nullif(lbl, ''), '(sans titre)'), 200), d, r->>'creator');
  return null;
exception when others then
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['todos', 'todo_routines', 'ideas', 'events', 'contacts', 'creators', 'collabs',
                           'briefs', 'invoices', 'documents', 'gifting', 'creator_pool', 'prospects'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists agency_activity_log on public.%I', t);
      execute format('create trigger agency_activity_log after insert or update or delete on public.%I
                      for each row execute function public.log_agency_activity()', t);
    end if;
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Équipe agence (2026-10-03) : un FONDATEUR peut changer le nom affiché de
-- n'importe quel compte agence (Accès → Comptes de l'agence → Modifier).
-- Idempotent : peut être relancé sans risque. À lancer dans le SQL Editor.
-- (Chacun garde aussi set_my_display_name() pour son propre prénom.)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.set_agency_display_name(target uuid, name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_founder() then
    raise exception 'non_autorise';
  end if;
  update public.profiles set display_name = nullif(left(trim(name), 40), '')
   where user_id = target and role = 'agency';
  if not found then
    raise exception 'compte_introuvable';
  end if;
end $$;
revoke all on function public.set_agency_display_name(uuid, text) from public, anon;
grant execute on function public.set_agency_display_name(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- Pastilles « pas encore vu » (2026-10-06) : dernière visite de chaque page du
-- menu, par compte (sql/2026-10-06-nav-seen.sql). RLS : ses propres lignes seulement.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.nav_seen (
  user_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  page     text not null check (char_length(page) between 1 and 40),
  seen_at  timestamptz not null default now(),
  primary key (user_id, page)
);
alter table public.nav_seen enable row level security;
drop policy if exists nav_seen_own on public.nav_seen;
create policy nav_seen_own on public.nav_seen for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.nav_seen from anon;
grant select, insert, update on public.nav_seen to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- To-do · plusieurs créateurs (2026-10-21, sql/2026-10-21-taches-plusieurs-createurs.sql).
-- todos.creators (text[]) = tous les créateurs ; todos.creator = le premier.
-- Remplace la policy todos_scoped (section 5) par lecture / création / modification /
-- suppression séparées : un créateur lit et modifie les tâches partagées avec lui,
-- ne crée que pour lui-même, ne supprime que celles dont il est le premier créateur,
-- et ne peut pas changer la liste (trigger todos_a_creators_guard).
-- ════════════════════════════════════════════════════════════════════════════
alter table public.todos add column if not exists creators text[] not null default '{}';
create index if not exists todos_creators_gin on public.todos using gin (creators);

-- Mise en ordre de la liste des créateurs, corps identique à la production (commentaires
-- sortis du corps) :
--   * ancien client : seul `creator` a changé → la liste devient ce seul nom ;
--   * noms rognés, vides retirés, doublons (casse ignorée) retirés, ordre gardé ;
--   * creator = le premier de la liste, null si la liste est vide (tâche agence).
create or replace function public.todos_creators_sync() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
declare
  clean text[];
begin
  if tg_op = 'UPDATE'
     and new.creator is distinct from old.creator
     and new.creators is not distinct from old.creators then
    new.creators := case when nullif(btrim(new.creator), '') is null then '{}'::text[]
                         else array[btrim(new.creator)] end;
  end if;
  select coalesce(array_agg(x.n order by x.pos), '{}'::text[]) into clean
    from (
      select distinct on (lower(btrim(u.n))) btrim(u.n) as n, u.pos
        from unnest(coalesce(new.creators, '{}'::text[])) with ordinality as u(n, pos)
       where nullif(btrim(u.n), '') is not null
       order by lower(btrim(u.n)), u.pos
    ) x;
  if cardinality(clean) = 0 and nullif(btrim(new.creator), '') is not null then
    clean := array[btrim(new.creator)];
  end if;
  new.creators := clean;
  new.creator := clean[1];
  return new;
end $$;

-- Triggers BEFORE par ordre alphabétique : la garde (a_) avant la mise en ordre (b_).
-- Garde, version en production (sql/2026-11-27-securite-14.sql, commentaires sortis du
-- corps) : un compte créateur ne crée que pour lui-même, ne change ni la liste ni l'origine
-- (source) d'une tâche, et le « Fait par » est le nom du compte connecté, jamais un texte
-- choisi par l'appelant.
create or replace function public.todos_creators_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.is_agency() then
    if tg_op = 'INSERT' then
      new.creators := case when nullif(btrim(new.creator), '') is null then '{}'::text[]
                           else array[btrim(new.creator)] end;
      if new.source is not distinct from 'agency' then new.source := 'creator'; end if;
    else
      new.creator  := old.creator;
      new.creators := old.creators;
      new.source   := old.source;
    end if;
    if new.done_by is not null
       and (tg_op = 'INSERT' or new.done_by is distinct from old.done_by) then
      new.done_by := coalesce(
        (select coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.creator_name), ''))
           from public.profiles p where p.user_id = auth.uid()),
        'Créateur');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists todos_creators_sync on public.todos;
drop trigger if exists todos_b_creators_sync on public.todos;
create trigger todos_b_creators_sync before insert or update on public.todos
  for each row execute function public.todos_creators_sync();
drop trigger if exists todos_creators_guard on public.todos;
drop trigger if exists todos_a_creators_guard on public.todos;
create trigger todos_a_creators_guard before insert or update on public.todos
  for each row execute function public.todos_creators_guard();

-- Tâches internes privées (2026-11-24, sql/2026-11-24-taches-internes-privees.sql) : une
-- tâche de l'agence (source = 'agency', y compris celles d'Alfred et du connecteur) n'est
-- lue, modifiée ou supprimée par le créateur que si elle est cochée « Visible par le
-- créateur » (todos.visible_createur, colonne créée en section 1). Ses propres tâches
-- (source = 'creator') ne changent pas. La création reste limitée à ses propres tâches,
-- et la garde todos_a_creators_guard remet source à 'creator' quand un créateur crée.
drop policy if exists todos_scoped on public.todos;
drop policy if exists todos_read   on public.todos;
drop policy if exists todos_insert on public.todos;
drop policy if exists todos_update on public.todos;
drop policy if exists todos_delete on public.todos;
create policy todos_read on public.todos for select to authenticated
  using (public.is_agency() or (
    (creator = public.my_creator() or public.my_creator() = any(creators))
    and (source is distinct from 'agency' or visible_createur)));
create policy todos_insert on public.todos for insert to authenticated
  with check (public.is_agency() or creator = public.my_creator());
create policy todos_update on public.todos for update to authenticated
  using (public.is_agency() or (
    (creator = public.my_creator() or public.my_creator() = any(creators))
    and (source is distinct from 'agency' or visible_createur)))
  with check (public.is_agency() or (
    (creator = public.my_creator() or public.my_creator() = any(creators))
    and (source is distinct from 'agency' or visible_createur)));
create policy todos_delete on public.todos for delete to authenticated
  using (public.is_agency() or (
    creator = public.my_creator()
    and (source is distinct from 'agency' or visible_createur)));

-- Pièces jointes des tâches (seule définition de cette règle, version en production) : le
-- créateur ouvre (lien signé) ses propres dépôts et les pièces jointes des tâches qu'il lit,
-- y compris les tâches partagées (creators), mais pas celles d'une tâche INTERNE de
-- l'agence non cochée « Visible par le créateur » (2026-11-24,
-- sql/2026-11-24-taches-internes-privees.sql, partie 3), même condition que todos_read
-- ci-dessus. Seulement un fichier rangé sous CETTE tâche (pas un chemin recopié, 2026-10-15).
-- La colonne todos.visible_createur est créée en section 1.
drop policy if exists documents_obj_creator_own_read on storage.objects;
create policy documents_obj_creator_own_read on storage.objects for select to authenticated
  using (
    bucket_id = 'documents' and (
      name like 'creator-uploads/' || auth.uid()::text || '/%'
      or exists (
        select 1 from public.todos t, jsonb_array_elements(coalesce(t.attachments, '[]'::jsonb)) a
         where a->>'path' = storage.objects.name
           and (t.creator = public.my_creator() or public.my_creator() = any(t.creators))
           and (t.source is distinct from 'agency' or t.visible_createur)
           and storage.objects.name like 'todo-attachments/' || t.id::text || '/%'
      )
    )
  );

update public.todos
   set creators = array[btrim(creator)]
 where cardinality(creators) = 0
   and nullif(btrim(creator), '') is not null;

-- Points d'avancement d'une tâche, visibles du créateur (2026-10-22,
-- sql/2026-10-22-taches-points-avancement.sql : reprise des anciens points du blob
-- `itemNotes`). Un point par ligne : « 22/10/2026 · Agence : texte ».
alter table public.todos add column if not exists progress text;

-- ════════════════════════════════════════════════════════════════════════════
-- Sauvegarde mensuelle (2026-10-21, sql/2026-10-21-sauvegarde-mensuelle.sql) : bucket
-- privé « backups » (aucune politique, serveur seulement). Le cron est dans le fichier daté.
-- ════════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do update set public = false;

-- ════════════════════════════════════════════════════════════════════════════
-- Nouveautés agence ↔ créateur (2026-10-23, sql/2026-10-23-notifications-nouveautes.sql)
create table if not exists public.activity_events (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  target       text not null check (target in ('creator', 'agency')),
  creator      text not null,                 -- créateur concerné (destinataire si target = creator)
  object_type  text not null check (object_type in ('todo', 'idea', 'brief', 'mail')),
  object_id    text not null,
  object_title text,
  what         text not null,                 -- new | text | description | subtask | progress | update | note | status
  actor        text,                          -- nom affiché de l'auteur
  excerpt      text,
  count        int  not null default 1,
  read_at      timestamptz
);
create index if not exists activity_events_unread_idx on public.activity_events (target, creator, read_at, updated_at desc);
create index if not exists activity_events_object_idx on public.activity_events (object_type, object_id);

alter table public.activity_events enable row level security;
-- Lecture : le créateur ne lit le repère d'une tâche que s'il lit la tâche elle-même ; la
-- sous-requête passe par la règle todos_read, donc les repères des tâches internes et des
-- tâches supprimées ne s'affichent plus chez lui (2026-11-24,
-- sql/2026-11-24-reperes-taches-internes.sql).
drop policy if exists activity_events_read on public.activity_events;
create policy activity_events_read on public.activity_events for select to authenticated
  using (
    (target = 'agency' and public.is_agency())
    or (target = 'creator' and creator = public.my_creator()
        and (object_type <> 'todo' or exists (select 1 from public.todos t where t.id::text = activity_events.object_id)))
  );
drop policy if exists activity_events_mark_read on public.activity_events;
create policy activity_events_mark_read on public.activity_events for update to authenticated
  using ((target = 'creator' and creator = public.my_creator()) or (target = 'agency' and public.is_agency()))
  with check ((target = 'creator' and creator = public.my_creator()) or (target = 'agency' and public.is_agency()));
revoke all on public.activity_events from anon, authenticated;
grant select on public.activity_events to authenticated;
grant update (read_at) on public.activity_events to authenticated;

-- Écrit (ou regroupe) un repère. Appelée seulement par les déclencheurs ci-dessous.
create or replace function public.log_activity_event(
  p_target text, p_creator text, p_type text, p_id text, p_title text, p_what text, p_actor text, p_excerpt text
) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  hit uuid;
begin
  if coalesce(btrim(p_creator), '') = '' or coalesce(p_id, '') = '' then return; end if;
  select id into hit from public.activity_events
   where target = p_target and creator = p_creator and object_type = p_type and object_id = p_id
     and what = p_what and read_at is null and updated_at > now() - interval '10 minutes'
   order by updated_at desc limit 1;
  if hit is not null then
    update public.activity_events
       set updated_at = now(), count = count + 1,
           excerpt = left(coalesce(p_excerpt, excerpt), 200),
           object_title = left(coalesce(p_title, object_title), 120),
           actor = coalesce(p_actor, actor)
     where id = hit;
  else
    insert into public.activity_events (target, creator, object_type, object_id, object_title, what, actor, excerpt)
    values (p_target, btrim(p_creator), p_type, p_id, left(p_title, 120), p_what, left(p_actor, 60), left(p_excerpt, 200));
  end if;
end $$;
revoke all on function public.log_activity_event(text, text, text, text, text, text, text, text) from public, anon, authenticated;

-- Qui écrit : 'agency' (compte agence), 'creator' (compte créateur), null (pas de compte : on ne note rien).
create or replace function public.activity_actor() returns text
  language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then null
    when public.is_agency() then 'agency'
    when public.my_creator() is not null then 'creator'
    else null end;
$$;
revoke all on function public.activity_actor() from public, anon;

create or replace function public.activity_actor_name() returns text
  language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(p.display_name), ''), case when p.role = 'agency' then 'Agence' else p.creator_name end)
    from public.profiles p where p.user_id = auth.uid();
$$;
revoke all on function public.activity_actor_name() from public, anon;

-- Dernière ligne non vide d'un texte (le dernier point d'avancement ajouté).
create or replace function public.activity_last_line(t text) returns text
  language sql immutable as $$
  select btrim(x) from unnest(string_to_array(coalesce(t, ''), E'\n')) with ordinality as l(x, n)
   where btrim(x) <> '' order by n desc limit 1;
$$;

-- Sous-tâches ajoutées entre deux listes jsonb [{id, text, done}] : texte de la première.
create or replace function public.activity_new_subtask(o jsonb, n jsonb) returns text
  language sql immutable as $$
  select e->>'text' from jsonb_array_elements(case when jsonb_typeof(n) = 'array' then n else '[]'::jsonb end) e
   where not exists (
     select 1 from jsonb_array_elements(case when jsonb_typeof(o) = 'array' then o else '[]'::jsonb end) f
      where f->>'id' = e->>'id')
   limit 1;
$$;

-- ── Tâches ───────────────────────────────────────────────────────────────────
-- Version du 24/11 (sql/2026-11-24-reperes-taches-internes.sql), corps identique à la
-- production (commentaires sortis du corps) :
--   * créateurs de la tâche : la liste `creators`, sinon `creator` ;
--   * tâche interne de l'agence (source 'agency', « Visible par le créateur » non cochée) :
--     aucun repère pour le créateur quand l'agence l'écrit (ni texte, ni titre) ;
--   * l'agence coche « Visible par le créateur » (devient_visible) : repère « nouveau » ;
--   * un créateur n'écrit que sur une tâche partagée avec lui (la RLS l'assure déjà) ;
--   * jamais bloquant : une erreur ici n'empêche pas l'écriture de la tâche.
-- Va avec la règle activity_events_read du même script (le créateur ne lit le repère
-- d'une tâche que s'il lit la tâche) et la colonne todos.visible_createur (section 1).
create or replace function public.todos_activity() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor text; who text; j jsonb; o jsonb; names text[]; nm text; sub text; title text;
  changes text[][] := '{}';
  i int;
  interne boolean; devient_visible boolean;
begin
  begin
    actor := public.activity_actor();
    if actor is null then return new; end if;
    who := public.activity_actor_name();
    j := to_jsonb(new);
    o := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
    interne := (j->>'source') is not distinct from 'agency' and not coalesce((j->>'visible_createur')::boolean, false);
    if actor = 'agency' and interne then return new; end if;
    devient_visible := tg_op = 'UPDATE'
      and coalesce((j->>'visible_createur')::boolean, false)
      and not coalesce((o->>'visible_createur')::boolean, false);
    title := left(coalesce(j->>'text', ''), 120);
    select coalesce(array_agg(btrim(x)) filter (where btrim(x) <> ''), '{}') into names
      from jsonb_array_elements_text(case when jsonb_typeof(j->'creators') = 'array' and jsonb_array_length(j->'creators') > 0
                                          then j->'creators' else jsonb_build_array(coalesce(j->>'creator', '')) end) x;
    if coalesce(array_length(names, 1), 0) = 0 then return new; end if;

    if tg_op = 'INSERT' or devient_visible then
      changes := array[array['new', title]];
    else
      if (j->>'text') is distinct from (o->>'text') and coalesce(j->>'text', '') <> '' then
        changes := changes || array[array['text', j->>'text']];
      end if;
      if (j->>'descr') is distinct from (o->>'descr') and coalesce(btrim(j->>'descr'), '') <> '' then
        changes := changes || array[array['description', j->>'descr']];
      end if;
      sub := public.activity_new_subtask(o->'subtasks', j->'subtasks');
      if sub is not null then changes := changes || array[array['subtask', sub]]; end if;
      if (j->>'progress') is distinct from (o->>'progress') and length(coalesce(j->>'progress', '')) > length(coalesce(o->>'progress', '')) then
        changes := changes || array[array['progress', public.activity_last_line(j->>'progress')]];
      end if;
    end if;
    if coalesce(array_length(changes, 1), 0) = 0 then return new; end if;

    for i in 1 .. array_length(changes, 1) loop
      if actor = 'agency' then
        foreach nm in array names loop
          perform public.log_activity_event('creator', nm, 'todo', new.id::text, title, changes[i][1], who, changes[i][2]);
        end loop;
      else
        perform public.log_activity_event('agency', public.my_creator(), 'todo', new.id::text, title, changes[i][1], who, changes[i][2]);
      end if;
    end loop;
  exception when others then
    null;
  end;
  return new;
end $$;
drop trigger if exists todos_activity on public.todos;
create trigger todos_activity after insert or update on public.todos
  for each row execute function public.todos_activity();

-- ── Idées ────────────────────────────────────────────────────────────────────
-- Une idée générale de l'agence (sans créateur) ne prévient personne.
create or replace function public.ideas_activity() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor text; who text; j jsonb; o jsonb; nm text; sub text; title text;
begin
  begin
    actor := public.activity_actor();
    if actor is null then return new; end if;
    who := public.activity_actor_name();
    j := to_jsonb(new);
    o := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
    nm := btrim(coalesce(j->>'creator', ''));
    if nm = '' then return new; end if;
    if actor = 'creator' then nm := public.my_creator(); end if;
    title := left(coalesce(j->>'text', ''), 120);
    if tg_op = 'INSERT' then
      perform public.log_activity_event(case when actor = 'agency' then 'creator' else 'agency' end, nm, 'idea', new.id::text, title, 'new', who, title);
    else
      if (j->>'text') is distinct from (o->>'text') and title <> '' then
        perform public.log_activity_event(case when actor = 'agency' then 'creator' else 'agency' end, nm, 'idea', new.id::text, title, 'text', who, title);
      end if;
      sub := public.activity_new_subtask(o->'subtasks', j->'subtasks');
      if sub is not null then
        perform public.log_activity_event(case when actor = 'agency' then 'creator' else 'agency' end, nm, 'idea', new.id::text, title, 'subtask', who, sub);
      end if;
    end if;
  exception when others then
    null;
  end;
  return new;
end $$;
drop trigger if exists ideas_activity on public.ideas;
create trigger ideas_activity after insert or update on public.ideas
  for each row execute function public.ideas_activity();

-- ── Briefs ───────────────────────────────────────────────────────────────────
-- Côté agence, seul ce que le créateur lit compte : consignes, livrables, échéance,
-- résumé, PDF.
create or replace function public.briefs_activity() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor text; who text; j jsonb; o jsonb; nm text; title text; changed boolean;
begin
  begin
    actor := public.activity_actor();
    if actor is null then return new; end if;
    who := public.activity_actor_name();
    j := to_jsonb(new);
    o := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
    nm := btrim(coalesce(j->>'creator', ''));
    if nm = '' then return new; end if;
    if actor = 'creator' then nm := public.my_creator(); end if;
    title := left(coalesce(nullif(j->>'brand', ''), 'Brief'), 120);
    if tg_op = 'INSERT' then
      if actor = 'agency' then
        perform public.log_activity_event('creator', nm, 'brief', new.id::text, title, 'new', who, j->>'deliverables');
      end if;
      return new;
    end if;
    if actor = 'agency' then
      changed := (j->'consignes') is distinct from (o->'consignes') or (j->'deliverables') is distinct from (o->'deliverables')
              or (j->'due') is distinct from (o->'due') or (j->'resume') is distinct from (o->'resume') or (j->'pdf') is distinct from (o->'pdf');
      if changed then
        perform public.log_activity_event('creator', nm, 'brief', new.id::text, title, 'update', who, j->>'deliverables');
      end if;
    elsif (j - 'updated_at') is distinct from (o - 'updated_at') then
      perform public.log_activity_event('agency', nm, 'brief', new.id::text, title, 'update', who, j->>'status');
    end if;
  exception when others then
    null;
  end;
  return new;
end $$;
drop trigger if exists briefs_activity on public.briefs;
create trigger briefs_activity after insert or update on public.briefs
  for each row execute function public.briefs_activity();

-- ── Mails : remarques (agence ↔ créateur) et statut d'un échange (agence → créateur) ──
create or replace function public.mail_notes_activity() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor text; title text;
begin
  begin
    actor := public.activity_actor();
    if actor is null then return new; end if;
    select coalesce(nullif(btrim(t.brand), ''), 'Un échange') into title
      from public.creator_mail_threads t where t.creator = new.creator and t.thread_id = new.thread_id;
    perform public.log_activity_event(case when actor = 'agency' then 'creator' else 'agency' end, new.creator, 'mail',
      new.thread_id, coalesce(title, 'Un échange'), 'note', public.activity_actor_name(), new.body);
  exception when others then
    null;
  end;
  return new;
end $$;
drop trigger if exists creator_mail_notes_activity on public.creator_mail_notes;
create trigger creator_mail_notes_activity after insert on public.creator_mail_notes
  for each row execute function public.mail_notes_activity();

-- Statut d'un mail posé par l'agence (création de la ligne par upsert, ou changement) :
-- repère pour le créateur. Corps identique à la production (commentaire sorti du corps).
create or replace function public.mail_threads_activity() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if public.activity_actor() = 'agency'
       and ((tg_op = 'INSERT' and new.status <> 'nouvelle') or (tg_op = 'UPDATE' and new.status is distinct from old.status)) then
      perform public.log_activity_event('creator', new.creator, 'mail', new.thread_id,
        coalesce(nullif(btrim(new.brand), ''), 'Un échange'), 'status', public.activity_actor_name(), new.status);
    end if;
  exception when others then
    null;
  end;
  return new;
end $$;
drop trigger if exists creator_mail_threads_activity on public.creator_mail_threads;
create trigger creator_mail_threads_activity after insert or update on public.creator_mail_threads
  for each row execute function public.mail_threads_activity();

-- Ménage : les repères lus de plus de 60 jours ne servent plus.
delete from public.activity_events where read_at is not null and read_at < now() - interval '60 days';

-- ─── Base de créateurs façon Kolsquare (sql/2026-11-16-base-createurs.sql) ─────────

-- 1) Niche, ville, note et retrait ------------------------------------------------
create table if not exists public.creator_base_meta (
  username   text primary key check (username ~ '^[a-z0-9._]{1,30}$'),
  niche      text,
  ville      text,
  note       text,
  excluded   boolean not null default false,  -- retiré à sa demande : caché partout
  updated_at timestamptz not null default now()
);
alter table public.creator_base_meta enable row level security;
revoke all on public.creator_base_meta from anon;
drop policy if exists creator_base_meta_agency on public.creator_base_meta;
create policy creator_base_meta_agency on public.creator_base_meta for all to authenticated
  using (public.is_agency()) with check (public.is_agency());

-- 2) Historique des chiffres -------------------------------------------------------
create table if not exists public.ig_profile_history (
  username  text not null,
  d         date not null default current_date,
  followers int,
  er        numeric,
  primary key (username, d)
);
alter table public.ig_profile_history enable row level security;
revoke all on public.ig_profile_history from anon;
drop policy if exists ig_profile_history_agency_read on public.ig_profile_history;
create policy ig_profile_history_agency_read on public.ig_profile_history for select to authenticated
  using (public.is_agency());
drop policy if exists ig_profile_history_agency_delete on public.ig_profile_history;
create policy ig_profile_history_agency_delete on public.ig_profile_history for delete to authenticated
  using (public.is_agency());

-- L'historique ne doit jamais bloquer la lecture d'un profil (exception when others).
create or replace function public.ig_profiles_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.data is not null and new.data ? 'followers'
     and coalesce((new.data->>'isBrand')::boolean, false) = false
     and not exists (select 1 from public.creator_base_meta m where m.username = new.username and m.excluded) then
    insert into public.ig_profile_history (username, d, followers, er)
    values (new.username, current_date,
            nullif(new.data->>'followers', '')::numeric::int,
            nullif(new.data->>'er', '')::numeric)
    on conflict (username, d) do update set followers = excluded.followers, er = excluded.er;
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists ig_profiles_history on public.ig_profiles;
create trigger ig_profiles_history after insert or update of data on public.ig_profiles
  for each row execute function public.ig_profiles_history();

-- Premier point : aujourd'hui, pour tous les profils déjà lus.
insert into public.ig_profile_history (username, d, followers, er)
select username, current_date, nullif(data->>'followers', '')::numeric::int, nullif(data->>'er', '')::numeric
from public.ig_profiles
where data ? 'followers' and coalesce((data->>'isBrand')::boolean, false) = false
on conflict (username, d) do nothing;

-- 3) Listes pour les marques -------------------------------------------------------
create table if not exists public.creator_lists (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  title      text not null,
  brand      text,
  intro      text,
  usernames  text[] not null default '{}',
  public     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Dispos du mois pour les agences (2026-11-22) : la sélection calculée, lue par la page publique.
alter table public.creator_lists add column if not exists dispos jsonb;
alter table public.creator_lists enable row level security;
revoke all on public.creator_lists from anon;
drop policy if exists creator_lists_agency on public.creator_lists;
create policy creator_lists_agency on public.creator_lists for all to authenticated
  using (public.is_agency()) with check (public.is_agency());

-- 4) Vue publique des listes (site) ---------------------------------------------------
create or replace view public.public_creator_lists
with (security_invoker = false) as
  select l.slug, l.title, l.brand, l.intro, l.updated_at,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'username',  p.username,
                    'name',      p.data->>'name',
                    'followers', nullif(p.data->>'followers', '')::numeric,
                    'er',        nullif(p.data->>'er', '')::numeric,
                    'perWeek',   nullif(p.data->>'perWeek', '')::numeric,
                    'picture',   p.data->>'picture',
                    'niche',     m.niche,
                    'ville',     m.ville)
                  order by array_position(l.usernames, p.username))
           from public.ig_profiles p
           left join public.creator_base_meta m on m.username = p.username
           where p.username = any(l.usernames) and coalesce(m.excluded, false) = false
         ), '[]'::jsonb) as creators,
         l.dispos
  from public.creator_lists l
  where l.public;
grant select on public.public_creator_lists to anon, authenticated;
revoke insert, update, delete, truncate on public.public_creator_lists from anon, authenticated, public;

-- ════════════════════════════════════════════════════════════════════════════
-- Boîtes Gmail des créateurs reliées à TTP Suite (2026-11-16, sql/2026-11-16-boites-createurs.sql).
-- Jetons lus seulement par le serveur : RLS activée, aucune règle.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.creator_mail_boxes (
  email         text primary key check (email = lower(email)),
  creator       text not null,
  refresh_token text,
  access_token  text,
  expires_at    timestamptz,
  scope         text,
  connected     boolean not null default false,
  connected_at  timestamptz,
  last_error    text,
  created_at    timestamptz not null default now()
);
alter table public.creator_mail_boxes enable row level security;
revoke all on public.creator_mail_boxes from anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- Espace créateur : brief lu, concept, lien du post et stats à 7 jours
-- (2026-11-23, sql/2026-11-23-espace-createur-collab.sql). Seule définition de
-- briefs_creator_guard (le créateur écrit aussi read_at, concept, concept_link).
-- ════════════════════════════════════════════════════════════════════════════
-- 1) Brief lu et concept ------------------------------------------------------
alter table public.briefs add column if not exists read_at              timestamptz;
alter table public.briefs add column if not exists concept              text;
alter table public.briefs add column if not exists concept_link         text;
alter table public.briefs add column if not exists concept_at           timestamptz;
alter table public.briefs add column if not exists concept_status       text;
alter table public.briefs add column if not exists concept_validated_at timestamptz;

-- Garde du créateur. Sans compte connecté (serveur : résumé déposé par Claude) ou pour
-- l'agence, tout passe (sql/2026-10-25-audit). Le créateur ne change que son statut et son
-- script (consignes), « J'ai lu » (read_at : date du serveur, posée une seule fois) et son
-- concept (toujours « proposé », jamais validé par lui-même).
create or replace function public.briefs_creator_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j jsonb;
  v_concept text;
  v_link text;
begin
  if auth.uid() is null or public.is_agency() then return new; end if;
  j := jsonb_build_object('status', new.status, 'consignes', new.consignes);
  j := j || jsonb_build_object('read_at', coalesce(old.read_at, case when new.read_at is not null then now() end));
  if new.concept is distinct from old.concept or new.concept_link is distinct from old.concept_link then
    v_concept := nullif(btrim(left(coalesce(new.concept, ''), 2000)), '');
    v_link := nullif(btrim(left(coalesce(new.concept_link, ''), 500)), '');
    if v_link is not null and v_link !~* '^https?://' then v_link := null; end if;
    j := j || jsonb_build_object(
      'concept', v_concept,
      'concept_link', case when v_concept is null then null else v_link end,
      'concept_at', case when v_concept is null then null else now() end,
      'concept_status', case when v_concept is null then null else 'propose' end,
      'concept_validated_at', null);
  end if;
  return jsonb_populate_record(old, j);
end $$;
drop trigger if exists briefs_creator_guard on public.briefs;
create trigger briefs_creator_guard before update on public.briefs
  for each row execute function public.briefs_creator_guard();

-- 2) Posts publiés et stats à 7 jours -----------------------------------------
create table if not exists public.collab_posts (
  id           uuid primary key default gen_random_uuid(),
  collab_id    uuid not null references public.collabs(id) on delete cascade,
  creator      text not null,
  url          text not null check (url ~* '^https?://' and length(url) <= 500),
  platform     text,
  views        bigint check (views is null or views >= 0),
  likes        bigint check (likes is null or likes >= 0),
  comments     bigint check (comments is null or comments >= 0),
  shares       bigint check (shares is null or shares >= 0),
  saves        bigint check (saves is null or saves >= 0),
  capture_path text,
  stats_at     timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists collab_posts_collab_url_idx on public.collab_posts (collab_id, url);
create index if not exists collab_posts_creator_idx on public.collab_posts (creator);
alter table public.collab_posts enable row level security;
revoke all on public.collab_posts from anon;
grant select, insert, update, delete on public.collab_posts to authenticated;
drop policy if exists collab_posts_read on public.collab_posts;
create policy collab_posts_read on public.collab_posts for select to authenticated
  using (public.is_agency() or creator = public.my_creator());
drop policy if exists collab_posts_write on public.collab_posts;
create policy collab_posts_write on public.collab_posts for all to authenticated
  using (public.is_agency() or creator = public.my_creator())
  with check (public.is_agency() or creator = public.my_creator());

-- Garde : créateur = celui de la collab ; un créateur n'écrit que sur SES collabs et
-- seulement une capture de SON dossier ; date des stats posée par le serveur.
create or replace function public.collab_posts_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_creator text;
begin
  if tg_op = 'UPDATE' then
    new.collab_id := old.collab_id;
    new.created_at := old.created_at;
  end if;
  select c.creator into v_creator from public.collabs c where c.id = new.collab_id;
  if not found then raise exception 'collab introuvable' using errcode = '23503'; end if;
  new.creator := coalesce(nullif(btrim(v_creator), ''), new.creator);
  new.updated_at := now();
  if coalesce(new.views, new.likes, new.comments, new.shares, new.saves) is null then
    new.stats_at := null;
  elsif tg_op = 'INSERT'
     or (new.views, new.likes, new.comments, new.shares, new.saves) is distinct from (old.views, old.likes, old.comments, old.shares, old.saves) then
    new.stats_at := now();
  else
    new.stats_at := old.stats_at;
  end if;
  if auth.uid() is null or public.is_agency() then return new; end if;
  if v_creator is null or v_creator is distinct from public.my_creator() then
    raise exception 'collab interdite' using errcode = '42501';
  end if;
  if new.capture_path is not null
     and not (tg_op = 'UPDATE' and new.capture_path is not distinct from old.capture_path)
     and new.capture_path not like 'creator-uploads/' || auth.uid()::text || '/%' then
    raise exception 'capture interdite' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists collab_posts_guard on public.collab_posts;
create trigger collab_posts_guard before insert or update on public.collab_posts
  for each row execute function public.collab_posts_guard();

-- Lien → étape 6 ; stats → étape 7, seulement pour une collab déjà au tournage (étape 4)
-- ou plus loin : en dessous, le post est enregistré mais l'étape ne bouge pas. Jamais de
-- recul (le trigger collabs_log_step date l'étape). Miroir : postStepTarget (src/lib/collabPosts.ts).
create or replace function public.collab_posts_advance() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_target integer := case when new.stats_at is not null then 7 else 6 end;
begin
  update public.collabs set step = v_target
   where id = new.collab_id and coalesce(step, 1) >= 4 and coalesce(step, 1) < v_target
     and coalesce(status, 'active') not in ('perdue', 'archivee');
  return new;
end $$;
drop trigger if exists collab_posts_advance on public.collab_posts;
create trigger collab_posts_advance after insert or update on public.collab_posts
  for each row execute function public.collab_posts_advance();

-- Exclusivité : rattrapage de creators.exclu depuis la clé de blob creatorExclusive
-- (2026-11-23, sql/2026-11-23-exclu-rattrapage.sql). N'ajoute que des exclusivités.
-- ════════════════════════════════════════════════════════════════════════════
with blob as (
  select coalesce(nullif(a, ''), '{}')::jsonb -> 'creatorExclusive' as x
    from public.module_rows
   where module = '__app_state__'
), noms as (
  select distinct lower(trim(e.nom)) as nom
    from blob,
         jsonb_each_text(case when jsonb_typeof(blob.x) = 'object' then blob.x else '{}'::jsonb end) as e(nom, valeur)
   where e.valeur = 'true'
)
update public.creators c
   set exclu = true
  from noms
 where lower(trim(c.name)) = noms.nom
   and coalesce(c.exclu, false) = false;

-- File d'envoi des mails de prospection et liste « ne plus contacter » (2026-11-25,
-- sql/2026-11-25-file-envoi.sql). La tâche planifiée envoi-file-minute est dans le fichier daté.
-- ═════════════════════════════════════════════════
create table if not exists public.envoi_file (
  id uuid primary key default gen_random_uuid(),
  boite text not null,
  brouillon text not null,
  destinataires text not null default '',
  objet text not null default '',
  reponse boolean not null default false,
  createur text,
  demarrer_sequence boolean not null default false,
  lot text,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'en_cours', 'envoye', 'annule', 'echec')),
  prevu_a timestamptz not null,
  essais integer not null default 0,
  essai_at timestamptz,
  envoye_at timestamptz,
  erreur text,
  cree_par uuid,
  created_at timestamptz not null default now()
);
comment on table public.envoi_file is 'File d''envoi des mails de prospection (connecteur Claude, programmer_envoi), envoyés un par un par ttp-mcp/file-envoi';
create unique index if not exists envoi_file_brouillon_actif_idx on public.envoi_file (boite, brouillon) where statut in ('en_attente', 'en_cours');
create index if not exists envoi_file_dus_idx on public.envoi_file (prevu_a) where statut = 'en_attente';
create index if not exists envoi_file_envoyes_idx on public.envoi_file (boite, envoye_at) where statut = 'envoye';
alter table public.envoi_file enable row level security;
drop policy if exists envoi_file_fondateurs on public.envoi_file;
create policy envoi_file_fondateurs on public.envoi_file for all using (public.is_founder()) with check (public.is_founder());
revoke all on public.envoi_file from anon;

create table if not exists public.ne_plus_contacter (
  id uuid primary key default gen_random_uuid(),
  email text,
  domaine text,
  raison text not null default 'autre' check (raison in ('refus', 'arret', 'rebond', 'autre')),
  note text,
  source text,
  cree_par uuid,
  created_at timestamptz not null default now(),
  constraint ne_plus_contacter_email_ou_domaine check ((email is null) <> (domaine is null))
);
comment on table public.ne_plus_contacter is 'Adresses et sociétés à qui l''agence n''écrit plus (refus, demande d''arrêt, rebond). Liste interne, jamais mentionnée dans les mails.';
create unique index if not exists ne_plus_contacter_email_idx on public.ne_plus_contacter (lower(email)) where email is not null;
create unique index if not exists ne_plus_contacter_domaine_idx on public.ne_plus_contacter (lower(domaine)) where domaine is not null;
alter table public.ne_plus_contacter enable row level security;
drop policy if exists ne_plus_contacter_agence on public.ne_plus_contacter;
create policy ne_plus_contacter_agence on public.ne_plus_contacter for all using (public.is_agency()) with check (public.is_agency());
revoke all on public.ne_plus_contacter from anon;

create index if not exists email_activity_sortants_idx on public.email_activity (created_at desc) where direction = 'out';

-- Connecteur Claude (2026-10-19, sql/2026-10-19-connecteur-claude.sql) : TTP Suite branché
-- sur le compte Claude (ordinateur et téléphone). Connexion OAuth 2.1 (PKCE) avec le compte
-- TTP Suite, jetons courts et révocables, journal de chaque outil utilisé. Fonction : ttp-mcp.
--   mcp_clients : applications enregistrées (Claude s'enregistre tout seul)
--   mcp_grants  : une connexion = un accès accordé par un compte (révocable dans Paramètres)
--   mcp_codes   : codes d'autorisation (10 min, usage unique)
--   mcp_tokens  : jetons d'accès (1 h) et de renouvellement (60 j), stockés hachés
--   mcp_log     : ce que Claude a consulté ou fait, par qui, quand
-- Seule la fonction (clé serveur) lit et écrit les clients, les codes et les jetons. Chaque
-- compte voit ses connexions et son journal, et peut couper une connexion (revoked_at).
-- Tables dans l'ordre des clés étrangères. Doit rester avant la section securite-alfred
-- plus bas, qui lit mcp_grants.
-- ═════════════════════════════════════════════════
create table if not exists public.mcp_clients (
  client_id     text primary key,
  client_name   text,
  redirect_uris text[] not null,
  secret_hash   text,            -- null = client public (PKCE seul)
  created_at    timestamptz not null default now()
);
alter table public.mcp_clients enable row level security;
revoke all on public.mcp_clients from anon, authenticated;

create table if not exists public.mcp_grants (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  client_id    text references public.mcp_clients(client_id) on delete set null,
  client_name  text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  agent        boolean not null default false
);
-- agent : connexion d'un agent autonome, Alfred (sql/2026-11-27-securite-alfred.sql) ;
-- son commentaire est posé dans la section de ce script, plus bas.
alter table public.mcp_grants add column if not exists agent boolean not null default false;
create index if not exists mcp_grants_user_idx on public.mcp_grants (user_id, created_at desc);
alter table public.mcp_grants enable row level security;
revoke all on public.mcp_grants from anon;
-- Un compte lit ses connexions et ne peut écrire que revoked_at (couper une connexion).
-- La reprise du droit update sur la table doit précéder le droit sur la colonne.
revoke insert, update, delete on public.mcp_grants from authenticated;
grant select on public.mcp_grants to authenticated;
grant update (revoked_at) on public.mcp_grants to authenticated;
drop policy if exists mcp_grants_own_read on public.mcp_grants;
create policy mcp_grants_own_read on public.mcp_grants for select to authenticated
  using (user_id = auth.uid());
drop policy if exists mcp_grants_own_revoke on public.mcp_grants;
create policy mcp_grants_own_revoke on public.mcp_grants for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.mcp_codes (
  code_hash      text primary key,
  grant_id       uuid not null references public.mcp_grants(id) on delete cascade,
  client_id      text not null references public.mcp_clients(client_id) on delete cascade,
  redirect_uri   text not null,
  code_challenge text not null,
  expires_at     timestamptz not null,
  used_at        timestamptz
);
alter table public.mcp_codes enable row level security;
revoke all on public.mcp_codes from anon, authenticated;

create table if not exists public.mcp_tokens (
  token_hash text primary key,
  kind       text not null check (kind in ('access', 'refresh')),
  grant_id   uuid not null references public.mcp_grants(id) on delete cascade,
  client_id  text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mcp_tokens_grant_idx on public.mcp_tokens (grant_id);
alter table public.mcp_tokens enable row level security;
revoke all on public.mcp_tokens from anon, authenticated;

create table if not exists public.mcp_log (
  id       bigserial primary key,
  user_id  uuid references auth.users(id) on delete cascade,
  grant_id uuid references public.mcp_grants(id) on delete set null,
  tool     text not null,
  summary  text,
  ok       boolean not null default true,
  at       timestamptz not null default now(),
  error    text
);
-- error : raison d'un appel raté, et index des échecs récents (sql/2026-11-24-mcp-log-erreur.sql).
alter table public.mcp_log add column if not exists error text;
comment on column public.mcp_log.error is 'Raison d''un appel raté (message renvoyé à Claude), null si réussi';
create index if not exists mcp_log_user_idx on public.mcp_log (user_id, at desc);
create index if not exists mcp_log_echecs_idx on public.mcp_log (at desc) where not ok;
alter table public.mcp_log enable row level security;
revoke all on public.mcp_log from anon;
-- Un compte lit son propre journal ; seule la fonction écrit.
revoke insert, update, delete on public.mcp_log from authenticated;
grant select on public.mcp_log to authenticated;
drop policy if exists mcp_log_own_read on public.mcp_log;
create policy mcp_log_own_read on public.mcp_log for select to authenticated
  using (user_id = auth.uid());

-- Factures : garde-fous en base (audit du 1er novembre, sql/2026-11-01-factures-garde-fous.sql).
-- 1) Une facture émise (tout sauf « brouillon ») ne se supprime pas, même hors de l'app :
--    elle s'annule (statut « annulee ») et garde son numéro, sans trou dans la numérotation.
-- 2) Date de paiement paid_at (colonne créée en section 1, avec le numéro unique
--    invoices_ref_unique) : remplie toute seule au passage en « payee », vidée quand la
--    facture quitte « payee ». Sert à « Encaissé ce mois », au rapprochement bancaire (Qonto)
--    et à « Ce qu'on te doit » dans l'espace créateur.
create or replace function public.invoices_no_delete()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(old.status, '') <> 'brouillon' then
    raise exception 'Facture % émise : elle ne se supprime pas, elle s''annule (statut Annulée).', old.ref
      using errcode = '42501';
  end if;
  return old;
end $$;
drop trigger if exists invoices_no_delete on public.invoices;
create trigger invoices_no_delete before delete on public.invoices
  for each row execute function public.invoices_no_delete();

create or replace function public.invoices_paid_at()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status = 'payee' and (tg_op = 'INSERT' or old.status is distinct from 'payee') then
    new.paid_at := coalesce(new.paid_at, now());
  elsif new.status <> 'payee' then
    new.paid_at := null;
  end if;
  return new;
end $$;
drop trigger if exists invoices_paid_at on public.invoices;
create trigger invoices_paid_at before insert or update of status, paid_at on public.invoices
  for each row execute function public.invoices_paid_at();

-- Tâches internes privées (24/11) : un rendez-vous recopié d'une tâche (« Tâche : … ») est
-- TOUJOURS interne, d'où qu'il vienne : Planning de l'app, Google Agenda ou connecteur
-- (sql/2026-11-24-rdv-taches-internes-auto.sql). La colonne events.interne est créée en
-- section 1 ; les règles events_read et events_write (section 5), todos_read et
-- activity_events_read complètent la protection. Le rattrapage des rendez-vous existants
-- du script daté (données) n'est pas repris ici.
create or replace function public.events_interne_auto() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(new.title, '') ~* '^\s*t[âa]che\s*:' then new.interne := true; end if;
  return new;
end $$;
drop trigger if exists events_interne_auto on public.events;
create trigger events_interne_auto before insert or update of title, interne on public.events
  for each row execute function public.events_interne_auto();

-- ════════════════════════════════════════════════════════════════════════════
-- Alfred relié à l'app (2026-11-18, sql/2026-11-18-alfred-relie-a-l-app.sql) : les
-- nouvelles de l'app pour Alfred. Une tâche cochée par un créateur ou par Gianni, une pièce
-- déposée sur une tâche, une facture payée, un mail validé dans la page Agents ou une action
-- de Gianni ajoute une ligne dans agent.evenements, qu'Alfred reçoit dans la minute
-- (fonction alfred-pont). Marc, Claude et les automatismes ne réveillent pas Alfred
-- (agent.est_marc). Une erreur chez Alfred ne bloque JAMAIS la modification faite dans l'app.
-- Les tables agent.evenements (avec sa règle evenements_fondateurs et ses droits) et
-- agent.demandes, les colonnes de agent.agents et le statut « valide » de agent.actions sont
-- posés plus haut, dans le module « AGENT · fiches des agents et liaison Alfred ». Les
-- fonctions et déclencheurs viennent ici, après ce qu'ils lisent (public.profiles.display_name,
-- public.agency_activity). La tâche planifiée agent-watchdog du script daté n'est jamais
-- reprise (pas de cron dans ce fichier).
-- Droits : les fonctions de déclencheur ci-dessous sont fermées à anon, aux comptes connectés
-- et à public, comme en production, par un retrait explicite juste après le dernier
-- déclencheur et par les boucles de sécurité qui suivent
-- (sql/2026-11-25-securite-fonctions-anon.sql et sql/2026-11-27-securite-lot2.sql).
-- agent.qui_agit() reste appelable par tous, comme en production.
-- ════════════════════════════════════════════════════════════════════════════

-- Qui agit (prénom affiché), d'après la session ; null pour le serveur.
create or replace function agent.qui_agit() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(p.display_name), ''), nullif(trim(p.creator_name), ''), p.role)
    from public.profiles p where p.user_id = auth.uid() limit 1;
$$;

-- Marc, Claude et les automatismes ne réveillent pas Alfred (il le sait déjà).
-- search_path : celui posé par sql/2026-11-27-securite-lot2.sql.
create or replace function agent.est_marc(nom text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(nom, '') ~* '^(marc|claude|automatique|alfred)' ;
$$;

-- Nombre de pièces d'une tâche (0 si le champ n'est pas une liste).
-- search_path : celui posé par sql/2026-11-27-securite-lot2.sql.
create or replace function agent.nb_pieces(j jsonb) returns integer
language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(j) = 'array' then jsonb_array_length(j) else 0 end;
$$;

-- Corps identique à la production (commentaires sortis du corps) : d'abord une tâche cochée
-- par un créateur ou par Gianni (« Fait par », sinon le compte connecté), puis une pièce
-- déposée sur une tâche (preview, capture, facture du créateur). En cas d'erreur, la tâche
-- s'enregistre quand même (« exception when others then return new »).
create or replace function agent.nouvelle_tache() returns trigger
language plpgsql security definer set search_path = public, agent as $$
declare v_qui text := coalesce(new.done_by, agent.qui_agit());
begin
  if new.done and not coalesce(old.done, false) and not agent.est_marc(v_qui) then
    insert into agent.evenements (type, cible, detail, lien, auteur)
    values ('tache_cochee', coalesce(new.creator, new.creators::text), new.text, '/?open=view&view=todo&item=' || new.id, v_qui);
  end if;
  if agent.nb_pieces(new.attachments) > agent.nb_pieces(old.attachments)
     and not agent.est_marc(agent.qui_agit()) then
    insert into agent.evenements (type, cible, detail, lien, auteur)
    values ('piece_deposee', coalesce(new.creator, new.creators::text), new.text, '/?open=view&view=todo&item=' || new.id, agent.qui_agit());
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists alfred_nouvelle_tache on public.todos;
create trigger alfred_nouvelle_tache after update on public.todos
  for each row execute function agent.nouvelle_tache();

-- Une facture passée « payee » (alfred_nouvelle_facture). En cas d'erreur, la facture
-- s'enregistre quand même.
create or replace function agent.nouvelle_facture() returns trigger
language plpgsql security definer set search_path = public, agent as $$
begin
  if new.status = 'payee' and coalesce(old.status, '') <> 'payee' then
    insert into agent.evenements (type, cible, detail, lien, auteur)
    values ('facture_payee', new.creator, new.ref || ' · ' || new.party || ' · ' || new.amount, '/?open=view&view=facturation', agent.qui_agit());
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists alfred_nouvelle_facture on public.invoices;
create trigger alfred_nouvelle_facture after update on public.invoices
  for each row execute function agent.nouvelle_facture();

-- Un mail ou un message validé dans la page Agents (bouton « Valider », statut « valide ») :
-- Alfred est prévenu dans la minute qu'il doit l'envoyer (alfred_action_validee).
create or replace function agent.action_validee() returns trigger
language plpgsql security definer set search_path = public, agent as $$
begin
  if new.statut = 'valide' and coalesce(old.statut, '') <> 'valide' then
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

-- Ce que fait Gianni (ou un autre membre de l'équipe, hors Marc) dans l'app, noté dans
-- agency_activity (alfred_action_equipe).
create or replace function agent.action_equipe() returns trigger
language plpgsql security definer set search_path = public, agent as $$
begin
  if not agent.est_marc(new.actor_name) then
    insert into agent.evenements (type, cible, detail, auteur)
    values ('action_equipe', new.entity, coalesce(new.verb, '') || ' · ' || coalesce(new.label, ''), new.actor_name);
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists alfred_action_equipe on public.agency_activity;
create trigger alfred_action_equipe after insert on public.agency_activity
  for each row execute function agent.action_equipe();

-- L'auteur d'une demande à Alfred vient de la session, jamais de ce que le navigateur envoie
-- (alfred_demande_auteur). Sans « exception when others » : une erreur ici refuse la demande
-- au lieu de laisser le navigateur choisir l'auteur.
create or replace function agent.demande_auteur() returns trigger
language plpgsql security definer set search_path = public, agent as $$
begin
  new.auteur := agent.qui_agit();
  new.auteur_id := auth.uid();
  return new;
end $$;
drop trigger if exists alfred_demande_auteur on agent.demandes;
create trigger alfred_demande_auteur before insert on agent.demandes
  for each row execute function agent.demande_auteur();

-- Droits comme en production (sql/2026-11-25-securite-fonctions-anon.sql et
-- sql/2026-11-27-securite-lot2.sql) : les cinq fonctions de déclencheur d'Alfred ne sont
-- exécutables que par leur propriétaire. Les boucles qui suivent le font aussi ; ce retrait
-- explicite tient même si l'ordre des blocs change.
revoke execute on function agent.nouvelle_tache(), agent.nouvelle_facture(), agent.action_validee(),
  agent.action_equipe(), agent.demande_auteur() from public, anon, authenticated;

-- Sécurité (sql/2026-11-25-securite-fonctions-anon.sql) : les fonctions de déclencheur
-- SECURITY DEFINER ne sont pas appelables par anon (un déclencheur ne vérifie pas ce droit).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and n.nspname in ('public', 'agent')
      and pg_get_function_result(p.oid) = 'trigger'
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke execute on function %s from anon, public', f.sig);
  end loop;
end $$;

-- Sécurité (sql/2026-11-27-securite-lot2.sql) : search_path fixé pour les fonctions
-- signalées par le contrôle de Supabase, et fonctions de déclencheur SECURITY DEFINER
-- fermées aux comptes connectés aussi (un déclencheur ne vérifie pas ce droit).
do $$
declare f text;
begin
  foreach f in array array[
    'public.invoices_no_delete()',
    'public.invoices_paid_at()',
    'public.brief_status_for_step(integer)',
    'public.collab_step_for_brief(text)',
    'public.touch_updated_at()',
    'public.touch_updated_at_simple()',
    'public.events_guard_delete()',
    'public.collabs_touch()',
    'public.activity_last_line(text)',
    'public.activity_new_subtask(jsonb, jsonb)',
    'agent.touch_maj()',
    'agent.est_marc(text)',
    'agent.nb_pieces(jsonb)'
  ] loop
    -- Certaines viennent d'autres scripts de sql/ : seulement celles qui existent.
    if to_regprocedure(f) is not null then
      execute format('alter function %s set search_path = public, pg_temp', f);
    end if;
  end loop;
end $$;
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and n.nspname in ('public', 'agent')
      and pg_get_function_result(p.oid) = 'trigger'
      and (has_function_privilege('authenticated', p.oid, 'execute')
           or has_function_privilege('anon', p.oid, 'execute'))
  loop
    execute format('revoke execute on function %s from anon, authenticated, public', f.sig);
  end loop;
end $$;

-- Sécurité (sql/2026-11-27-securite-alfred.sql) : validation dans l'app pour les agents
-- autonomes du connecteur Claude (mcp_grants.agent, agent.actions.valide_par / valide_le /
-- outil posés par la base, envoi_file.valide_le). Voir ttp-mcp/verrou.ts.
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

-- ════════════════════════════════════════════════════════════════════════════
-- Notes (repliée depuis la production le 27/11/2026). Aucun script daté : ni dans sql/,
-- ni dans migrations/, et aucun code de ce dépôt ne s'en sert. La table a été créée à la
-- main pour un outil extérieur au dépôt (sans doute un coffre de notes), qui y écrit avec
-- la clé serveur : une note par chemin (path), avec titre, dossier, contenu et date de
-- mise à jour. Aucune règle d'écriture.
-- Lecture : le seul compte de Marc, désigné par son adresse dans la règle (« lecture
-- agence », nom gardé tel qu'en production).
-- Droits de table : ceux que Supabase donne à toute nouvelle table de public (anon et
-- authenticated compris), comme en production. C'est la RLS qui protège la table : ne
-- jamais la créer sans la RLS et la règle qui suivent.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.notes (
  path       text primary key,
  title      text not null,
  folder     text default '',
  content    text not null,
  updated_at timestamptz default now()
);
alter table public.notes enable row level security;
drop policy if exists "lecture agence" on public.notes;
create policy "lecture agence" on public.notes for select to authenticated
  using ((auth.jwt() ->> 'email') = 'marcbouraoui@gmail.com');
