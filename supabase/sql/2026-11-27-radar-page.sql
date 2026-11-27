-- ============================================================================
-- 2026-11-27 : page Sourcing › Radar, lecture rapide (constat P3)
-- Titre Supabase : « Radar · lecture rapide de la page »
-- ----------------------------------------------------------------------------
-- Le 25/11 et le 26/11, la page Radar a reçu « canceling statement due to statement
-- timeout » (limite de 8 s du rôle authenticated) et a affiché à tort « pas encore
-- activée ». Elle lit les 1 000 marques vues en dernier dans ig_radar (45 000 lignes,
-- 67 Mo). Deux causes, mesurées le 27/11 :
--   1. aucun index sur last_seen : chaque ouverture relit et trie toute la table ;
--   2. la règle de lecture appelle public.is_agency() pour CHAQUE ligne (fonction
--      SECURITY DEFINER, que Postgres ne peut pas intégrer à la requête) : 45 000
--      appels, jusqu'à 4,7 s à eux seuls quand la base est chargée.
-- Correctif :
--   - index (last_seen desc, brand) : tri de la page (la marque en second donne un ordre
--     stable), outil sourcing du connecteur, page Araignée, marques chaudes ;
--   - index (first_seen desc) : marques trouvées depuis le début d'un passage (Araignée) ;
--   - règles écrites avec (select public.is_agency()) : la fonction n'est appelée qu'une
--     fois par requête. Même résultat (elle ne dépend pas de la ligne), mêmes droits.
--     Même écriture pour ig_profiles (17 000 lignes), lue par la même page (comptes
--     « hors agence ») et par « Agences concurrentes ».
-- L'app marche avant et après ce SQL (src/lib/radarLoad.ts lit déjà en deux temps).
-- Création des index : quelques secondes, pendant lesquelles les écritures du radar
-- attendent ; éviter les passages du radar (à :40 des heures paires, UTC).
-- Pas encore reporté dans SETUP.sql (qui crée encore ces règles avec is_agency() seul) :
-- à faire avec la mise à jour de SETUP.sql.
-- Relançable sans risque.
-- ============================================================================

create index if not exists ig_radar_last_seen_idx on public.ig_radar (last_seen desc, brand);
create index if not exists ig_radar_first_seen_idx on public.ig_radar (first_seen desc);

alter policy ig_radar_agency_read on public.ig_radar
  using ((select public.is_agency()));
alter policy ig_radar_agency_update on public.ig_radar
  using ((select public.is_agency())) with check ((select public.is_agency()));
alter policy ig_profiles_agency_read on public.ig_profiles
  using ((select public.is_agency()));

-- Contrôle : 2 · 3 (les deux index, et les trois règles écrites avec « select »).
select
  (select count(*) from pg_indexes
    where schemaname = 'public' and tablename = 'ig_radar'
      and indexname in ('ig_radar_last_seen_idx', 'ig_radar_first_seen_idx')) as index_2,
  (select count(*) from pg_policies
    where schemaname = 'public'
      and policyname in ('ig_radar_agency_read', 'ig_radar_agency_update', 'ig_profiles_agency_read')
      and qual ilike '%select is_agency()%') as regles_3;
