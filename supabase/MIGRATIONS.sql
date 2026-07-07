-- ============================================================================
-- TTP Suite — SQL À LANCER À LA MAIN (migrations manuelles)
-- ----------------------------------------------------------------------------
-- Référence UNIQUE et organisée de tous les blocs SQL exécutés dans le SQL
-- Editor de Supabase (hors schéma complet, qui vit dans SETUP.sql).
-- Chaque bloc est idempotent (relançable sans erreur). Coche au fur et à mesure.
-- Projet : zizvggziggswhrbuyhuo
-- ============================================================================


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 1) FACTURES — écriture réservée à l'agence                    [✓ APPLIQUÉ] │
-- └──────────────────────────────────────────────────────────────────────────┘
-- Un créateur ne peut plus modifier/insérer/supprimer ses propres factures
-- (il ne peut que LIRE les siennes). Corrige une faille RLS.
drop policy if exists invoices_agency       on public.invoices;
drop policy if exists invoices_creator_read on public.invoices;
create policy invoices_agency       on public.invoices for all    to authenticated
  using (public.is_agency()) with check (public.is_agency());
create policy invoices_creator_read on public.invoices for select to authenticated
  using (public.is_agency() or creator = public.my_creator());


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 2) ÉVÈNEMENTS — colonne `source`                              [✓ APPLIQUÉ] │
-- └──────────────────────────────────────────────────────────────────────────┘
-- Permet à la cloche de signaler un évènement ajouté par un créateur.
alter table public.events add column if not exists source text default 'agency';


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 3) OUTIL EMAIL — tables (séquences, inscriptions, journal)    [✓ APPLIQUÉ] │
-- └──────────────────────────────────────────────────────────────────────────┘
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
create index if not exists seq_enroll_due_idx        on public.sequence_enrollments (status, next_due_at);
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


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 4) TÂCHES (À FAIRE) — colonne `status`                        [✓ APPLIQUÉ] │
-- └──────────────────────────────────────────────────────────────────────────┘
-- Active le sélecteur de statut (À faire / En cours / Fait) dans la page À faire.
alter table public.todos add column if not exists status text default 'À faire';
update public.todos set status = case when done then 'Fait' else 'À faire' end where status is null;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 5) ALERTES EMAIL — cron gmail-poll (toutes les 5 min)         [✓ APPLIQUÉ] │
-- └──────────────────────────────────────────────────────────────────────────┘
-- Vérifie la boîte agence et alerte (cloche + push) sur les nouveaux mails.
create extension if not exists pg_cron;
create extension if not exists pg_net;
-- (relancer ce bloc écrase proprement l'ancienne planification)
select cron.unschedule('gmail-poll-5min') where exists (select 1 from cron.job where jobname = 'gmail-poll-5min');
select cron.schedule(
  'gmail-poll-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/gmail-poll',
    headers := jsonb_build_object(
      'Authorization','Bearer nq66DO+Bw8X7g6e2xu5jpAMrQuV45ixarQll2O7z9bBEMqBb0oTpCKB3v7KOo33r.',
      'Content-Type','application/json'),
    body := '{}'::jsonb
  );
  $$
);


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ DIAGNOSTIC — vérifier les crons                                           │
-- └──────────────────────────────────────────────────────────────────────────┘
-- select jobid, jobname, schedule, active from cron.job order by jobid;
-- select status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;
