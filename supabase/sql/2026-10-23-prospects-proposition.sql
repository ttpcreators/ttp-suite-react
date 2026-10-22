-- ════════════════════════════════════════════════════════════════════════════
-- Titre Supabase : « Prospects · proposition de Tarifs et lien collab / contact »
-- 2026-10-23 · Tarifs → prospect → collab. « Proposer » (Tarifs) enregistre le prix
-- calculé sur un prospect : créateur, livrables et détail de la proposition (fourchette,
-- prix cible). « Transformer en collab » (Prospection) crée la collab et la relie au
-- prospect. Un prospect peut aussi être relié à la fiche contact de la marque.
--
-- Sécurité : `prospects` reste réservé à l'agence (policy prospects_agency inchangée) ;
-- les nouvelles colonnes ne donnent accès à rien d'autre.
-- Relançable sans risque. L'app marche avant ce SQL (la proposition tient alors dans
-- la colonne `value`, « 800 – 1 100 € HT »).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.prospects add column if not exists creator      text;
alter table public.prospects add column if not exists deliverables text;
alter table public.prospects add column if not exists proposal     jsonb;
alter table public.prospects add column if not exists contact_id   uuid references public.contacts(id) on delete set null;
alter table public.prospects add column if not exists collab_id    uuid references public.collabs(id) on delete set null;
create index if not exists prospects_contact_idx on public.prospects (contact_id);
create index if not exists prospects_collab_idx  on public.prospects (collab_id);

-- Contrôle : les 5 colonnes existent (attendu : 5).
select count(*) as colonnes_prospects
  from information_schema.columns
 where table_schema = 'public' and table_name = 'prospects'
   and column_name in ('creator', 'deliverables', 'proposal', 'contact_id', 'collab_id');
