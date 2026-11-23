-- ════════════════════════════════════════════════════════════════════════════
-- TTP Suite · Exclusivité : rattrapage de la colonne creators.exclu (2026-11-23)
-- L'interrupteur « Créateur en exclusivité » de la fiche était rangé dans la clé de blob
-- creatorExclusive (module_rows, ligne __app_state__) ; la colonne creators.exclu (défaut
-- false) n'en est la copie que depuis peu. Ce script recopie dans la colonne chaque
-- créateur marqué exclusif dans le blob (nom comparé sans majuscules ni espaces autour).
-- Il ne retire JAMAIS une exclusivité. Relançable sans risque. L'app lit « colonne OU
-- blob » avant comme après ce script (src/lib/creatorExclu.ts).
-- ════════════════════════════════════════════════════════════════════════════
with blob as (
  select coalesce(nullif(a, ''), '{}')::jsonb -> 'creatorExclusive' as x
    from public.module_rows
   where module = '__app_state__'
), noms as (
  select distinct lower(trim(e.nom)) as nom
    from blob,
         jsonb_each_text(case when jsonb_typeof(blob.x) = 'object' then blob.x else '{}'::jsonb end) as e(nom, valeur)
   where e.valeur = 'true'
)
update public.creators c
   set exclu = true
  from noms
 where lower(trim(c.name)) = noms.nom
   and coalesce(c.exclu, false) = false;

-- Contrôle : 0 attendu (créateurs exclusifs dans le blob mais pas dans la colonne).
with blob as (
  select coalesce(nullif(a, ''), '{}')::jsonb -> 'creatorExclusive' as x
    from public.module_rows
   where module = '__app_state__'
), noms as (
  select distinct lower(trim(e.nom)) as nom
    from blob,
         jsonb_each_text(case when jsonb_typeof(blob.x) = 'object' then blob.x else '{}'::jsonb end) as e(nom, valeur)
   where e.valeur = 'true'
)
select count(*) as reste_a_rattraper
  from public.creators c
  join noms on lower(trim(c.name)) = noms.nom
 where coalesce(c.exclu, false) = false;
