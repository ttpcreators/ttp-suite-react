-- 1+2 · Factures RLS (agence) + Events source
-- 1) Factures : écriture réservée à l'agence ; le créateur ne peut que LIRE les
--    siennes (avant, il pouvait modifier/supprimer ses factures → falsifier le CA).
drop policy if exists invoices_agency       on public.invoices;
drop policy if exists invoices_creator_read on public.invoices;
create policy invoices_agency       on public.invoices for all    to authenticated
  using (public.is_agency()) with check (public.is_agency());
create policy invoices_creator_read on public.invoices for select to authenticated
  using (public.is_agency() or creator = public.my_creator());

-- 2) Events : colonne source → la cloche peut signaler un évènement ajouté par un créateur.
alter table public.events add column if not exists source text default 'agency';
