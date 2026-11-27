-- ============================================================================
-- 2026-11-27 : radar, « marques chaudes » plus rapides (6,6 s -> 0,06 s)
-- ----------------------------------------------------------------------------
-- Le 27/11, la séance du matin a reçu deux fois « canceling statement due to statement
-- timeout » : la fonction prenait 6,6 s pour une limite de 8 s. Cause : le contrôle « absente
-- du carnet » recalculait l'Instagram normalisé de chaque contact pour chaque ligne (947 000
-- calculs), et tous les posts du radar étaient dépliés avant de garder les seules marques.
-- Correctif : carnet normalisé une seule fois (cles), marques choisies avant de déplier.
-- Même résultat vérifié le 27/11 (92 marques sur 30 jours, 0 différence). Mêmes droits.
-- Relançable sans risque.
-- ============================================================================

create or replace function public.radar_marques_chaudes(p_jours int default 30, p_limite int default 50)
returns table (marque text, payes int, createurs text[], roster text[], dernier timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  -- Rapide (2026-11-27) : le carnet est normalisé une seule fois (cles), et les marques
  -- confirmées, hors carnet, sont choisies AVANT de déplier leurs posts.
  with cles as materialized (
    select regexp_replace(regexp_replace(lower(coalesce(c.instagram, '')), '^(https?://(www\.)?instagram\.com/|@)', ''), '[/?#].*$', '') as k
    from public.contacts c
    union
    select lower(replace(coalesce(c.brand, ''), ' ', '')) from public.contacts c
  ), marques as (
    select r.brand, r.posts
    from public.ig_radar r
    join public.ig_profiles ip on ip.username = r.brand and (ip.data->>'isBrand') = 'true'
    where r.status = 'nouveau'
      and r.last_seen > now() - make_interval(days => greatest(least(p_jours, 90), 1))
      and not exists (select 1 from cles where cles.k = r.brand)
  ), p as (
    select m.brand, e
    from marques m
    cross join lateral jsonb_array_elements(coalesce(m.posts, '[]'::jsonb)) e
    where jsonb_typeof(e) = 'object'
      and (e->>'paid') = 'true'
      -- CASE : la conversion n'est tentée que sur une date bien formée (ordre garanti).
      and (case when (e->>'at') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then (e->>'at')::timestamptz end)
          > now() - make_interval(days => greatest(least(p_jours, 90), 1))
  ), agg as (
    select brand,
           count(*)::int as payes,
           array_agg(distinct e->>'c') filter (where coalesce(e->>'c', '') <> '') as createurs,
           array_agg(distinct e->>'c') filter (where (e->>'roster') = 'true' and coalesce(e->>'c', '') <> '') as roster,
           max(case when (e->>'at') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then (e->>'at')::timestamptz end) as dernier
    from p
    group by brand
  )
  select a.brand, a.payes, coalesce(a.createurs, '{}'), coalesce(a.roster, '{}'), a.dernier
  from agg a
  order by cardinality(coalesce(a.createurs, '{}')) desc, a.payes desc, a.dernier desc
  limit greatest(least(p_limite, 200), 1);
$$;

revoke all on function public.radar_marques_chaudes(int, int) from public, anon, authenticated;
grant execute on function public.radar_marques_chaudes(int, int) to service_role;

-- Contrôle : nombre de marques chaudes sur 30 jours, et droits (anon et authenticated : false).
select (select count(*) from public.radar_marques_chaudes(30, 200)) as marques_chaudes,
       has_function_privilege('anon', 'public.radar_marques_chaudes(int,int)', 'execute') as anon,
       has_function_privilege('authenticated', 'public.radar_marques_chaudes(int,int)', 'execute') as connectes;
