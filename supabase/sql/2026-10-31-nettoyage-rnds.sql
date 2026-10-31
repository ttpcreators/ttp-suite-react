-- TITRE : TTP · Nettoyage des ligues RNDS lancées par erreur (31/10)
-- ============================================================================
-- Le 2026-10-25, le SQL « ligues privées » de l'app RNDS a été lancé dans la base de
-- TTP Suite (projet zizvggziggswhrbuyhuo) au lieu de celle de RNDS. Il y a créé 2 tables
-- (vides, rien ne s'y rattache) et 4 fonctions, sans rapport avec TTP. On les retire.
-- Relançable sans risque. Refuse de supprimer si une table n'est plus vide.
-- ============================================================================
begin;

do $$
begin
  if to_regclass('public.fight_league_members') is not null
     and exists (select 1 from public.fight_league_members) then
    raise exception 'fight_league_members n''est pas vide : on ne supprime rien';
  end if;
  if to_regclass('public.fight_leagues') is not null
     and exists (select 1 from public.fight_leagues) then
    raise exception 'fight_leagues n''est pas vide : on ne supprime rien';
  end if;
end $$;

drop function if exists public.fight_league_board(uuid);
drop function if exists public.fight_league_create(text);
drop function if exists public.fight_league_join(text);
drop function if exists public.fight_leagues_list();
drop table if exists public.fight_league_members;
drop table if exists public.fight_leagues;

commit;

-- Contrôle : tout doit être à 0.
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'fight_league%') tables_restantes,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'fight_league%') fonctions_restantes;
