-- TITRE : TTP Suite · boîtes Gmail des créateurs reliées (2026-11-16)
-- Les boîtes Gmail des créateurs (ex. la boîte pro de Léna) reliées à TTP Suite : Alfred et
-- Claude préparent et envoient (sur le « oui » de Marc) depuis la boîte du créateur.
-- Le créateur se connecte lui même à Google (fonction creator-box-callback).
-- Jetons lus SEULEMENT par le serveur : RLS activée, aucune règle (ni l'app ni un créateur).
-- Relançable sans risque.

create table if not exists public.creator_mail_boxes (
  email         text primary key check (email = lower(email)),
  creator       text not null,
  refresh_token text,
  access_token  text,
  expires_at    timestamptz,
  scope         text,
  connected     boolean not null default false,
  connected_at  timestamptz,
  last_error    text,
  created_at    timestamptz not null default now()
);
alter table public.creator_mail_boxes enable row level security;
revoke all on public.creator_mail_boxes from anon, authenticated;

-- Contrôle : la table existe, RLS active, aucune règle.
select c.relname, c.relrowsecurity as rls,
       (select count(*) from pg_policies p where p.tablename = 'creator_mail_boxes') as regles
from pg_class c where c.relname = 'creator_mail_boxes';
