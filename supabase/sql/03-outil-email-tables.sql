-- 3 · Outil email (tables) — séquences, inscriptions, journal unifié
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
