-- ============================================================================
-- 2026-11-28 · Stockage : types de fichiers et dossiers des dépôts
-- ----------------------------------------------------------------------------
-- QUOI
-- 1. Bucket privé « documents » : liste des types acceptés (PDF, photos, vidéos, sons,
--    Office, OpenDocument, iWork, texte, CSV, HTML des contrats, archives, fichier sans
--    type). Plus d'images SVG, de XHTML ni de XML. 25 Mo par fichier, comme avant.
-- 2. Dépôt d'un créateur dans « documents » (documents_obj_creator_insert) : toujours dans
--    son dossier creator-uploads/<id du compte>/, et seulement avec une extension de la
--    liste (pdf, photos, vidéos, sons, Office, OpenDocument, iWork, csv, txt, rtf, zip).
-- 3. Suppression par un créateur (documents_obj_creator_own_delete) : toujours dans son
--    dossier, mais plus un fichier rattaché à une fiche documents (facture, stats,
--    contenu…) ni la capture d'un post de collab (collab_posts.capture_path). Ses pièces
--    jointes de tâche et les fichiers sans fiche (envoi interrompu) restent supprimables.
-- 4. Bucket public « avatars » (avatars_obj_insert) : extension d'image seulement pour
--    tous ; pour un compte qui n'est pas de l'agence, dossier creators/<id du compte>/.
--    L'app range déjà les photos à cet endroit (avatar-upload, image-field).
--
-- POURQUOI
-- Audit « 14 attaques » du 28/11, correction 9 : un fichier déposé ne doit être ni lu
-- comme une page par le navigateur, ni rangé hors du dossier de son compte, ni remplacé en
-- silence une fois rattaché à une fiche.
--
-- ORDRE
-- Indépendant de la fusion : l'app marche avant et après ce SQL. Les photos déposées avant
-- restent où elles sont (lecture publique inchangée).
--
-- CONTRÔLE
-- La requête à la fin : attendu « true · 0 · true · true · true ».
-- Puis le relevé des types (dernière requête) : aucun type utile ne doit manquer dans la
-- liste du bucket. Essayer ensuite avec un compte de test ZZZ seulement : dépôt d'une facture
-- PDF et d'une photo de profil.
--
-- Relançable sans risque (update, drop policy if exists puis create policy).
-- À reporter dans SETUP.sql (sections 6 et 7) après application.
-- ============================================================================

-- 1. Bucket documents : types acceptés ------------------------------------------------
update storage.buckets
   set allowed_mime_types = array[
         'application/pdf',
         'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif',
         'video/*', 'audio/*',
         'text/plain', 'text/csv', 'text/html', 'text/markdown', 'text/rtf', 'text/calendar',
         'application/rtf', 'application/json',
         'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation',
         'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet',
         'application/vnd.oasis.opendocument.presentation',
         'application/vnd.apple.keynote', 'application/vnd.apple.pages', 'application/vnd.apple.numbers',
         'application/x-iwork-keynote-sffkey', 'application/x-iwork-pages-sffpages', 'application/x-iwork-numbers-sffnumbers',
         'application/zip', 'application/x-zip-compressed',
         'application/octet-stream'
       ],
       file_size_limit = 26214400
 where id = 'documents';

-- 2. Dépôt d'un créateur dans documents ------------------------------------------------
drop policy if exists documents_obj_creator_insert on storage.objects;
create policy documents_obj_creator_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and name like 'creator-uploads/' || auth.uid()::text || '/%'
    and lower(coalesce(storage.extension(name), '')) = any (array[
      'pdf',
      'jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'avif', 'heic', 'heif',
      'mp4', 'mov', 'm4v', 'webm', 'mp3', 'm4a', 'wav', 'aac',
      'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'key', 'pages', 'numbers',
      'csv', 'txt', 'rtf', 'zip'
    ])
  );

-- 3. Suppression par un créateur ---------------------------------------------------------
drop policy if exists documents_obj_creator_own_delete on storage.objects;
create policy documents_obj_creator_own_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'documents'
    and name like 'creator-uploads/' || auth.uid()::text || '/%'
    and not exists (select 1 from public.documents d where d.path = storage.objects.name)
    and not exists (select 1 from public.collab_posts p where p.capture_path = storage.objects.name)
  );

-- 4. Bucket avatars : images seulement, dossier du compte pour un créateur ------------------
drop policy if exists avatars_obj_insert on storage.objects;
create policy avatars_obj_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and lower(coalesce(storage.extension(name), '')) = any (array['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'avif', 'heic', 'heif'])
    and (public.is_agency() or name like 'creators/' || auth.uid()::text || '/%')
  );

-- Contrôle (une ligne) : attendu « true · 0 · true · true · true »
select
  (select allowed_mime_types is not null from storage.buckets where id = 'documents')            as documents_types_ok,
  (select count(*) from storage.buckets b, unnest(b.allowed_mime_types) t
    where b.id = 'documents' and (t like '%svg%' or t like '%xml%'))                             as types_dangereux,
  exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and policyname = 'documents_obj_creator_insert' and with_check like '%extension%')    as depot_createur_ok,
  exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and policyname = 'documents_obj_creator_own_delete' and qual like '%collab_posts%')   as suppression_ok,
  exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and policyname = 'avatars_obj_insert' and with_check like '%creators/%')              as avatars_ok;

-- Relevé des types déjà stockés (lecture seule) : chaque type de documents doit être couvert
-- par la liste ci-dessus (« image/* » n'y est pas exprès, pour garder le SVG dehors).
select bucket_id, metadata->>'mimetype' as type, count(*)
  from storage.objects
 where bucket_id in ('documents', 'avatars')
 group by 1, 2
 order by 1, 3 desc;
