-- ============================================================================
-- 12-contacts-createur.sql
-- ----------------------------------------------------------------------------
-- Contacts PARTAGÉS : un créateur peut ajouter ses propres contacts depuis son
-- espace, et l'agence les voit (avec l'étiquette « ajouté par … »).
--
--   • Colonne contacts.creator : NULL = contact agence ; sinon nom du créateur
--     qui l'a ajouté.
--   • RLS contacts_scoped : agence = tout ; créateur = UNIQUEMENT ses lignes.
--     Un créateur ne voit JAMAIS les contacts de l'agence (creator NULL) ni ceux
--     d'un autre créateur, et ne peut insérer que pour lui-même (with check).
--
-- À exécuter une fois sur la base live (SQL Editor).
-- ============================================================================

-- 1) Colonne d'appartenance.
alter table public.contacts add column if not exists creator text;

-- 2) Remplace la policy « agence seulement » par une policy cloisonnée par créateur
--    (même modèle que todos_scoped / ideas_scoped).
drop policy if exists contacts_agency  on public.contacts;
drop policy if exists contacts_scoped  on public.contacts;

create policy contacts_scoped on public.contacts for all to authenticated
  using       (public.is_agency() or creator = public.my_creator())
  with check  (public.is_agency() or creator = public.my_creator());

-- Vérifier :   select policyname, cmd from pg_policies where tablename = 'contacts';
