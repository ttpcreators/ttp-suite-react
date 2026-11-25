-- ============================================================================
-- 2026-11-25 : radar, les « marques chaudes » (qui paient déjà des créateurs de nos niches)
-- ----------------------------------------------------------------------------
-- Décision de Gianni du 25/11 (point 5) : la prospection du matin commence par les marques
-- qui ont payé un partenariat ces 30 derniers jours à un créateur que le radar suit (posts
-- marqués « partenariat payé »). Elles ont un budget influence actif.
-- Garde-fous : seulement les comptes confirmés comme marques (ig_profiles.data.isBrand),
-- statut « nouveau » au radar (ni ignorées ni déjà en pipeline), absentes du carnet de
-- contacts (Instagram ou nom). `roster` : les créateurs du roster parmi ceux payés (à vérifier :
-- c'est peut-être déjà une collab de l'agence).
-- Lue seulement par le connecteur Claude (outil `sourcing`, option `chaudes`), avec la clé
-- serveur : aucun droit pour anon ni pour les comptes connectés. Lecture seule.
-- Relançable sans risque.
-- ============================================================================

create or replace function public.radar_marques_chaudes(p_jours int default 30, p_limite int default 50)
returns table (marque text, payes int, createurs text[], roster text[], dernier timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  with p as (
    select r.brand, e
    from public.ig_radar r
    cross join lateral jsonb_array_elements(coalesce(r.posts, '[]'::jsonb)) e
    where r.status = 'nouveau'
      and r.last_seen > now() - make_interval(days => greatest(least(p_jours, 90), 1))
      and jsonb_typeof(e) = 'object'
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
  join public.ig_profiles ip on ip.username = a.brand and (ip.data->>'isBrand') = 'true'
  where not exists (
    select 1 from public.contacts c
    where regexp_replace(regexp_replace(lower(coalesce(c.instagram, '')), '^(https?://(www\.)?instagram\.com/|@)', ''), '[/?#].*$', '') = a.brand
       or lower(replace(coalesce(c.brand, ''), ' ', '')) = a.brand
  )
  order by cardinality(coalesce(a.createurs, '{}')) desc, a.payes desc, a.dernier desc
  limit greatest(least(p_limite, 200), 1);
$$;

revoke all on function public.radar_marques_chaudes(int, int) from public, anon, authenticated;
grant execute on function public.radar_marques_chaudes(int, int) to service_role;

-- Contrôle : nombre de marques chaudes sur 30 jours, et droits (anon et authenticated : false).
select (select count(*) from public.radar_marques_chaudes(30, 200)) as marques_chaudes,
       has_function_privilege('anon', 'public.radar_marques_chaudes(int,int)', 'execute') as anon,
       has_function_privilege('authenticated', 'public.radar_marques_chaudes(int,int)', 'execute') as connectes;
