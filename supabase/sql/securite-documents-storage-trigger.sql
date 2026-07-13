-- 🔒 Sécurité · handle_new_user + storage documents (durci)
-- Rôle forcé à 'creator' à l'inscription (anti-escalade) + cloisonnement du
-- bucket Storage `documents` : agence = tout, créateur = uniquement ses fichiers.
-- ⚠️ creator_name TOUJOURS NULL (zéro confiance aux métadonnées client — sinon
-- usurpation d'une créatrice via signup public). Le rattachement se fait UNIQUEMENT
-- côté serveur par create-access (admin). Cf. sql/securite-signup-creator-name.sql.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (user_id, role, creator_name)
  values (new.id, 'creator', null)
  on conflict (user_id) do nothing;
  return new;
end $$;

drop policy if exists documents_obj_auth on storage.objects;
drop policy if exists documents_obj_agency on storage.objects;
drop policy if exists documents_obj_creator_read on storage.objects;
create policy documents_obj_agency on storage.objects for all to authenticated
  using (bucket_id = 'documents' and public.is_agency())
  with check (bucket_id = 'documents' and public.is_agency());
create policy documents_obj_creator_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and exists (
    select 1 from public.documents d
     where d.path = storage.objects.name and d.creator = public.my_creator()));
