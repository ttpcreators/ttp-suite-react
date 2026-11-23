-- 2026-11-23 · File « À valider » : nouveau type de proposition « avancer_collab ».
--
-- Alfred propose de faire avancer une collab (paiement reçu, vidéo validée, post publié,
-- stats reçues) ; « Valider » dans la page Agents fait avancer la collab dans l'app.
-- Avant ce SQL, l'outil proposer_action dépose la même proposition en « alerte » (l'app la
-- reconnaît à son lien) : rien ne casse si ce fichier n'est pas encore lancé.
-- Relançable sans risque.

alter table agent.actions drop constraint if exists actions_type_check;
alter table agent.actions add constraint actions_type_check
  check (type = any (array['brouillon_mail', 'whatsapp', 'linkedin', 'instagram', 'alerte', 'avancer_collab']));

-- Contrôle : la définition doit citer avancer_collab (1 ligne).
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'agent.actions'::regclass and conname = 'actions_type_check';
