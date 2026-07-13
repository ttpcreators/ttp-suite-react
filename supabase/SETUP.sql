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
alter table public.creators add column if not exists stats_month text;   -- sql/11 : mois de dernière MAJ des datas
alter table public.creators add column if not exists mediakit jsonb;     -- sql/14 : contenu du media kit (bio, audience, stats par plateforme, marques, photos)

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
alter table public.contacts add column if not exists creator text;       -- sql/12 : contact ajouté par un créateur (NULL = agence)

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
alter table public.events add column if not exists description text;                       -- sql/09 (Planning + sync Google)
-- Colonnes de synchronisation Google Agenda (migrations/20260702_google_calendar.sql) :
alter table public.events add column if not exists google_event_id text;
alter table public.events add column if not exists google_etag     text;
alter table public.events add column if not exists updated_at      timestamptz not null default now();
alter table public.events add column if not exists last_synced_at  timestamptz;
alter table public.events add column if not exists sync_source     text default 'agence';
alter table public.events add column if not exists deleted         boolean not null default false;
alter table public.events add column if not exists deleted_at      timestamptz;

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

-- GARDE-FOU colonnes sensibles : la policy `for all` ci-dessus laisse un créateur
-- écrire SA fiche — donc, via un appel API direct (hors UI), modifier des colonnes
-- qui ne le regardent pas : ca (CA, calculé depuis les factures), commission, status
-- (actif/inactif), exclu (exclusivité), sort_order (ordre roster de l'agence).
-- Même logique que pour invoices : on ferme le trou côté base, pas seulement côté UI.
-- Un trigger BEFORE UPDATE force ces colonnes à conserver leur ANCIENNE valeur quand
-- l'auteur n'est pas l'agence. L'agence n'est jamais affectée ; les vraies éditions du
-- créateur (coordonnées, réseaux, followers/ER/reach, bio, media kit…) passent normalement.
create or replace function public.creators_guard() returns trigger
  language plpgsql security definer as $$
begin
  if not public.is_agency() then
    new.ca         := old.ca;
    new.commission := old.commission;
    new.status     := old.status;
    new.exclu      := old.exclu;
    new.sort_order := old.sort_order;
  end if;
  return new;
end $$;
drop trigger if exists creators_guard_upd on public.creators;
create trigger creators_guard_upd before update on public.creators
  for each row execute function public.creators_guard();

-- DONNÉES AGENCE PURES : agence seulement
-- contacts : partagés — l'agence voit/gère tout ; le créateur voit ceux de l'agence
-- (creator NULL) + ajoute/gère les siens (creator = son nom). (sql/12)
create policy contacts_scoped on public.contacts for all to authenticated
  using (public.is_agency() or creator is null or creator = public.my_creator())
  with check (public.is_agency() or creator = public.my_creator());
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
-- LECTURE : le créateur voit tout évènement où son nom figure (liste "Nom A, Nom B").
-- ÉCRITURE : il ne peut créer/modifier QUE des évènements qui le concernent lui seul
-- (who = son nom) — il ne peut pas taguer d'autres créateurs à sa place. (sql/13)
create policy events_scoped on public.events for all to authenticated
  using (public.is_agency() or public.my_creator() = any(string_to_array(coalesce(who,''), ', ')))
  with check (public.is_agency() or who = public.my_creator());

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
create or replace function public.app_state_set(p_key text, p_value jsonb)
returns void
language plpgsql
security invoker              -- respecte la RLS module_rows (agence seule écrit)
set search_path = public
as $$
declare v_id uuid;
begin
  select id into v_id
    from public.module_rows
   where module = '__app_state__'
   order by created_at desc
   limit 1;
  if v_id is null then
    insert into public.module_rows (module, a)
      values ('__app_state__', jsonb_build_object(p_key, p_value)::text);
  else
    update public.module_rows
       set a = jsonb_set(coalesce(a, '{}')::jsonb, array[p_key], p_value, true)::text
     where id = v_id;
  end if;
end;
$$;
grant execute on function public.app_state_set(text, jsonb) to authenticated;

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
    select a from public.module_rows
     where module = '__app_state__' and a is not null
     order by created_at desc limit 1;
  delete from public.app_state_backups where created_at < now() - interval '30 days';
end;
$$;
revoke execute on function public.backup_app_state() from public, anon, authenticated;

-- ─── 7.5 Synchronisation Google Agenda (migrations/20260702_google_calendar.sql)
-- Colonnes de sync sur events : déjà ajoutées plus haut (section events). Ici :
-- fonctions trigger, tables singleton, contrainte/index, triggers. Les crons
-- (google-watch-renew, events-purge-tombstones, google-sync-hourly) sont EXCLUS.

-- 7.5.a Fonctions trigger updated_at (+ garde de source d'écriture).
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
declare
  v_pg_role  text := current_user;
  v_jwt_role text := current_setting('request.jwt.claim.role', true);
begin
  -- Écriture applicative (UI agence) → origine 'agence', horodatée now().
  -- Écriture serveur (service_role, sync Google) → préserve updated_at si 'google'.
  if v_pg_role <> 'service_role' and coalesce(v_jwt_role, '') <> 'service_role' then
    new.sync_source := 'agence';
    new.updated_at := now();
  else
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

create or replace function public.events_guard_delete()
returns trigger
language plpgsql
as $$
begin
  if old.google_event_id is not null and old.deleted = false then
    update public.events
       set deleted     = true,
           deleted_at  = now(),
           sync_source = 'agence',
           updated_at  = now()
     where id = old.id;
    return null;  -- annule le DELETE physique → tombstone propagée à Google
  end if;
  return old;     -- laisse supprimer les lignes jamais synchronisées
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

-- ============================================================================
-- FIN. Vérif rapide (en étant DÉCONNECTÉ, ces requêtes doivent renvoyer 0 ligne) :
--   select * from public.creators;
--   select * from public.contacts;
-- ============================================================================
