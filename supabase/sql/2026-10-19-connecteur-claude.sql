-- ============================================================================
-- 2026-10-19 · Connecteur Claude : TTP Suite branché sur le compte Claude (ordinateur
-- et téléphone). Connexion OAuth 2.1 (PKCE) avec le compte TTP Suite, jetons courts et
-- révocables, journal de chaque outil utilisé. Fonction : ttp-mcp.
--   mcp_clients : applications enregistrées (Claude s'enregistre tout seul)
--   mcp_grants  : une connexion = un accès accordé par un compte (révocable dans Paramètres)
--   mcp_codes   : codes d'autorisation (10 min, usage unique)
--   mcp_tokens  : jetons d'accès (1 h) et de renouvellement (60 j), stockés hachés
--   mcp_log     : ce que Claude a consulté ou fait, par qui, quand
-- Seule la fonction (clé serveur) lit / écrit les clients, codes et jetons. Chaque compte
-- voit ses propres connexions et son journal, et peut couper une connexion.
-- Sans risque à relancer.
-- ============================================================================
create table if not exists public.mcp_clients (
  client_id     text primary key,
  client_name   text,
  redirect_uris text[] not null,
  secret_hash   text,            -- null = client public (PKCE seul)
  created_at    timestamptz not null default now()
);

create table if not exists public.mcp_grants (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  client_id    text references public.mcp_clients(client_id) on delete set null,
  client_name  text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists mcp_grants_user_idx on public.mcp_grants (user_id, created_at desc);

create table if not exists public.mcp_codes (
  code_hash      text primary key,
  grant_id       uuid not null references public.mcp_grants(id) on delete cascade,
  client_id      text not null references public.mcp_clients(client_id) on delete cascade,
  redirect_uri   text not null,
  code_challenge text not null,
  expires_at     timestamptz not null,
  used_at        timestamptz
);

create table if not exists public.mcp_tokens (
  token_hash text primary key,
  kind       text not null check (kind in ('access', 'refresh')),
  grant_id   uuid not null references public.mcp_grants(id) on delete cascade,
  client_id  text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mcp_tokens_grant_idx on public.mcp_tokens (grant_id);

create table if not exists public.mcp_log (
  id       bigserial primary key,
  user_id  uuid references auth.users(id) on delete cascade,
  grant_id uuid references public.mcp_grants(id) on delete set null,
  tool     text not null,
  summary  text,
  ok       boolean not null default true,
  at       timestamptz not null default now()
);
create index if not exists mcp_log_user_idx on public.mcp_log (user_id, at desc);

alter table public.mcp_clients enable row level security;
alter table public.mcp_grants  enable row level security;
alter table public.mcp_codes   enable row level security;
alter table public.mcp_tokens  enable row level security;
alter table public.mcp_log     enable row level security;
revoke all on public.mcp_clients, public.mcp_codes, public.mcp_tokens from anon, authenticated;
revoke all on public.mcp_grants, public.mcp_log from anon;

-- Chaque compte voit ses connexions et peut les couper (revoked_at) ; il lit son journal.
drop policy if exists mcp_grants_own_read on public.mcp_grants;
create policy mcp_grants_own_read on public.mcp_grants for select to authenticated
  using (user_id = auth.uid());
drop policy if exists mcp_grants_own_revoke on public.mcp_grants;
create policy mcp_grants_own_revoke on public.mcp_grants for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert, delete on public.mcp_grants from authenticated;
revoke update on public.mcp_grants from authenticated;
grant select on public.mcp_grants to authenticated;
grant update (revoked_at) on public.mcp_grants to authenticated;
drop policy if exists mcp_log_own_read on public.mcp_log;
create policy mcp_log_own_read on public.mcp_log for select to authenticated
  using (user_id = auth.uid());
revoke insert, update, delete on public.mcp_log from authenticated;
grant select on public.mcp_log to authenticated;

-- Vérification : les 5 tables avec « RLS : true ».
select relname as table_name, 'RLS : ' || relrowsecurity as securite
  from pg_class where relname in ('mcp_clients', 'mcp_grants', 'mcp_codes', 'mcp_tokens', 'mcp_log')
 order by relname;
