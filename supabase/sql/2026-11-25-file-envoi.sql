-- TITRE : TTP Suite · File d'envoi des mails de prospection et liste « ne plus contacter » (2026-11-25)
-- ============================================================================
-- Audit du 24/11/2026, points M16 à M20 (code : supabase/functions/ttp-mcp/envois.ts,
-- règles : supabase/functions/_shared/fileEnvoi.ts).
--   envoi_file        : les brouillons validés par Gianni, chacun avec son heure d'envoi
--                       (outil programmer_envoi) ; une tâche planifiée en envoie au plus un
--                       par minute et par boîte, en semaine de 8 h 30 à 18 h 30 ;
--   ne_plus_contacter : refus, demandes d'arrêt, rebonds (adresse ou domaine) ;
--   email_activity    : index pour retrouver vite les mails envoyés (anti-doublon 30 jours).
-- Tâche planifiée « envoi-file-minute » : copie de l'appel de gmail-poll-5min (même secret,
-- jamais écrit dans ce fichier), vers ttp-mcp/file-envoi.
-- Rien ne change pour les données existantes. Peut être relancé sans risque.
-- ============================================================================

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

-- Tâche planifiée : chaque minute, ttp-mcp/file-envoi (même en-tête que gmail-poll-5min).
do $$
declare
  modele text;
begin
  select command into modele from cron.job where jobname = 'gmail-poll-5min';
  if modele is null or position('/functions/v1/gmail-poll' in modele) = 0 then
    raise exception 'Tâche gmail-poll-5min introuvable : créer envoi-file-minute à la main (appel POST de ttp-mcp/file-envoi avec <CRON_SECRET>).';
  end if;
  if exists (select 1 from cron.job where jobname = 'envoi-file-minute') then
    perform cron.unschedule('envoi-file-minute');
  end if;
  perform cron.schedule('envoi-file-minute', '* * * * *', replace(modele, '/functions/v1/gmail-poll', '/functions/v1/ttp-mcp/file-envoi'));
end $$;

notify pgrst, 'reload schema';

-- Contrôle : 2 · 1 · 1
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('envoi_file', 'ne_plus_contacter')) as tables_2,
  (select count(*) from cron.job where jobname = 'envoi-file-minute' and command like '%/functions/v1/ttp-mcp/file-envoi%') as tache_1,
  (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'email_activity_sortants_idx') as index_1;
