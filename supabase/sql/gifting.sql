-- ============================================================================
-- GIFTING — suivi des cadeaux / dotations produits reçus par les créateurs
-- ============================================================================
-- Une marque envoie un produit (gifting) à un créateur, avec ou sans attente de
-- contenu en retour. On veut : tracer la provenance (email de l'interlocuteur),
-- savoir si du contenu est attendu, noter des infos, et rappeler au créateur les
-- MENTIONS obligatoires (« Produit offert » / « Cadeau », loi n° 2023-451).
--
-- Visibilité : page vue AUSSI par le créateur. Motif `briefs` (données par créateur) :
--   lecture ET écriture = is_agency() OR creator = my_creator().
-- → l'agence gère tout ; le créateur voit et gère UNIQUEMENT ses propres cadeaux
--   (il peut en signaler un, marquer « contenu publié »…). RLS force creator = son nom
--   à l'insert, donc pas d'écriture pour le compte d'un autre.
--
-- Idempotent : rejouable sans risque.
-- ============================================================================

create table if not exists public.gifting (
  id uuid primary key default gen_random_uuid(),
  creator text,                                 -- créateur concerné (= my_creator())
  brand text,                                   -- marque / expéditeur
  product text,                                 -- description du cadeau
  value text,                                   -- valeur estimée (libre : « ≈ 120 € »)
  contact_name text,                            -- interlocuteur côté marque
  contact_email text,                           -- email interlocuteur (traçabilité)
  received_on date,                             -- date de réception
  content_expected boolean default false,       -- la marque attend-elle du contenu ?
  deliverables text,                            -- si oui : quoi
  status text default 'recu',                   -- recu | attente | publie | refuse | clos
  mentions text,                                -- mentions à rappeler au créateur
  note text,                                    -- infos libres
  source text default 'agency',                 -- agency | creator (qui a créé la ligne)
  sort_order int default 0,
  created_at timestamptz default now()
);

create index if not exists gifting_creator_idx on public.gifting (creator);
create index if not exists gifting_sort_idx    on public.gifting (sort_order);

-- RLS : données par créateur (motif briefs/todos/ideas).
alter table public.gifting enable row level security;
drop policy if exists gifting_scoped on public.gifting;
create policy gifting_scoped on public.gifting for all to authenticated
  using (public.is_agency() or creator = public.my_creator())
  with check (public.is_agency() or creator = public.my_creator());
