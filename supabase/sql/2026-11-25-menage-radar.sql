-- ============================================================================
-- 2026-11-25 : ménage du radar des marques (ig_radar), audit du 24/11, point M28.
-- Décision de Gianni du 25/11 (« ok fais »), sauvegarde d'abord.
-- ----------------------------------------------------------------------------
-- Le radar garde 39 000 noms « nouveau » : plus de la moitié n'ont été cités qu'une fois
-- et n'ont jamais été lus (souvent des mots pris pour un @, des comptes disparus).
-- Trois étapes, lancées séparément (la suppression demande une confirmation à part) :
--   1) Sauvegarde : les lignes touchées sont copiées dans ig_radar_sauvegarde_20261125
--      (réservée au serveur, aucune lecture par l'app ni par un anonyme).
--   2) Passés en « ignorée » (rien de supprimé) : « nouveau » déjà lus comme comptes perso.
--   3) Supprimés : « nouveau », cités une seule fois, plus revus depuis 21 jours, jamais lus,
--      absents du carnet de contacts. S'ils sont cités de nouveau, le radar les remet.
-- Étape 3 corrigée le 27/11 (audit du 27/11, point E6) : elle ne supprime plus que les
-- lignes qui n'ont pas bougé depuis la sauvegarde. Une marque citée de nouveau depuis, ou
-- dont le profil a été lu, ou entrée au carnet, reste au radar avec ses nouvelles citations
-- (elles ne sont pas dans la sauvegarde). Toujours après le « oui » précis de Gianni.
-- Relançable sans risque (la sauvegarde ne se double pas). Pas dans SETUP.sql : ménage
-- ponctuel de données, pas un changement de schéma.
-- Retour arrière : insert into ig_radar select brand, posts, status_avant, first_seen, last_seen
--   from ig_radar_sauvegarde_20261125 on conflict (brand) do update set status = excluded.status;
-- ============================================================================

create table if not exists public.ig_radar_sauvegarde_20261125 (
  brand text primary key,
  posts jsonb,
  status_avant text,
  first_seen timestamptz,
  last_seen timestamptz,
  action text not null,
  sauve_le timestamptz not null default now()
);
alter table public.ig_radar_sauvegarde_20261125 enable row level security;
revoke all on public.ig_radar_sauvegarde_20261125 from anon, authenticated;

with cibles as (
  select r.brand, r.posts, r.status, r.first_seen, r.last_seen,
    case when p.username is null then 'supprime' else 'ignore' end as action
  from public.ig_radar r
  left join public.ig_profiles p on p.username = r.brand
  where r.status = 'nouveau'
    and (
      (p.username is null and jsonb_array_length(coalesce(r.posts, '[]'::jsonb)) <= 1 and r.last_seen < now() - interval '21 days'
        and not exists (select 1 from public.contacts c where lower(trim(both '/' from trim(leading '@' from regexp_replace(trim(coalesce(c.instagram, '')), '^https?://(www\.)?instagram\.com/', '')))) = r.brand))
      or p.why = 'compte_perso'
    )
)
insert into public.ig_radar_sauvegarde_20261125 (brand, posts, status_avant, first_seen, last_seen, action)
select brand, posts, status, first_seen, last_seen, action from cibles
on conflict (brand) do nothing;

-- Étape 2 (rien de supprimé) :
update public.ig_radar r set status = 'ignore'
from public.ig_radar_sauvegarde_20261125 s
where s.brand = r.brand and s.action = 'ignore' and r.status = 'nouveau';

-- Étape 3 (suppression, après le « oui » de Gianni). Seulement les lignes restées comme à
-- la sauvegarde : toujours « nouveau », pas citées de nouveau depuis (last_seen pas plus
-- récent), une citation au plus, aucun profil lu, absentes du carnet de contacts.
-- 11 787 lignes au 27/11 au soir (109 gardées) ; le nombre baisse à chaque passage du radar.
-- Une seule requête : le nombre compté et la suppression portent sur les mêmes lignes.
with cibles as (
  select r.brand
    from public.ig_radar r
    join public.ig_radar_sauvegarde_20261125 s on s.brand = r.brand
   where s.action = 'supprime' and r.status = 'nouveau'
     and r.last_seen <= s.last_seen
     and jsonb_array_length(coalesce(r.posts, '[]'::jsonb)) <= 1
     and not exists (select 1 from public.ig_profiles p where p.username = r.brand)
     and not exists (select 1 from public.contacts c where lower(trim(both '/' from trim(leading '@' from regexp_replace(trim(coalesce(c.instagram, '')), '^https?://(www\.)?instagram\.com/', '')))) = r.brand)
), supprimees as (
  delete from public.ig_radar r using cibles c where r.brand = c.brand returning r.brand
)
select (select count(*) from cibles) as comptees, (select count(*) from supprimees) as supprimees;

-- Contrôle : lignes sauvegardées par action, puis ce qui reste au radar.
select action, count(*) from public.ig_radar_sauvegarde_20261125 group by 1 order by 1;
select status, count(*) from public.ig_radar group by 1 order by 1;
