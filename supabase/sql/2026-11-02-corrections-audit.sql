-- ============================================================================
-- Corrections de l'audit du 2 novembre (Gianni)
-- Titre Supabase : « Audit 2 nov. · radar TikTok, devis réservés aux fondateurs »
-- ============================================================================
-- 1) Radar à marques (n° 45) : la table du radar TikTok n'avait jamais été créée
--    (2026-10-14-tiktok-radar.sql, partie tables). Le cron viendra avec l'accord de TikTok.
-- 2) Devis : rangés avec l'argent (ligne finance, fondateurs seulement), comme les factures.
-- ============================================================================

create table if not exists public.tt_commercial (
  id         text primary key,
  created    date,
  label      text,
  brands     text[] not null default '{}',
  creator    text,
  video_url  text,
  cover      text,
  country    text not null default 'FR',
  fetched_at timestamptz not null default now()
);
create index if not exists tt_commercial_created_idx on public.tt_commercial (created desc);
create index if not exists tt_commercial_creator_idx on public.tt_commercial (creator);
create table if not exists public.tt_brand_status (
  brand  text primary key,
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

create or replace function public.app_finance_key(p_key text)
returns boolean language sql immutable set search_path to 'public' as $$
  select p_key = any (array['invoiceDetails', 'invoiceBankAccounts', 'invoiceIssuer', 'creatorPayouts', 'creatorCommission', 'comptaSettings', 'collabCashMode', 'quotes']);
$$;
