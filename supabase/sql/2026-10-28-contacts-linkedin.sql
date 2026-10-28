-- ============================================================================
-- Contacts : profil LinkedIn de la personne (rempli par « Trouver des contacts »,
-- FullEnrich), affiché dans la fiche. À lancer une fois dans Supabase › SQL Editor.
-- ============================================================================
alter table public.contacts add column if not exists linkedin text;

-- Vérification : doit afficher « linkedin ».
select column_name from information_schema.columns where table_name = 'contacts' and column_name = 'linkedin';
