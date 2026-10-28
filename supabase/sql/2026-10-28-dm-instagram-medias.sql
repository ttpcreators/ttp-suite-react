-- ============================================================================
-- DM Instagram : photos, vidéos, vocaux et partages visibles dans l'app.
-- Meta ne met pas ces contenus dans le texte du message ; ig-inbox les lit à part
-- et recopie les fichiers (leurs adresses Meta expirent) dans un bucket PRIVÉ.
-- À lancer une fois dans Supabase › SQL Editor. Sans risque si relancé.
-- ============================================================================

-- 1. Contenus d'un message : [{ kind, path?, src?, link?, name? }]
alter table public.ig_messages add column if not exists media jsonb;

-- 2. Fichiers : bucket privé, lisible par l'agence seulement (liens signés d'une heure).
insert into storage.buckets (id, name, public)
  values ('ig-media', 'ig-media', false)
  on conflict (id) do update set public = false;
drop policy if exists ig_media_agency_read on storage.objects;
create policy ig_media_agency_read on storage.objects for select to authenticated
  using (bucket_id = 'ig-media' and public.is_agency());

-- Vérification : doit afficher « media » puis « ig-media | false ».
select column_name from information_schema.columns where table_name = 'ig_messages' and column_name = 'media';
select id, public from storage.buckets where id = 'ig-media';
