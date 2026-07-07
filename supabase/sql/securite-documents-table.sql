-- 🔒 Sécurité · table documents (agence-écriture / créateur-lecture)
-- Empêche un créateur de forger une ligne `documents` (pour lire le fichier d'un
-- autre via la policy Storage). Agence = tout ; créateur = lecture seule des siens.
drop policy if exists documents_scoped on public.documents;
create policy documents_agency on public.documents for all to authenticated
  using (public.is_agency()) with check (public.is_agency());
create policy documents_creator_read on public.documents for select to authenticated
  using (public.is_agency() or creator = public.my_creator());
