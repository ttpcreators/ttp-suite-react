-- ============================================================================
-- AGENT · PHASE 3 — schéma agent_lecture (vues en lecture seule pour l'agent)
-- Titre Supabase : « Agent · Phase 3 · schéma agent_lecture (vues) »
-- ============================================================================
-- L'agent IA ne lira JAMAIS les tables `public` directement : uniquement ces
-- vues, qui exposent le nécessaire SANS les colonnes sensibles repérées dans
-- AUDIT_AGENT.md (banque, montants de facture, CA/commission, date de
-- naissance, téléphone/adresse/SIREN/email perso des créatrices, contenu des
-- messages, jetons, blob brut).
--
-- ➕ MIGRATION EN AJOUT PUR : un nouveau schéma + des vues. Aucune table, aucune
--    donnée existante modifiée. Idempotente (create or replace).
--
-- 🔒 SÉCURITÉ : aucun droit accordé ici. Le schéma est INERTE tant que la
--    Phase 5 n'a pas créé le rôle `ttp_agent` et accordé SELECT sur ces vues.
--    On révoque même explicitement anon / authenticated / public (ceinture et
--    bretelles). Les vues s'exécutent avec les droits de leur propriétaire
--    (postgres) : c'est voulu — c'est le mécanisme qui permet de n'exposer QUE
--    les colonnes choisies, la porte d'entrée étant les GRANT de la Phase 5.
-- ============================================================================

create schema if not exists agent_lecture;
revoke all   on schema agent_lecture from public;
revoke usage on schema agent_lecture from anon, authenticated;

-- ── 1) Les créatrices : infos PRO uniquement ────────────────────────────────
-- Exclu : birth, phone, email (perso), address, siren, ca, commission, mediakit.
create or replace view agent_lecture.creatrices as
select id,
       name        as nom,
       handle,
       platform    as plateforme,
       instagram,
       tiktok,
       niche       as univers,
       followers,
       reach,
       er,
       status      as statut,
       ville,
       email_pro,
       stats,                          -- audience par réseau (donnée de pitch)
       followers_history,              -- évolution d'audience
       stats_month as stats_maj,
       created_at  as arrivee_le
  from public.creators;

-- ── 2) Les collabs : étape courante + fiche ─────────────────────────────────
create or replace view agent_lecture.collabs as
select id,
       brand        as marque,
       creator      as creatrice,
       contact,
       title        as libelle,
       deliverables as livrables,
       cachet,
       step         as etape,
       status       as statut,
       note,
       created_at   as creee_le,
       updated_at   as maj_le
  from public.collabs;

-- ── 3) L'historique daté des étapes de collab ───────────────────────────────
create or replace view agent_lecture.collab_etapes as
select collab_id, step as etape, reached_at as franchie_le, note
  from public.collab_steps;

-- ── 4) Les briefs ────────────────────────────────────────────────────────────
-- Exclu : consignes (script complet), pdf (chemin de fichier).
create or replace view agent_lecture.briefs as
select id,
       brand        as marque,
       creator      as creatrice,
       deliverables as livrables,
       due          as echeance,
       status       as statut,
       budget,
       objectif,
       created_at
  from public.briefs;

-- ── 5) Le planning ───────────────────────────────────────────────────────────
-- Exclu : description (peut contenir du perso via la synchro Google Agenda).
create or replace view agent_lecture.planning as
select id, date, time as heure, title as titre, type, who as qui,
       source, created_at
  from public.events
 where deleted = false;

-- ── 6) Les échéances de contrat (extraites du blob, clé contractDeadlines) ──
-- Le blob complet reste interdit ; on n'en extrait QUE cette clé, champ par
-- champ, avec des gardes (dates/durées illisibles → null, jamais d'erreur).
create or replace view agent_lecture.echeances as
select d->>'id'      as id,
       d->>'creator' as creatrice,
       d->>'type'    as type,
       case when (d->>'start') ~ '^\d{4}-\d{2}-\d{2}'
            then left(d->>'start', 10)::date else null end as debut,
       case when (d->>'months') ~ '^\d+(\.\d+)?$'
            then (d->>'months')::numeric else null end as duree_mois,
       case when (d->>'start') ~ '^\d{4}-\d{2}-\d{2}' and (d->>'months') ~ '^\d+$'
            then (left(d->>'start', 10)::date
                  + make_interval(months => (d->>'months')::int))::date
            else null end as fin,
       d->>'note' as note
  from (select a from public.module_rows
         where module = '__app_state__'
         order by created_at desc limit 1) m,
       jsonb_array_elements(
         coalesce(nullif(m.a, '')::jsonb -> 'contractDeadlines', '[]'::jsonb)
       ) as d;

-- ── 7) Les factures : statut de paiement, SANS le montant ───────────────────
create or replace view agent_lecture.factures as
select id, ref, party as marque, creator as creatrice,
       date, status as statut, created_at
  from public.invoices;

-- ── 8) Les reversements : « créatrice payée le … », SANS montant ni note ────
-- (extraits du blob, clé creatorPayouts = { créatrice: [{id, date, amount, note}] })
create or replace view agent_lecture.reversements as
select e.key      as creatrice,
       p->>'id'   as id,
       case when (p->>'date') ~ '^\d{4}-\d{2}-\d{2}'
            then left(p->>'date', 10)::date else null end as paye_le
  from (select a from public.module_rows
         where module = '__app_state__'
         order by created_at desc limit 1) m,
       jsonb_each(coalesce(nullif(m.a, '')::jsonb -> 'creatorPayouts', '{}'::jsonb)) as e(key, value),
       jsonb_array_elements(
         case when jsonb_typeof(e.value) = 'array' then e.value else '[]'::jsonb end
       ) as p;

-- ── 9) Les contacts marques et agences (carnet AGENCE uniquement) ───────────
-- Les contacts personnels ajoutés par une créatrice (creator non null) restent
-- hors périmètre. Coordonnées pro exposées (c'est le métier de l'agent).
create or replace view agent_lecture.contacts_marques as
select id,
       brand as marque,
       coalesce(nullif(trim(concat(coalesce(first_name, ''), ' ', coalesce(last_name, ''))), ''), person) as personne,
       role,
       tag,
       email,
       phone as telephone,
       instagram,
       city  as ville,
       last_contacted as dernier_contact,
       created_at
  from public.contacts
 where creator is null;

-- ── 10) La prospection en cours ──────────────────────────────────────────────
create or replace view agent_lecture.prospection as
select id, brand as marque, contact, value as valeur, stage as etape, created_at
  from public.prospects;

-- ── 11) Le scouting (créatrices hors roster à suivre) ────────────────────────
create or replace view agent_lecture.scouting as
select id, name as nom, handle, email, tag, note,
       last_contacted as dernier_contact, created_at
  from public.creator_pool;

-- ── Verrou final : rien pour anon/authenticated, ni maintenant ni plus tard ──
revoke all on all tables in schema agent_lecture from public, anon, authenticated;
alter default privileges in schema agent_lecture
  revoke all on tables from public, anon, authenticated;

-- ============================================================================
-- Vérification attendue après application :
--   • en anon (API REST) : agent_lecture n'est PAS exposé par PostgREST
--     (seul `public` l'est) → GET /rest/v1/… ne voit aucune de ces vues.
--   • dans le SQL Editor : `select * from agent_lecture.creatrices limit 3;`
--     renvoie les colonnes PRO uniquement (aucune colonne birth/phone/address/
--     siren/ca/commission n'existe dans la vue).
-- ============================================================================
