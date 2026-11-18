-- TITRE : TTP Suite · Alfred relié à l'app : pouls, nouvelles, demandes, réglages (2026-11-18)
-- ============================================================================
-- Demande de Marc (17 novembre 2026) : Alfred et l'app ne font plus qu'un.
--   1. Le pouls d'Alfred : l'iMac donne signe de vie chaque minute (fonction alfred-pont) ;
--      la page Agents montre « Alfred en ligne », et agent-watchdog prévient s'il se tait.
--   2. Les nouvelles de l'app : une tâche cochée par un créateur ou par Gianni, une pièce
--      déposée sur une tâche, une facture payée, un mail validé dans la page Agents, une
--      action de Gianni : une ligne dans agent.evenements, qu'Alfred reçoit dans la minute.
--   3. Les demandes à Alfred depuis l'app (« Demander à Alfred ») : agent.demandes.
--   4. Les réglages d'Alfred (heures, sonnerie, commandes) : agent.agents.reglages.
-- Rien de destructif. Peut être relancé sans risque.
-- ============================================================================

-- 1. Le pouls
alter table agent.agents
  add column if not exists vu_le timestamptz,
  add column if not exists passage text,
  add column if not exists passage_le timestamptz,
  add column if not exists hors_ligne_alerte_le timestamptz,
  add column if not exists reglages jsonb not null default '{}'::jsonb;

-- 2. Les nouvelles de l'app pour Alfred
create table if not exists agent.evenements (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  cible text,
  detail text,
  lien text,
  auteur text,
  cree_le timestamptz not null default now(),
  livre_le timestamptz
);
create index if not exists evenements_a_livrer on agent.evenements (cree_le) where livre_le is null;
alter table agent.evenements enable row level security;
drop policy if exists evenements_fondateurs on agent.evenements;
create policy evenements_fondateurs on agent.evenements for select using (public.is_founder());
grant select on agent.evenements to authenticated;

-- Qui agit (prénom affiché), d'après la session ; null pour le serveur.
create or replace function agent.qui_agit() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(p.display_name), ''), nullif(trim(p.creator_name), ''), p.role)
    from public.profiles p where p.user_id = auth.uid() limit 1;
$$;

-- Marc, Claude et les automatismes ne réveillent pas Alfred (il le sait déjà).
create or replace function agent.est_marc(nom text) returns boolean
language sql immutable as $$
  select coalesce(nom, '') ~* '^(marc|claude|automatique|alfred)' ;
$$;

-- Nombre de pièces d'une tâche (0 si le champ n'est pas une liste).
create or replace function agent.nb_pieces(j jsonb) returns integer
language sql immutable as $$
  select case when jsonb_typeof(j) = 'array' then jsonb_array_length(j) else 0 end;
$$;

-- Chaque déclencheur ci-dessous est inoffensif : une erreur chez Alfred ne bloque JAMAIS la
-- modification faite dans l'app (« exception when others then return new »).
create or replace function agent.nouvelle_tache() returns trigger
language plpgsql security definer set search_path = public, agent as $$
declare v_qui text := coalesce(new.done_by, agent.qui_agit());
begin
  -- Une tâche cochée par un créateur ou par Gianni.
  if new.done and not coalesce(old.done, false) and not agent.est_marc(v_qui) then
    insert into agent.evenements (type, cible, detail, lien, auteur)
    values ('tache_cochee', coalesce(new.creator, new.creators::text), new.text, '/?open=view&view=todo&item=' || new.id, v_qui);
  end if;
  -- Une pièce déposée sur une tâche (preview, capture, facture du créateur).
  if agent.nb_pieces(new.attachments) > agent.nb_pieces(old.attachments)
     and not agent.est_marc(agent.qui_agit()) then
    insert into agent.evenements (type, cible, detail, lien, auteur)
    values ('piece_deposee', coalesce(new.creator, new.creators::text), new.text, '/?open=view&view=todo&item=' || new.id, agent.qui_agit());
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists alfred_nouvelle_tache on public.todos;
create trigger alfred_nouvelle_tache after update on public.todos for each row execute function agent.nouvelle_tache();

create or replace function agent.nouvelle_facture() returns trigger
language plpgsql security definer set search_path = public, agent as $$
begin
  if new.status = 'payee' and coalesce(old.status, '') <> 'payee' then
    insert into agent.evenements (type, cible, detail, lien, auteur)
    values ('facture_payee', new.creator, new.ref || ' · ' || new.party || ' · ' || new.amount, '/?open=view&view=facturation', agent.qui_agit());
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists alfred_nouvelle_facture on public.invoices;
create trigger alfred_nouvelle_facture after update on public.invoices for each row execute function agent.nouvelle_facture();

-- Un mail ou un message validé dans la page Agents (bouton « Valider ») : Alfred l'envoie.
-- Le statut « valide » (Marc a dit oui dans l'app, Alfred n'a pas encore envoyé) s'ajoute aux autres.
alter table agent.actions drop constraint if exists actions_statut_check;
alter table agent.actions add constraint actions_statut_check
  check (statut = any (array['a_valider', 'valide', 'envoye', 'modifie_envoye', 'ecarte']));
create or replace function agent.action_validee() returns trigger
language plpgsql security definer set search_path = public, agent as $$
begin
  if new.statut = 'valide' and coalesce(old.statut, '') <> 'valide' then
    insert into agent.evenements (type, cible, detail, lien, auteur)
    values ('valide_dans_app', new.cible, coalesce(new.contexte, '') || ' [action ' || new.id || ']', '/?open=view&view=agent', agent.qui_agit());
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists alfred_action_validee on agent.actions;
create trigger alfred_action_validee after update on agent.actions for each row execute function agent.action_validee();

-- Ce que fait Gianni (ou un autre membre de l'équipe) dans l'app.
create or replace function agent.action_equipe() returns trigger
language plpgsql security definer set search_path = public, agent as $$
begin
  if not agent.est_marc(new.actor_name) then
    insert into agent.evenements (type, cible, detail, auteur)
    values ('action_equipe', new.entity, coalesce(new.verb, '') || ' · ' || coalesce(new.label, ''), new.actor_name);
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists alfred_action_equipe on public.agency_activity;
create trigger alfred_action_equipe after insert on public.agency_activity for each row execute function agent.action_equipe();

-- 3. Les demandes à Alfred depuis l'app
create table if not exists agent.demandes (
  id uuid primary key default gen_random_uuid(),
  texte text not null check (length(texte) between 1 and 2000),
  contexte text,
  lien text,
  auteur text,
  auteur_id uuid default auth.uid(),
  statut text not null default 'nouvelle' check (statut in ('nouvelle', 'recue', 'repondue')),
  reponse text,
  cree_le timestamptz not null default now(),
  recue_le timestamptz,
  repondu_le timestamptz
);
alter table agent.demandes enable row level security;
drop policy if exists demandes_lire on agent.demandes;
create policy demandes_lire on agent.demandes for select using (public.is_founder());
drop policy if exists demandes_ecrire on agent.demandes;
create policy demandes_ecrire on agent.demandes for insert with check (public.is_founder() and statut = 'nouvelle' and reponse is null);
grant select, insert on agent.demandes to authenticated;

-- L'auteur vient de la session, jamais de ce que le navigateur envoie.
create or replace function agent.demande_auteur() returns trigger
language plpgsql security definer set search_path = public, agent as $$
begin
  new.auteur := agent.qui_agit();
  new.auteur_id := auth.uid();
  return new;
end $$;
drop trigger if exists alfred_demande_auteur on agent.demandes;
create trigger alfred_demande_auteur before insert on agent.demandes for each row execute function agent.demande_auteur();

-- 4. Le cron de la sentinelle : toutes les 5 minutes (le contrôle du matin reste dedans).
do $do$
declare v_secret text;
begin
  select substring(command from 'Bearer ([^'']+)') into v_secret
    from cron.job where jobname = 'agent-watchdog' limit 1;
  if v_secret is null then
    raise notice 'Cron agent-watchdog introuvable : lance d''abord 2026-11-09-alerte-alfred.sql.';
    return;
  end if;
  perform cron.unschedule('agent-watchdog');
  perform cron.schedule('agent-watchdog', '*/5 * * * *', format($cmd$
    select net.http_post(
      url := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/agent-watchdog',
      headers := jsonb_build_object('Authorization', 'Bearer %s', 'Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cmd$, v_secret));
end $do$;

-- Contrôle : agent-watchdog · */5 * * * * · true, puis les deux tables.
select jobname, schedule, active from cron.job where jobname = 'agent-watchdog';
select count(*) as evenements from agent.evenements;
select count(*) as demandes from agent.demandes;
