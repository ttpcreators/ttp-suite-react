-- TITRE : TTP · Relier factures, briefs et gifting aux collabs (31/10)
-- ============================================================================
-- 2026-10-31 · Relier les anciennes factures, briefs et gifting à leur collab
-- ----------------------------------------------------------------------------
-- Les factures créées avant le champ « Collab » n'ont pas de collab_id : la fiche
-- collab affiche « Factures : 0 » et le connecteur Claude ne sait pas quelle facture
-- va avec quelle collab. On relie SEULEMENT quand il n'y a qu'UNE collab possible
-- (même créateur, nom complet ou prénom seul, et marque citée). Plusieurs collabs
-- possibles : rien n'est touché (à relier à la main avec « Relier »).
-- Relançable sans risque : ne touche que les lignes sans collab.
-- ============================================================================

-- 0) Nom complet du créateur quand une ancienne saisie n'a que le prénom
--    (ex. facture Fitaya au nom de « Léna »), si ce prénom ne désigne qu'UN créateur du roster.
with uniq as (
  select lower(split_part(trim(name), ' ', 1)) first, min(name) full_name
  from creators group by 1 having count(*) = 1
)
update invoices i set creator = u.full_name
from uniq u
where lower(trim(i.creator)) = u.first and lower(trim(i.creator)) <> lower(trim(u.full_name));

-- 1) Factures : marque citée dans « party » + même créateur.
with cand as (
  select i.id inv, c.id col
  from invoices i
  join collabs c
    on lower(trim(i.creator)) = lower(trim(c.creator))
   and coalesce(trim(c.brand), '') <> ''
   and position(lower(trim(c.brand)) in lower(i.party)) > 0
  where i.collab_id is null
), uniq as (
  select inv, (array_agg(col))[1] col from cand group by inv having count(*) = 1
)
update invoices i set collab_id = u.col from uniq u where i.id = u.inv;

-- 2) Briefs : même marque + même créateur.
with cand as (
  select b.id br, c.id col
  from briefs b
  join collabs c
    on lower(trim(b.creator)) = lower(trim(c.creator))
   and lower(trim(b.brand)) = lower(trim(c.brand))
  where b.collab_id is null
), uniq as (
  select br, (array_agg(col))[1] col from cand group by br having count(*) = 1
)
update briefs b set collab_id = u.col from uniq u where b.id = u.br;

-- 3) Gifting : même marque + même créateur.
with cand as (
  select g.id gi, c.id col
  from gifting g
  join collabs c
    on lower(trim(g.creator)) = lower(trim(c.creator))
   and lower(trim(g.brand)) = lower(trim(c.brand))
  where g.collab_id is null
), uniq as (
  select gi, (array_agg(col))[1] col from cand group by gi having count(*) = 1
)
update gifting g set collab_id = u.col from uniq u where g.id = u.gi;

-- Contrôle : ce qui reste sans collab (à relier à la main, ou sans collab du tout).
select 'factures' quoi, count(*) filter (where collab_id is null) sans_collab, count(*) total from invoices
union all select 'briefs', count(*) filter (where collab_id is null), count(*) from briefs
union all select 'gifting', count(*) filter (where collab_id is null), count(*) from gifting;
