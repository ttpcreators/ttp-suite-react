-- ============================================================================
-- TTP Suite — Notifications push (résumé matinal)
-- À exécuter UNE FOIS dans l'éditeur SQL Supabase (projet en cours).
-- ============================================================================

-- 1) Table des abonnements push (un par appareil) ---------------------------
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  endpoint   text not null unique,          -- identifiant unique de l'appareil
  p256dh     text not null,                 -- clé publique du navigateur
  auth       text not null,                 -- secret d'auth du navigateur
  user_id    uuid references auth.users(id) on delete set null,
  ua         text,
  created_at timestamptz default now()
);

alter table public.push_subscriptions enable row level security;

-- L'utilisateur authentifié gère son abonnement depuis l'app.
-- (L'envoi côté serveur utilise la clé service_role et ignore la RLS.)
drop policy if exists push_sub_ins on public.push_subscriptions;
drop policy if exists push_sub_upd on public.push_subscriptions;
drop policy if exists push_sub_del on public.push_subscriptions;
drop policy if exists push_sub_sel on public.push_subscriptions;
create policy push_sub_ins on public.push_subscriptions for insert to authenticated with check (true);
create policy push_sub_upd on public.push_subscriptions for update to authenticated using (true) with check (true);
create policy push_sub_del on public.push_subscriptions for delete to authenticated using (true);
create policy push_sub_sel on public.push_subscriptions for select to authenticated using (true);


-- 2) Planification quotidienne (pg_cron + pg_net) ---------------------------
-- Remplace <PROJECT_REF> par la référence de TON projet Supabase actuel
-- (Dashboard → Settings → General → Reference ID) et <CRON_SECRET> par la
-- valeur déjà utilisée pour google-sync.
--
-- Heure : '30 6 * * *' = 06h30 UTC ≈ 8h30 à Paris (été) / 7h30 (hiver).
-- Ajuste le premier nombre si tu veux une autre heure.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- (relancer cette commande remplace la planification existante du même nom)
select cron.unschedule('ttp-daily-digest')
where exists (select 1 from cron.job where jobname = 'ttp-daily-digest');

select cron.schedule(
  'ttp-daily-digest',
  '30 6 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/daily-digest',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <CRON_SECRET>',
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Vérifier :   select * from cron.job where jobname = 'ttp-daily-digest';
-- Désactiver : select cron.unschedule('ttp-daily-digest');
