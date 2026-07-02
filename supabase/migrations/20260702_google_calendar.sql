-- =============================================================================
-- Migration : Synchronisation bidirectionnelle temps réel  events <-> Google Calendar
-- Projet Supabase : zizvggziggswhrbuyhuo
-- Option C — mono-agence (un seul compte Google, calendrier 'primary')
--
-- Contenu :
--   1. Fonctions trigger updated_at (events + tables singleton) + garde sync_source
--   2. Table google_tokens (singleton) + RLS deny-all
--   3. Table sync_state (singleton, curseur + watch + lease de verrou) + RLS deny-all
--   4. ALTER TABLE events : colonnes de sync (google_event_id, updated_at, ...)
--   5. Backfill contrôlé de l'existant (évite push massif + faux conflits au 1er sync)
--   6. Index (dont UNIQUE sur google_event_id)
--   7. Trigger BEFORE DELETE : transforme un DELETE physique en tombstone si synchronisé
--   8. Planification pg_cron : renouvellement watch, purge tombstones, sync horaire
--
-- Idempotente : peut être rejouée sans erreur.
--
-- SÉCURITÉ :
--   - google_tokens et sync_state : RLS ON SANS AUCUNE policy => deny-all pour anon
--     et authenticated. Seules les Edge Functions (service_role, bypass RLS) accèdent.
--   - Le refresh_token / client_secret ne sortent JAMAIS vers le front.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Extensions requises pour la planification (pg_cron + pg_net)
-- -----------------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;


-- =============================================================================
-- 1. Fonctions trigger « updated_at » + garde de source
-- =============================================================================

-- 1.a events : ne rafraîchit updated_at QUE si l'écriture ne vient PAS de Google,
--     ET force sync_source='agence' pour toute mutation issue d'un rôle applicatif
--     (authenticated). Le service_role (sync serveur) pose explicitement 'google'
--     et n'est PAS forcé ici. Cela garantit :
--       * une modif UI d'une ligne d'origine Google repasse en 'agence' => re-poussée ;
--       * updated_at est bien rafraîchi pour toute mutation agence.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
declare
  v_role text := current_setting('request.jwt.claim.role', true);
begin
  -- Le service_role de la sync serveur passe request.jwt.claim.role = 'service_role'
  -- (ou aucune claim). Toute autre valeur (authenticated) = mutation UI/front.
  if v_role is distinct from 'service_role' then
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

-- 1.b Version simple pour les tables singleton (google_tokens, sync_state).
create or replace function public.touch_updated_at_simple()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- =============================================================================
-- 2. Table google_tokens (singleton — id = 1)
-- =============================================================================
create table if not exists public.google_tokens (
  id             int         primary key default 1,
  google_sub     text,
  google_email   text,
  access_token   text,                                     -- SECRET
  refresh_token  text,                                     -- SECRET — jamais renvoyé, jamais écrasé par null
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
end
$$;

alter table public.google_tokens enable row level security;
revoke all on table public.google_tokens from anon, authenticated;

drop trigger if exists google_tokens_touch on public.google_tokens;
create trigger google_tokens_touch
  before update on public.google_tokens
  for each row execute function public.touch_updated_at_simple();


-- =============================================================================
-- 3. Table sync_state (singleton — id = 1)
--    Curseur de sync (nextSyncToken) + watch channel + LEASE de verrou (syncing_at).
-- =============================================================================
create table if not exists public.sync_state (
  id                  int         primary key default 1,
  sync_token          text,
  channel_id          text,
  channel_resource_id text,
  channel_token       text,                                -- SECRET (X-Goog-Channel-Token)
  channel_expiration  timestamptz,
  last_sync_at        timestamptz,
  syncing             boolean     not null default false,
  syncing_at          timestamptz,                         -- lease : quand le verrou a été pris
  updated_at          timestamptz not null default now()
);

-- Colonne lease ajoutée si la table préexistait (idempotence).
alter table public.sync_state add column if not exists syncing_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sync_state_singleton') then
    alter table public.sync_state add constraint sync_state_singleton check (id = 1);
  end if;
end
$$;

alter table public.sync_state enable row level security;
revoke all on table public.sync_state from anon, authenticated;

drop trigger if exists sync_state_touch on public.sync_state;
create trigger sync_state_touch
  before update on public.sync_state
  for each row execute function public.touch_updated_at_simple();

-- Amorçage des rows singleton.
insert into public.google_tokens (id) values (1) on conflict (id) do nothing;
insert into public.sync_state    (id) values (1) on conflict (id) do nothing;


-- =============================================================================
-- 4. ALTER TABLE events : colonnes de synchronisation
-- =============================================================================
alter table public.events
  add column if not exists google_event_id text,
  add column if not exists google_etag     text,
  add column if not exists updated_at      timestamptz not null default now(),
  add column if not exists last_synced_at  timestamptz,
  add column if not exists sync_source     text default 'agence',
  add column if not exists deleted         boolean not null default false,
  add column if not exists deleted_at      timestamptz;


-- =============================================================================
-- 5. Backfill contrôlé de l'existant
--    Sans ça : au 1er sync tous les events legacy (last_synced_at NULL) seraient
--    poussés en masse vers Google, et updated_at=now() ferait perdre tous les
--    conflits contre les events importés de Google.
--    Politique : les events préexistants sont considérés "déjà à jour" (pas de
--    push initial). L'import Google se fait via le PULL au premier cycle.
-- =============================================================================
update public.events
   set updated_at     = coalesce(created_at, now()),
       last_synced_at = now(),
       sync_source    = 'agence'
 where google_event_id is null
   and last_synced_at is null;


-- =============================================================================
-- 6. Index sur events
-- =============================================================================

-- 6.a UNIQUE sur google_event_id (mapping 1:1). Les null multiples restent permis.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_google_event_id_key') then
    alter table public.events add constraint events_google_event_id_key unique (google_event_id);
  end if;
end
$$;

create index if not exists events_updated_at_idx on public.events (updated_at);

create index if not exists events_pending_push_idx
  on public.events (updated_at)
  where sync_source = 'agence' and deleted = false;

create index if not exists events_deleted_idx on public.events (deleted);


-- =============================================================================
-- 7. Trigger updated_at + garde DELETE sur events
-- =============================================================================
drop trigger if exists events_touch_updated_at on public.events;
create trigger events_touch_updated_at
  before insert or update on public.events
  for each row execute function public.touch_updated_at();

-- 7.b Garde-fou : un DELETE physique sur un event DÉJÀ synchronisé (google_event_id
--     non null) doit être transformé en tombstone (deleted=true) pour que la
--     suppression soit propagée à Google. Sinon la ligne disparaît sans push =>
--     l'event survit côté Google et est re-tiré au PULL suivant.
--     On laisse passer le DELETE physique uniquement pour les lignes jamais
--     synchronisées (google_event_id null) — rien à propager.
create or replace function public.events_guard_delete()
returns trigger
language plpgsql
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


-- =============================================================================
-- 8. Planification pg_cron
--    Les appels HTTP utilisent app.cron_secret (= CRON_SECRET côté Edge).
--    À configurer UNE FOIS (superuser, hors migration) :
--        alter database postgres set app.cron_secret = '<CRON_SECRET>';
-- =============================================================================
do $$
declare
  v_base_url text := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1';
begin
  -- 8.a Renouvellement du watch channel : chaque jour à 01:00 UTC (03:00 Paris).
  if exists (select 1 from cron.job where jobname = 'google-watch-renew') then
    perform cron.unschedule('google-watch-renew');
  end if;
  perform cron.schedule(
    'google-watch-renew',
    '0 1 * * *',
    format(
      $job$
      select net.http_post(
        url     := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), '')
        ),
        body    := '{}'::jsonb
      );
      $job$,
      v_base_url || '/google-watch-renew'
    )
  );

  -- 8.b Purge des tombstones synchronisés : chaque jour à 02:00 UTC (04:00 Paris).
  if exists (select 1 from cron.job where jobname = 'events-purge-tombstones') then
    perform cron.unschedule('events-purge-tombstones');
  end if;
  perform cron.schedule(
    'events-purge-tombstones',
    '0 2 * * *',
    $job$
    delete from public.events
     where deleted = true
       and last_synced_at is not null
       and deleted_at < now() - interval '7 days';
    $job$
  );

  -- 8.c Filet de sécurité : sync complet chaque heure (minute 17).
  if exists (select 1 from cron.job where jobname = 'google-sync-hourly') then
    perform cron.unschedule('google-sync-hourly');
  end if;
  perform cron.schedule(
    'google-sync-hourly',
    '17 * * * *',
    format(
      $job$
      select net.http_post(
        url     := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), '')
        ),
        body    := '{"trigger":"cron"}'::jsonb
      );
      $job$,
      v_base_url || '/google-sync'
    )
  );
end
$$;

-- =============================================================================
-- FIN DE MIGRATION
-- =============================================================================
