-- ============================================================================
-- securite-avatars-storage.sql
-- ----------------------------------------------------------------------------
-- Durcissement du bucket public `avatars` (photos de profil).
--
-- AVANT : une seule policy `for all to authenticated using (bucket_id='avatars')`
--   → n'importe quel compte connecté (donc n'importe quel CRÉATEUR) pouvait
--   SUPPRIMER ou REMPLACER l'avatar de tout le monde (agence comprise).
--
-- APRÈS :
--   • Lecture   : publique (le bucket est public), aucune policy requise.
--   • Upload    : tout compte connecté peut poser un avatar. Les chemins sont
--                 horodatés (`slug/<timestamp>.ext`) → jamais de collision,
--                 toujours un INSERT neuf (l'app n'écrase jamais un chemin).
--   • Update/Delete : réservés à l'AGENCE (public.is_agency()).
--
-- À exécuter une fois sur la base live (SQL Editor Supabase).
-- ============================================================================

drop policy if exists avatars_obj_rw     on storage.objects;
drop policy if exists avatars_obj_insert on storage.objects;
drop policy if exists avatars_obj_update on storage.objects;
drop policy if exists avatars_obj_delete on storage.objects;

create policy avatars_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars');

create policy avatars_obj_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and public.is_agency())
  with check (bucket_id = 'avatars' and public.is_agency());

create policy avatars_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and public.is_agency());
