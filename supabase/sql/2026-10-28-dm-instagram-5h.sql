-- ============================================================================
-- DM Instagram : lecture complète toutes les 5 heures (au lieu de chaque heure).
-- Les DM arrivent quand même en direct : chaque message reçu déclenche une lecture
-- ciblée (ig-webhook → ig-inbox) et une notification.
-- À lancer une fois dans Supabase › SQL Editor. Sans effet si la tâche n'existe pas.
-- ============================================================================
select cron.alter_job(job_id := jobid, schedule := '25 */5 * * *')
from cron.job where jobname = 'ig-inbox-horaire';

-- Vérification : doit afficher « 25 */5 * * * ».
select jobname, schedule, active from cron.job where jobname = 'ig-inbox-horaire';
