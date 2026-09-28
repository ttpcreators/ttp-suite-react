-- ============================================================================
-- CONTACTS · journal de contact multi-canal (« touches ») — suivi prospection
-- Titre Supabase : « Contacts · touches (suivi WhatsApp / relances) »
-- ============================================================================
-- Marc journalise chaque prise de contact avec un contact marque (WhatsApp,
-- Instagram, téléphone, LinkedIn…) : colonne `contacts.touches` (jsonb, tableau
-- de {id, date, canal, kind, note?}, kind = contact / relance / reponse).
-- `last_contacted` reste synchronisé côté app à chaque touche.
--
-- La vue agent `agent_lecture.contacts_marques` gagne 4 colonnes calculées pour
-- que Megan voie les relances manuelles de Marc (et ne relance pas en doublon) :
-- derniere_touche, canal_touche, nb_relances, derniere_reponse.
--
-- ➕ AJOUT PUR : une colonne + un create or replace de vue. Idempotente.
-- ============================================================================

alter table public.contacts add column if not exists touches jsonb;

create or replace view agent_lecture.contacts_marques as
select c.id,
       c.brand as marque,
       coalesce(nullif(trim(concat(coalesce(c.first_name, ''), ' ', coalesce(c.last_name, ''))), ''), c.person) as personne,
       c.role,
       c.tag,
       c.email,
       c.phone as telephone,
       c.instagram,
       c.city  as ville,
       c.last_contacted as dernier_contact,
       c.created_at,
       t.derniere_touche,
       t.canal_touche,
       t.nb_relances,
       t.derniere_reponse
  from public.contacts c
  left join lateral (
    select max(x.d)                                        as derniere_touche,
           (array_agg(x.canal order by x.d desc))[1]       as canal_touche,
           count(*) filter (where x.kind = 'relance')      as nb_relances,
           max(x.d) filter (where x.kind = 'reponse')      as derniere_reponse
      from (
        select case when (e->>'date') ~ '^\d{4}-\d{2}-\d{2}'
                    then left(e->>'date', 10)::date end as d,
               e->>'canal' as canal,
               e->>'kind'  as kind
          from jsonb_array_elements(
                 case when jsonb_typeof(c.touches) = 'array' then c.touches else '[]'::jsonb end
               ) e
      ) x
     where x.d is not null
  ) t on true
 where c.creator is null;

-- La vue reste réservée au rôle agent (aucun droit nouveau ; ceinture) :
revoke all on agent_lecture.contacts_marques from public, anon, authenticated;

-- ============================================================================
-- Vérification anon attendue :
--   • select=touches sur contacts → 200 (colonne présente, RLS filtre)
--   • colonne bidon → 400 42703
-- ============================================================================
