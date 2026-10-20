-- ============================================================================
-- 2026-10-21 : langue de l'espace créateur (« fr » par défaut, « en » pour un
-- créateur anglophone). Le créateur la change dans « Mes infos », l'agence sur sa
-- fiche. L'espace agence reste en français. Déjà foldé dans SETUP.sql.
-- Peut être relancé sans risque.
-- ============================================================================
alter table public.creators add column if not exists lang text not null default 'fr';
alter table public.creators drop constraint if exists creators_lang_check;
alter table public.creators add constraint creators_lang_check check (lang in ('fr', 'en'));

-- Contrôle : doit afficher « lang · fr ».
select column_name, column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'creators' and column_name = 'lang';
