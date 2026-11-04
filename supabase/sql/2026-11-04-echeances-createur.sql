-- ============================================================================
-- Échéances d'un créateur pour l'agenda de son espace (demande de Marc, 4 nov. 2026)
-- ----------------------------------------------------------------------------
-- Les fins de contrat (`contractDeadlines`) et les exclusivités (`exclusivites`) vivent
-- dans le blob agence (`module_rows`, lisible par l'agence seulement). Cette fonction
-- rend au créateur connecté SES lignes, et rien d'autre :
--   - contrats : créateur, type, début, durée ;
--   - exclusivités CONFIRMÉES (pas celles « à confirmer ») : marque, secteur, concurrents,
--     dates. Les points du contrat (montant, droits…) ne sortent pas.
-- L'agence peut demander celles d'un créateur précis (p_creator), comme creator_discussions.
-- Rejouable sans risque.
-- ============================================================================

create or replace function public.creator_echeances(p_creator text default null)
returns jsonb
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  with me as (
    select lower(btrim(case when public.is_agency() then coalesce(p_creator, '') else coalesce(public.my_creator(), '') end)) as n
  ), blob as (
    select a::jsonb as j from public.module_rows where module = '__app_state__' limit 1
  ), dl as (
    select d from blob, me,
      jsonb_array_elements(case when jsonb_typeof(blob.j -> 'contractDeadlines') = 'array' then blob.j -> 'contractDeadlines' else '[]'::jsonb end) d
    where me.n <> '' and jsonb_typeof(d) = 'object' and lower(btrim(coalesce(d ->> 'creator', ''))) = me.n
  ), ex as (
    select x from blob, me,
      jsonb_array_elements(case when jsonb_typeof(blob.j -> 'exclusivites') = 'array' then blob.j -> 'exclusivites' else '[]'::jsonb end) x
    where me.n <> '' and jsonb_typeof(x) = 'object'
      and lower(btrim(coalesce(x ->> 'creator', ''))) = me.n
      and coalesce(x -> 'pending', 'false'::jsonb) <> 'true'::jsonb
  )
  select jsonb_build_object(
    'contrats', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d ->> 'id', 'creator', d ->> 'creator', 'type', d ->> 'type', 'start', d ->> 'start', 'months', d -> 'months')) from dl), '[]'::jsonb),
    'exclusivites', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x ->> 'id', 'creator', x ->> 'creator', 'brand', x ->> 'brand', 'scope', x ->> 'scope',
        'competitors', coalesce(x -> 'competitors', '[]'::jsonb), 'start', x ->> 'start', 'end', x ->> 'end')) from ex), '[]'::jsonb)
  );
$$;

revoke all on function public.creator_echeances(text) from public, anon;
grant execute on function public.creator_echeances(text) to authenticated;
