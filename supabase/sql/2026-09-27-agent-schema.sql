-- ============================================================================
-- AGENT · PHASE 4 — schéma agent (les 7 tables où l'agent écrit)
-- Titre Supabase : « Agent · Phase 4 · schéma agent (tables) »
-- ============================================================================
-- L'espace d'ÉCRITURE de l'agent IA : cockpits quotidiens, actions à valider,
-- prospection, cercle du fondateur, mémoire créatrices, leçons, journal.
--
-- Qui écrit quoi :
--   • l'agent (rôle ttp_agent, Phase 5) : SELECT + INSERT + UPDATE, pas de DELETE ;
--   • Marc depuis l'app (page Agent, Phase 6) : valider / écarter / marquer
--     envoyé / supprimer une info mémoire → policies RLS agence ci-dessous.
--
-- ➕ MIGRATION EN AJOUT PUR : un schéma + 7 tables neuves. Rien d'existant
--    n'est touché. Idempotente.
-- 🔒 anon : aucun droit. authenticated : RLS is_agency() (l'Espace Agence).
-- ============================================================================

create schema if not exists agent;
revoke all on schema agent from public, anon;
grant usage on schema agent to authenticated;   -- l'app ; les lignes sont sous RLS agence

-- ── 1) Le cockpit du jour (un par jour) ─────────────────────────────────────
create table if not exists agent.cockpits (
  id uuid primary key default gen_random_uuid(),
  jour date not null unique,
  contenu text not null,
  cree_le timestamptz default now()
);

-- ── 2) Les actions préparées pour Marc ──────────────────────────────────────
create table if not exists agent.actions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('brouillon_mail','whatsapp','linkedin','instagram','alerte')),
  cible text,                -- créatrice ou marque concernée
  contexte text,
  contenu text,
  lien_spark text,           -- lien vers le brouillon Spark s'il existe
  statut text not null default 'a_valider'
    check (statut in ('a_valider','envoye','modifie_envoye','ecarte')),
  cree_le timestamptz default now(),
  traite_le timestamptz
);
create index if not exists agent_actions_statut_idx on agent.actions (statut);

-- ── 3) La prospection pilotée par l'agent ───────────────────────────────────
create table if not exists agent.prospects (
  id uuid primary key default gen_random_uuid(),
  marque text not null,
  signal text,               -- ce qui justifie le contact
  signal_date date,
  contact text,              -- personne visée
  contact_role text,
  canal text,
  creatrice text,            -- la créatrice qui matche
  angle text,
  premier_message text,
  statut text not null default 'propose'
    check (statut in ('propose','valide','ecarte','contacte','relance_1','relance_2','relance_3','repondu','converti','abandonne')),
  prochaine_relance date,
  notes text,
  cree_le timestamptz default now(),
  maj_le timestamptz default now()
);
create index if not exists agent_prospects_statut_idx  on agent.prospects (statut);
create index if not exists agent_prospects_relance_idx on agent.prospects (prochaine_relance);

-- ── 4) Le cercle : les relations du fondateur à entretenir ──────────────────
create table if not exists agent.cercle (
  id uuid primary key default gen_random_uuid(),
  contact text not null,
  entreprise text,
  type text check (type in ('marque_cliente','agence_partenaire','prospect_chaud')),
  frequence text,            -- fréquence de contact souhaitée
  dernier_contact date,
  prochain_pretexte text,
  statut text not null default 'propose' check (statut in ('propose','valide')),
  cree_le timestamptz default now(),
  maj_le timestamptz default now()
);

-- ── 5) La mémoire créatrices ─────────────────────────────────────────────────
-- Catégories FERMÉES par contrainte : jamais de santé, de vie intime, de
-- problèmes familiaux ni de finances personnelles (consigne structurelle).
create table if not exists agent.memoire_createurs (
  id uuid primary key default gen_random_uuid(),
  creatrice text not null,
  categorie text not null check (categorie in
    ('anniversaire','projet','voyage','examen','objectif','preference_tournage','disponibilite')),
  info text not null,
  date date,
  source text,
  cree_le timestamptz default now()
);
create index if not exists agent_memoire_creatrice_idx on agent.memoire_createurs (creatrice);

-- ── 6) Les leçons apprises (corrections de Marc) ─────────────────────────────
create table if not exists agent.lecons (
  id uuid primary key default gen_random_uuid(),
  module text,
  lecon text not null,
  cree_le timestamptz default now()
);

-- ── 7) Le journal d'activité de l'agent ──────────────────────────────────────
create table if not exists agent.journal (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  detail text,
  cree_le timestamptz default now()
);
create index if not exists agent_journal_date_idx on agent.journal (cree_le);

-- ── maj_le automatique sur prospects et cercle ───────────────────────────────
create or replace function agent.touch_maj() returns trigger
  language plpgsql as $$ begin new.maj_le := now(); return new; end $$;
drop trigger if exists agent_prospects_touch on agent.prospects;
create trigger agent_prospects_touch before update on agent.prospects
  for each row execute function agent.touch_maj();
drop trigger if exists agent_cercle_touch on agent.cercle;
create trigger agent_cercle_touch before update on agent.cercle
  for each row execute function agent.touch_maj();

-- ── RLS : l'app = agence uniquement ─────────────────────────────────────────
-- (Le rôle ttp_agent recevra ses propres policies en Phase 5 — il n'existe pas encore.)
do $$
declare t text;
begin
  foreach t in array array['cockpits','actions','prospects','cercle','memoire_createurs','lecons','journal']
  loop
    execute format('alter table agent.%I enable row level security;', t);
    execute format('drop policy if exists %I_agence on agent.%I;', t, t);
    execute format(
      'create policy %I_agence on agent.%I for all to authenticated using (public.is_agency()) with check (public.is_agency());',
      t, t);
  end loop;
end $$;

-- Droits de l'app (les lignes restent filtrées par la RLS agence ci-dessus).
grant select, insert, update, delete on all tables in schema agent to authenticated;
alter default privileges in schema agent
  grant select, insert, update, delete on tables to authenticated;
revoke all on all tables in schema agent from anon;

-- ============================================================================
-- ⚠️ ÉTAPE DASHBOARD (une fois, pour la future page Agent de l'app) :
--   Settings → API → « Exposed schemas » : ajouter `agent` à la liste
--   (public, graphql_public, agent). Sans ça, l'app ne peut pas lire/écrire
--   ces tables. Le schéma agent_lecture, lui, ne doit JAMAIS y figurer.
--
-- Vérification attendue après application + exposition :
--   • anon : GET /rest/v1/cockpits (Accept-Profile: agent) → 401/permission
--     denied (aucun droit anon) ;
--   • SQL Editor : insert dans agent.journal puis select → OK.
-- ============================================================================
