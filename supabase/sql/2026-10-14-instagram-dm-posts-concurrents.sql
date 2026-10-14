-- ============================================================================
-- Instagram · DM de TTP, posts programmés, agences concurrentes
-- Titre Supabase : « Instagram · DM + posts programmés + concurrents »
-- ============================================================================
-- 1. ig_threads + ig_messages : conversations privées (DM) du compte Instagram de
--    TTP, lues par la fonction ig-inbox (toutes les heures). Lecture agence ;
--    l'agence peut relier une conversation à une fiche contact ou la masquer.
-- 2. ig_planned : posts, carrousels, reels et stories à publier sur le compte TTP
--    (Planning → Posts Instagram). L'agence crée, modifie, supprime ; la fonction
--    ig-publish publie à l'heure prévue. Bucket PUBLIC « ig-posts » pour les photos
--    et vidéos : Meta les télécharge depuis un lien public au moment de publier.
-- 3. ig_rivals : agences concurrentes suivies (Sourcing → Concurrents) : abonnés
--    jour par jour, créatrices mises en avant, marques. L'agence ajoute et retire ;
--    ig-sourcing lit les chiffres (à chaque passage du radar, une fois par jour).
-- 4. ig_sync_state : dernier passage de ig-inbox / ig-publish (affiché dans l'app).
-- 5. Crons : ig-inbox toutes les heures ; ig-publish chaque minute, mais SEULEMENT
--    s'il y a un post à publier (sinon la fonction n'est même pas appelée).
-- Rien de visible par les créatrices.
-- ============================================================================

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

-- 5. Crons : même secret que la tâche ig-sync-quotidien (repris tout seul) --------
do $do$
declare v_secret text;
begin
  select substring(command from 'Bearer ([^'']+)') into v_secret
    from cron.job
   where (jobname = 'ig-sync-quotidien' or command like '%functions/v1/gmail-%') and command like '%Bearer %'
   order by (jobname = 'ig-sync-quotidien') desc, jobid limit 1;
  if v_secret is null or v_secret like 'REMPLACE_MOI%' then
    raise notice 'Secret des crons introuvable : crons ig-inbox et ig-publish NON planifiés (voir README).';
    return;
  end if;
  perform cron.unschedule('ig-inbox-horaire') where exists (select 1 from cron.job where jobname = 'ig-inbox-horaire');
  perform cron.schedule('ig-inbox-horaire', '25 * * * *', format($cmd$
    select net.http_post(
      url := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-inbox',
      headers := jsonb_build_object('Authorization', 'Bearer %s', 'Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000
    );
  $cmd$, v_secret));
  perform cron.unschedule('ig-publish-minute') where exists (select 1 from cron.job where jobname = 'ig-publish-minute');
  perform cron.schedule('ig-publish-minute', '* * * * *', format($cmd$
    select net.http_post(
      url := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-publish',
      headers := jsonb_build_object('Authorization', 'Bearer %s', 'Content-Type', 'application/json'),
      body := '{"mode":"due"}'::jsonb,
      timeout_milliseconds := 150000
    )
    where exists (
      select 1 from public.ig_planned
       where (status = 'programme' and scheduled_at <= now())
          or (status = 'en_cours' and (lock_until is null or lock_until < now()))
    );
  $cmd$, v_secret));
end $do$;
select jobname, schedule, active from cron.job where jobname like 'ig-%' order by jobname;
