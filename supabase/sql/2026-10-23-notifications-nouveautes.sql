-- ════════════════════════════════════════════════════════════════════════════
-- Titre Supabase : « Nouveautés · repères « nouveau » agence ↔ créateur »
-- 2026-10-23 · Quand l'AGENCE écrit sur un objet partagé avec un créateur (tâche :
-- texte, description, sous-tâche, point d'avancement ; idée ; brief ; remarque ou statut
-- d'un mail), LE CRÉATEUR reçoit un repère « nouveau » ; quand le CRÉATEUR écrit,
-- L'AGENCE le reçoit. Les repères sont écrits ICI, par des déclencheurs, donc rien ne
-- se perd (même si l'écriture vient d'un autre écran ou du connecteur Claude connecté
-- avec un compte). L'app les lit dans `activity_events` et les efface à l'ouverture.
-- Le push sur téléphone, lui, part de l'app (daily-digest, déjà en place).
--
-- Sécurité :
--   • lecture : un créateur ne lit QUE les repères qui lui sont destinés
--     (target = 'creator' et creator = my_creator()) ; l'agence lit les siens
--     (target = 'agency') ;
--   • écriture : AUCUNE insertion ni suppression depuis l'app ; seule la colonne
--     `read_at` se met à jour (marquer lu), sur ses propres repères ;
--   • les déclencheurs n'empêchent jamais l'écriture d'origine (toute erreur est avalée) ;
--   • aucune écriture sans compte connecté (crons, fonctions serveur) : pas de repère.
-- Regroupement : un même objet, même type de changement, pas encore lu, modifié il y
-- a moins de 10 minutes → la ligne existante est mise à jour (compteur + extrait), pas
-- de nouvelle ligne.
-- Relançable sans risque. L'app marche avant ce SQL (aucun repère, aucune erreur).
-- ════════════════════════════════════════════════════════════════════════════

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
drop policy if exists activity_events_read on public.activity_events;
create policy activity_events_read on public.activity_events for select to authenticated
  using ((target = 'creator' and creator = public.my_creator()) or (target = 'agency' and public.is_agency()));
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
create or replace function public.todos_activity() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor text; who text; j jsonb; o jsonb; names text[]; nm text; sub text; title text;
  changes text[][] := '{}';
  i int;
begin
  begin
    actor := public.activity_actor();
    if actor is null then return new; end if;
    who := public.activity_actor_name();
    j := to_jsonb(new);
    o := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
    title := left(coalesce(j->>'text', ''), 120);
    -- Créateurs de la tâche (liste `creators`, sinon `creator`).
    select coalesce(array_agg(btrim(x)) filter (where btrim(x) <> ''), '{}') into names
      from jsonb_array_elements_text(case when jsonb_typeof(j->'creators') = 'array' and jsonb_array_length(j->'creators') > 0
                                          then j->'creators' else jsonb_build_array(coalesce(j->>'creator', '')) end) x;
    if coalesce(array_length(names, 1), 0) = 0 then return new; end if;

    if tg_op = 'INSERT' then
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
        -- Un créateur : seulement sur une tâche partagée avec lui (la RLS l'assure déjà).
        perform public.log_activity_event('agency', public.my_creator(), 'todo', new.id::text, title, changes[i][1], who, changes[i][2]);
      end if;
    end loop;
  exception when others then
    null; -- jamais bloquant
  end;
  return new;
end $$;
drop trigger if exists todos_activity on public.todos;
create trigger todos_activity after insert or update on public.todos
  for each row execute function public.todos_activity();

-- ── Idées ────────────────────────────────────────────────────────────────────
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
    if nm = '' then return new; end if; -- idée générale de l'agence : personne à prévenir
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
      -- Ce que le créateur lit : consignes, livrables, échéance, résumé, PDF.
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

create or replace function public.mail_threads_activity() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    -- Statut posé par l'agence (création de la ligne par upsert, ou changement).
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

-- Contrôle : table, 5 déclencheurs, aucune ligne lisible sans compte.
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'activity_events') as table_ok,         -- attendu : 1
  (select count(*) from pg_trigger where tgname in ('todos_activity', 'ideas_activity', 'briefs_activity',
     'creator_mail_notes_activity', 'creator_mail_threads_activity') and not tgisinternal) as declencheurs;                             -- attendu : 5
