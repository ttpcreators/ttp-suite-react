-- ============================================================================
-- Sécurité · changement du secret des tâches automatiques (2026-10-14)
-- Titre Supabase : « Sécurité · nouveau secret des crons »
-- ============================================================================
-- L'ancien secret (CRON_SECRET) était écrit dans deux fichiers du dépôt, qui est public.
-- Ordre :
--   1. Terminal (le nouveau secret est créé, posé dans Supabase et copié dans le
--      presse-papier, sans s'afficher) :
--        S=$(openssl rand -hex 32) && supabase secrets set CRON_SECRET="$S" --project-ref zizvggziggswhrbuyhuo && printf %s "$S" | pbcopy && unset S
--   2. Ici : remplace COLLE_ICI par le presse-papier (Cmd+V), puis Run.
--      Chaque tâche planifiée qui utilisait l'ancien secret reçoit le nouveau.
-- ============================================================================
do $$
declare
  v_new text := 'COLLE_ICI';
  v_old text;
  j record;
  n int := 0;
begin
  if v_new = 'COLLE_ICI' or length(v_new) < 32 then
    raise exception 'Colle d''abord le nouveau secret à la place de COLLE_ICI.';
  end if;
  select substring(command from 'Bearer ([^''" ]+)') into v_old
    from cron.job where jobname = 'gmail-poll-5min' limit 1;
  if v_old is null or v_old = v_new then
    raise exception 'Ancien secret introuvable dans la tâche gmail-poll-5min (rien changé).';
  end if;
  for j in select jobid, command from cron.job where position(v_old in command) > 0 loop
    perform cron.alter_job(j.jobid, command := replace(j.command, v_old, v_new));
    n := n + 1;
  end loop;
  raise notice '% tâches planifiées mises à jour.', n;
end $$;
select jobname, schedule, active from cron.job order by jobname;
