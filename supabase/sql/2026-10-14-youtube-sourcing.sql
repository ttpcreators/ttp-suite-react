-- ============================================================================
-- YouTube · Sourcing (page Sourcing → Trouver des créatrices → YouTube)
-- Titre Supabase : « YouTube · yt_channels + yt_quota »
-- ============================================================================
-- yt_channels : chaînes YouTube lues par la fonction yt-sourcing (chiffres,
--   email et marques de la description), gardées 7 jours pour économiser le quota.
-- yt_quota    : unités YouTube consommées par jour (10 000 offertes par Google).
-- Lecture agence, écriture serveur seulement. Rien de visible par les créatrices.
-- ============================================================================
create table if not exists public.yt_channels (
  id   text primary key,               -- id de chaîne (UC…)
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
select 'YouTube prêt' as etat;
