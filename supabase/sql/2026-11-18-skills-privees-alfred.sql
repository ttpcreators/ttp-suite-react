-- TITRE : TTP Suite · Skills privées d'Alfred, hors du dépôt public (2026-11-18)
-- ============================================================================
-- Les skills faites pour Marc (hooks-viraux, structure-script, conseil) ne vont pas dans le
-- dépôt GitHub public : elles sont rangées ici, lisibles du seul serveur (RLS sans règle), et
-- la fonction alfred-pont les remet à l'iMac quand elles changent. Leur contenu est inséré
-- directement dans la base, jamais dans ce fichier. Peut être relancé sans risque.
-- ============================================================================
create table if not exists agent.skills_privees (
  nom text primary key check (nom ~ '^[a-z0-9-]{2,40}$'),
  fichiers jsonb not null,
  maj_le timestamptz not null default now()
);
alter table agent.skills_privees enable row level security;
revoke all on agent.skills_privees from anon, authenticated;
select count(*) as skills_privees from agent.skills_privees;
