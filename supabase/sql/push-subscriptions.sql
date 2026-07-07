-- Push · table push_subscriptions — abonnements aux notifications push (Web Push)
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_id    uuid references auth.users(id) on delete set null,
  ua         text,
  created_at timestamptz default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_sub_ins on public.push_subscriptions;
drop policy if exists push_sub_upd on public.push_subscriptions;
drop policy if exists push_sub_del on public.push_subscriptions;
drop policy if exists push_sub_sel on public.push_subscriptions;
create policy push_sub_ins on public.push_subscriptions for insert to authenticated with check (true);
create policy push_sub_upd on public.push_subscriptions for update to authenticated using (true) with check (true);
create policy push_sub_del on public.push_subscriptions for delete to authenticated using (true);
create policy push_sub_sel on public.push_subscriptions for select to authenticated using (true);
