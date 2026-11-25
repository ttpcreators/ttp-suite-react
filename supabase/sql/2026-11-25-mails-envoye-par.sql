-- ============================================================================
-- 2026-11-25 : Mails, « Envoyé par » (qui de l'équipe a envoyé chaque mail)
-- ----------------------------------------------------------------------------
-- Demande de Gianni du 25/11 : Marc et Gianni envoient depuis les mêmes boîtes, au nom de
-- Marc. La page Mails doit dire qui a envoyé quoi.
--   - email_activity.envoye_par     : compte qui a envoyé (auth.users.id) ;
--   - email_activity.envoye_par_nom : son nom affiché au moment de l'envoi.
-- Remplis par gmail-send (envois depuis l'app) et ttp-mcp (envois de Claude et de la file).
-- Les mails envoyés directement depuis Gmail n'ont pas d'auteur (rien ne les journalise).
-- Rattrapage : les mails déjà partis par la file d'envoi reçoivent le compte qui les a
-- programmés (envoi_file.cree_par).
-- Relançable sans risque.
-- ============================================================================

alter table public.email_activity add column if not exists envoye_par uuid;
alter table public.email_activity add column if not exists envoye_par_nom text;

-- Retrouver vite les envois d'un fil (page Mails).
create index if not exists email_activity_thread_idx on public.email_activity (thread_id) where thread_id is not null;

-- Rattrapage des envois de la file (seulement les lignes sans auteur).
update public.email_activity a
set envoye_par = f.cree_par,
    envoye_par_nom = left(coalesce(nullif(trim(p.display_name), ''), split_part(u.email, '@', 1), 'Agence'), 40)
from public.envoi_file f
left join public.profiles p on p.user_id = f.cree_par
left join auth.users u on u.id = f.cree_par
where a.source = 'claude-file'
  and a.direction = 'out'
  and a.envoye_par is null
  and f.statut = 'envoye'
  and f.cree_par is not null
  and a.subject = f.objet
  and a.created_at between f.envoye_at - interval '5 minutes' and f.envoye_at + interval '5 minutes';

-- Contrôle : envois avec et sans auteur, par origine.
select source, count(*) filter (where envoye_par is not null) as avec_auteur, count(*) as total
from public.email_activity
where direction = 'out'
group by source
order by source;
