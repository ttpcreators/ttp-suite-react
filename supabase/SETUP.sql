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

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  ref text, party text, amount text, date text, status text default 'brouillon',
  creator text,
  sort_order int default 0, created_at timestamptz default now()
);
alter table public.invoices add column if not exists creator text;

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  brand text not null, person text, role text, tag text,
  email text, phone text, tone text default 'cyan',
  sort_order int default 0, created_at timestamptz default now()
);
alter table public.contacts add column if not exists first_name text;
alter table public.contacts add column if not exists last_name text;

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

create table if not exists public.briefs (
  id uuid primary key default gen_random_uuid(),
  brand text, creator text, who text, deliverables text, due text,
  status text default 'cours', tone text default 'cyan',
  consignes text, budget text, objectif text, validated boolean default false,
  note text, sort_order int default 0, created_at timestamptz default now()
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

create or replace function public.my_creator() returns text
  language sql stable security definer as $$
  select creator_name from public.profiles where user_id = auth.uid();
$$;

-- À l'inscription (via la page Accès), on ne fait JAMAIS confiance au rôle envoyé
-- dans les métadonnées (contrôlable par le client → un compte pourrait se déclarer
-- 'agency'). Rôle = TOUJOURS 'creator' ici ; la promotion agence se fait
-- EXCLUSIVEMENT via la liste d'emails de la section 4 ci-dessous.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (user_id, role, creator_name)
  values (
    new.id,
    'creator',
    nullif(new.raw_user_meta_data->>'creator_name','')
  )
  on conflict (user_id) do update
    set creator_name = coalesce(excluded.creator_name, public.profiles.creator_name);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 4) RÔLE AGENCE (fait AVANT le verrouillage → pas de lock-out)
-- ----------------------------------------------------------------------------
insert into public.profiles (user_id, role)
  select id, 'agency' from auth.users
   where email in ('partnerships@ttpcreators.pro','marcbouraoui@gmail.com','agence@ttp.com')
  on conflict (user_id) do update set role = 'agency';

-- ----------------------------------------------------------------------------
-- 5) SÉCURITÉ : on supprime TOUTE policy existante, RLS ON partout,
--    puis on recrée UNIQUEMENT le bon modèle.
-- ----------------------------------------------------------------------------
do $$
declare r record; t text;
declare tbls text[] := array[
  'creators','contacts','invoices','prospects','module_rows',
  'todos','briefs','ideas','events','messages','profiles','documents'
];
begin
  for r in select policyname, tablename from pg_policies
            where schemaname='public' and tablename = any(tbls)
  loop execute format('drop policy if exists %I on public.%I;', r.policyname, r.tablename); end loop;
  foreach t in array tbls loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- CREATORS : agence = tout ; créateur = sa propre fiche
create policy creators_scoped on public.creators for all to authenticated
  using (public.is_agency() or name = public.my_creator())
  with check (public.is_agency() or name = public.my_creator());

-- DONNÉES AGENCE PURES : agence seulement
create policy contacts_agency    on public.contacts    for all to authenticated using (public.is_agency()) with check (public.is_agency());
-- invoices : ÉCRITURE réservée à l'agence ; le créateur ne peut que LIRE les siennes.
-- (Comme documents : un `for all` incluant le créateur le laissait modifier/insérer/
--  supprimer ses propres factures — falsifier le CA, effacer une facture en retard.)
create policy invoices_agency       on public.invoices for all    to authenticated
  using (public.is_agency()) with check (public.is_agency());
create policy invoices_creator_read on public.invoices for select to authenticated
  using (public.is_agency() or creator = public.my_creator());
create policy prospects_agency   on public.prospects   for all to authenticated using (public.is_agency()) with check (public.is_agency());
create policy module_rows_agency on public.module_rows for all to authenticated using (public.is_agency()) with check (public.is_agency());

-- DONNÉES PAR CRÉATEUR : agence = tout ; créateur = uniquement les siennes
create policy todos_scoped  on public.todos  for all to authenticated
  using (public.is_agency() or creator = public.my_creator()) with check (public.is_agency() or creator = public.my_creator());
create policy briefs_scoped on public.briefs for all to authenticated
  using (public.is_agency() or creator = public.my_creator()) with check (public.is_agency() or creator = public.my_creator());
create policy ideas_scoped  on public.ideas  for all to authenticated
  using (public.is_agency() or creator = public.my_creator()) with check (public.is_agency() or creator = public.my_creator());
-- events : un événement peut concerner plusieurs créateurs (who = "Nom A, Nom B").
-- Le créateur le voit si son nom figure dans la liste.
create policy events_scoped on public.events for all to authenticated
  using (public.is_agency() or public.my_creator() = any(string_to_array(coalesce(who,''), ', ')))
  with check (public.is_agency() or public.my_creator() = any(string_to_array(coalesce(who,''), ', ')));

-- MESSAGES : agence = tout ; créateur = les siens + annonces globales (creator NULL)
create policy messages_scoped on public.messages for all to authenticated
  using (public.is_agency() or creator = public.my_creator() or creator is null)
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

-- ----------------------------------------------------------------------------
-- 6) STORAGE : bucket privé `documents` (binaires des fichiers)
--    Accès réservé aux comptes connectés (anonyme = rien). Le cloisonnement
--    par créateur est assuré par la table `documents` ci-dessus + URLs signées.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('documents','documents', false)
  on conflict (id) do nothing;

-- Bucket privé `documents` : l'AGENCE gère tout ; un CRÉATEUR ne peut que LIRE
-- (créer une URL signée) les fichiers rattachés à une de SES fiches documents.
-- (Avant : tout compte authentifié avait accès total au bucket entier.)
drop policy if exists documents_obj_auth on storage.objects;
drop policy if exists documents_obj_agency on storage.objects;
drop policy if exists documents_obj_creator_read on storage.objects;
create policy documents_obj_agency on storage.objects for all to authenticated
  using (bucket_id = 'documents' and public.is_agency())
  with check (bucket_id = 'documents' and public.is_agency());
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
insert into storage.buckets (id, name, public)
  values ('avatars','avatars', true)
  on conflict (id) do nothing;

drop policy if exists avatars_obj_rw on storage.objects;
create policy avatars_obj_rw on storage.objects for all to authenticated
  using (bucket_id = 'avatars') with check (bucket_id = 'avatars');

-- ============================================================================
-- FIN. Vérif rapide (en étant DÉCONNECTÉ, ces requêtes doivent renvoyer 0 ligne) :
--   select * from public.creators;
--   select * from public.contacts;
-- ============================================================================
