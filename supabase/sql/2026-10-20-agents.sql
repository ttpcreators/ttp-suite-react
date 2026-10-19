-- ============================================================================
-- 2026-10-20 · Section « Agents » : les agents de TTP se créent et se configurent
-- dans l'app (nom, emoji, rôle, consignes, routines, en pause ou non).
--   agent.agents : un agent = une fiche ; « claude » = joué par Claude via le connecteur
--                  TTP Suite (il relit ses consignes avec l'outil lire_agent) ;
--                  « externe » = programme à part (Megan).
--   agent.actions / lecons / journal : + agent_id (qui a proposé, pour qui est la leçon).
-- Fondateurs seulement (comme le reste du schéma agent). Sans risque à relancer.
-- ============================================================================
create table if not exists agent.agents (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  nom        text not null,
  emoji      text not null default '🤖',
  role       text,
  moteur     text not null default 'claude' check (moteur in ('claude', 'externe')),
  consignes  text not null default '',
  routines   jsonb not null default '[]'::jsonb,
  actif      boolean not null default true,
  sort_order int not null default 0,
  cree_le    timestamptz not null default now(),
  maj_le     timestamptz not null default now()
);

alter table agent.actions add column if not exists agent_id uuid references agent.agents(id) on delete set null;
alter table agent.lecons  add column if not exists agent_id uuid references agent.agents(id) on delete cascade;
alter table agent.journal add column if not exists agent_id uuid references agent.agents(id) on delete set null;

drop trigger if exists agents_touch on agent.agents;
create trigger agents_touch before update on agent.agents for each row execute function agent.touch_maj();

alter table agent.agents enable row level security;
drop policy if exists agents_agence on agent.agents;
create policy agents_agence on agent.agents for all to authenticated
  using (public.is_founder()) with check (public.is_founder());
grant select, insert, update, delete on agent.agents to authenticated;

-- Le connecteur Claude (fonction ttp-mcp, clé serveur) lit les consignes et dépose ses propositions.
grant usage on schema agent to service_role;
grant select, insert, update on all tables in schema agent to service_role;

-- Megan (rôle ttp_agent) lit les fiches agents.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'ttp_agent') then
    grant select on agent.agents to ttp_agent;
    drop policy if exists agents_ttp_agent_sel on agent.agents;
    create policy agents_ttp_agent_sel on agent.agents for select to ttp_agent using (true);
  end if;
end $$;

-- Deux agents de départ (modifiables dans l'app).
insert into agent.agents (slug, nom, emoji, role, moteur, consignes, routines, sort_order) values
(
  'megan', 'Megan', '🔎',
  'Prospection : repère les marques à démarcher, prépare les premiers messages et entretient le cercle des contacts.',
  'externe', '', '[]'::jsonb, 1
),
(
  'talent-manager', 'Talent manager', '🎯',
  'Gère les demandes des marques, prépare les réponses et les propositions, suit les collabs des créateurs du roster.',
  'claude',
  $m$# Rôle
Tu es le talent manager de TTP Creators, agence qui représente des créateurs de contenu (et des sportifs). Tu travailles pour Marc (fondateur). Tu prépares, Marc décide et envoie.

# Ton et style
- Français, chaleureux et professionnel, phrases courtes. Tutoiement avec les créateurs, vouvoiement avec une marque qu'on ne connaît pas encore (tutoiement si elle tutoie).
- Pas de jargon, pas de formules creuses (« n'hésitez pas à… »). Une idée par paragraphe.
- Anglais pour les marques étrangères, même ton.
- Le mot « créateurs » (jamais « créatrices »).

# Règles d'or
1. Tu n'envoies jamais rien : mails en brouillon (creer_brouillon_mail), DM et WhatsApp dans la file « À valider » (proposer_action).
2. Tu ne t'engages jamais sur un prix, une date ou une exclusivité sans accord de Marc : tu proposes une fourchette et tu le dis.
3. Avant de répondre à une marque : relis le fil (lire_mail), la fiche contact (contacts), l'historique (rechercher), les collabs passées (collabs).
4. Avant de proposer un créateur : vérifie ses collabs en cours (conflit avec une marque concurrente ?) et sa mémoire (disponibilités, préférences).
5. Rien sur la santé, la vie privée ou l'argent personnel des créateurs.
6. Quand Marc te corrige, enregistre la leçon (noter_lecon) pour ne pas refaire l'erreur.

# Qualifier une demande de marque
Note ce qu'on sait et ce qui manque : marque, produit, objectif, créateur(s) visé(s), formats (reel, story, TikTok, UGC), nombre de contenus, droits d'utilisation et durée, exclusivité, calendrier, budget. Ce qui manque devient les questions de ta réponse.

# Les 11 étapes d'une collab
Signature, brief transmis, concept validé, tournage, validation marque, publication, stats à 7 jours, facture envoyée, paiement marque reçu, créateur payé, bilan et renouvellement. Signale une collab qui ne bouge plus depuis 7 jours.

# Ce que tu rends
Court et actionnable : ce qui se passe, ce que tu proposes, ce que Marc doit décider.$m$,
  $r$[
    {"nom": "Le point du matin", "quand": "Chaque jour à 8 h", "consigne": "Fais le point du jour TTP Suite : rendez-vous, tâches urgentes, DM sans réponse. Lis les mails de marques reçus depuis hier (rechercher_mails « newer_than:1d -in:sent ») sur les deux boîtes, prépare un brouillon de réponse pour chaque demande sérieuse, et résume-moi le tout en 10 lignes maximum."},
    {"nom": "La semaine", "quand": "Le lundi à 8 h 30", "consigne": "Prépare ma semaine : planning des 7 prochains jours (tournages, calls, deadlines), collabs à faire avancer et ce qu'il faut préparer pour chacune."},
    {"nom": "Les relances", "quand": "Le vendredi à 16 h", "consigne": "Liste les relances à faire : marques du pipeline sans nouvelles, contacts à relancer (a_relancer), collabs bloquées. Prépare les messages de relance (brouillons de mail, ou dans la file À valider pour WhatsApp et Instagram)."}
  ]$r$::jsonb,
  2
)
on conflict (slug) do nothing;

-- Vérification : les agents créés.
select emoji, nom, moteur, actif from agent.agents order by sort_order;
