-- ════════════════════════════════════════════════════════════════════════════
-- TTP Suite · Media kit toujours en objet (2026-11-27)
-- La fiche d'Anthony Gharbi, créée le 20/11 par Claude (outil creer_element du connecteur),
-- avait son media kit rangé en texte : une chaîne qui contient du JSON, au lieu d'un objet.
-- Le générateur des media kits du site (websitettpcreators) plantait sur lui, et le
-- créateur suivant (Adelina Krasnici) n'était plus généré : pages introuvables.
--   1. Remet en objet tout media kit rangé en texte, quand ce texte est un objet JSON
--      valide (même contenu, même slug).
--   2. Ajoute une contrainte : un media kit est un objet (ou vide), jamais du texte.
-- Le connecteur relit déjà en JSON le texte qu'on lui envoie (_shared/mcpAdmin.ts,
-- writableFields). Depuis le SQL Editor, les déclencheurs de creators ne font rien (pas
-- d'utilisateur connecté) : ni journal d'activité, ni notification.
-- Si l'ajout de la contrainte échoue, un media kit en texte n'a pas pu être relu : la
-- requête de contrôle le compte. Relançable sans risque.
-- ════════════════════════════════════════════════════════════════════════════
update public.creators
   set mediakit = (mediakit #>> '{}')::jsonb
 where jsonb_typeof(mediakit) = 'string'
   and case when pg_input_is_valid(mediakit #>> '{}', 'jsonb')
            then jsonb_typeof((mediakit #>> '{}')::jsonb) = 'object'
            else false end;

alter table public.creators drop constraint if exists creators_mediakit_objet;
alter table public.creators
  add constraint creators_mediakit_objet
  check (mediakit is null or jsonb_typeof(mediakit) in ('object', 'null'));

-- Contrôle : kits_pas_en_objet = 0 · contrainte_1 = 1 attendus.
select
  (select count(*) from public.creators where jsonb_typeof(mediakit) not in ('object', 'null')) as kits_pas_en_objet,
  (select count(*) from pg_constraint where conrelid = 'public.creators'::regclass and conname = 'creators_mediakit_objet') as contrainte_1;
