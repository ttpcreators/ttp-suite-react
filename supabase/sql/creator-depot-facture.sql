-- ============================================================================
-- DÉPÔT DE FACTURE PAR LE CRÉATEUR (« si jamais l'agence oublie »)
-- ============================================================================
-- Besoin : un créateur doit pouvoir DÉPOSER sa facture (fichier) pour que l'agence
-- ne l'oublie pas. Il NE doit PAS pour autant pouvoir écrire dans `invoices`
-- (falsifier le CA, effacer une facture en retard) — cette protection reste intacte.
-- Le fichier déposé atterrit dans `documents` (type 'facture') ; l'agence le voit,
-- le valide, et crée elle-même la facture officielle.
--
-- ⚠️ PIÈGE DE SÉCURITÉ (raison pour laquelle l'INSERT créateur était fermé) :
-- si le créateur peut insérer une ligne `documents` avec creator = lui mais un
-- `path` QUELCONQUE, il forge une ligne pointant vers le fichier d'un AUTRE
-- créateur — et `documents_obj_creator_read` (qui joint sur le path) lui signerait
-- alors ce fichier. Fuite inter-créateurs.
-- ⇒ On contraint donc le chemin à SON dossier, identifié par son `auth.uid()`
--   (non falsifiable côté client) : `creator-uploads/<uid>/…`.
--
-- Le créateur reste sans UPDATE ni DELETE sur `documents` : il ne peut pas effacer
-- ce qu'il a déposé (traçabilité), seule l'agence le peut.
--
-- Idempotent : rejouable sans risque.
-- ============================================================================

-- 1) Ligne `documents` : insertion autorisée seulement pour SOI et dans SON dossier.
drop policy if exists documents_creator_insert on public.documents;
create policy documents_creator_insert on public.documents for insert to authenticated
  with check (
    creator = public.my_creator()
    and path like 'creator-uploads/' || auth.uid()::text || '/%'
  );

-- 2) Binaire dans le bucket privé `documents` : même contrainte de dossier.
drop policy if exists documents_obj_creator_insert on storage.objects;
create policy documents_obj_creator_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and name like 'creator-uploads/' || auth.uid()::text || '/%'
  );
