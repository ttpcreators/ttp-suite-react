-- ============================================================================
-- 2026-11-28 · Listes pour les marques et Dispos du mois : lues seulement avec leur lien
-- ----------------------------------------------------------------------------
-- QUOI :
--   1. Fonction public.liste_publique(p_slug) : rend la liste publique dont l'adresse est
--      p_slug (une seule ligne au plus, mêmes colonnes que la vue public_creator_lists).
--      SECURITY DEFINER, search_path fixé, exécutable par anon et authenticated.
--   2. La vue public_creator_lists n'est plus lisible directement par anon ni par
--      authenticated : la page ttpcreators.pro/selection/ passe par la fonction.
-- POURQUOI : une liste ne doit s'ouvrir qu'avec son lien (titre + suffixe tiré au hasard).
--   L'app (Base créateurs › Listes), la fonction dispos-du-mois et le connecteur lisent la
--   table creator_lists, jamais la vue : rien ne change pour eux.
-- ORDRE : APRÈS la mise en ligne de la page du site qui appelle /rest/v1/rpc/liste_publique
--   (websitettpcreators, branche securite-listes-par-lien), et 10 minutes de plus (cache du
--   site : max-age=600). Avant ce SQL, cette page relit la vue comme avant.
-- RELANCE : relançable sans risque. Relancer 2026-11-16-base-createurs.sql,
--   2026-11-22-dispos-du-mois.sql ou SETUP.sql (pas encore foldé) rend la vue lisible à
--   nouveau par anon : relancer ce fichier juste après.
-- Contrôle en fin de fichier.
-- ============================================================================

-- 1) La fonction : une liste par adresse -----------------------------------------------
create or replace function public.liste_publique(p_slug text)
  returns setof public.public_creator_lists
  language sql stable security definer set search_path = public, pg_temp
  rows 1
as $$
  select v.*
    from public.public_creator_lists v
   where p_slug ~ '^[a-z0-9-]{3,60}$'
     and v.slug = p_slug
   limit 1
$$;
revoke all on function public.liste_publique(text) from public;
grant execute on function public.liste_publique(text) to anon, authenticated;

-- 2) Plus de lecture directe de la vue ------------------------------------------------
revoke select on public.public_creator_lists from anon, authenticated;
revoke insert, update, delete, truncate on public.public_creator_lists from anon, authenticated, public;

notify pgrst, 'reload schema';

-- Contrôle : fonction_1 = 1 · definer_true = true · anon_execute_true = true ·
-- anon_vue_false = false · auth_vue_false = false · inconnue_0 = 0.
select
  (select count(*) from pg_proc where oid = 'public.liste_publique(text)'::regprocedure) as fonction_1,
  (select prosecdef from pg_proc where oid = 'public.liste_publique(text)'::regprocedure) as definer_true,
  has_function_privilege('anon', 'public.liste_publique(text)', 'execute') as anon_execute_true,
  has_table_privilege('anon', 'public.public_creator_lists', 'select') as anon_vue_false,
  has_table_privilege('authenticated', 'public.public_creator_lists', 'select') as auth_vue_false,
  (select count(*) from public.liste_publique('adresse-qui-n-existe-pas')) as inconnue_0;
