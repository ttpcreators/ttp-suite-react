-- ════════════════════════════════════════════════════════════════════════════
-- Pastilles « pas encore vu » (2026-10-06) : pour chaque compte, la dernière
-- visite de chaque page du menu. Le chiffre d'une page = ce que les autres
-- (équipe, créateurs) y ont fait depuis cette visite. Synchronise ordinateur et
-- téléphone (sans ce SQL, l'app retient la visite sur chaque appareil séparément).
-- RLS : chacun ne lit et n'écrit QUE ses propres lignes.
-- Idempotent : peut être relancé sans risque. À lancer dans le SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.nav_seen (
  user_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  page     text not null check (char_length(page) between 1 and 40),
  seen_at  timestamptz not null default now(),
  primary key (user_id, page)
);
alter table public.nav_seen enable row level security;
drop policy if exists nav_seen_own on public.nav_seen;
create policy nav_seen_own on public.nav_seen for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.nav_seen from anon;
grant select, insert, update on public.nav_seen to authenticated;
