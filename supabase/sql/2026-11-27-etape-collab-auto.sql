-- ============================================================================
-- 2026-11-27 · Vague 1 : la tâche de l'étape et « gagnée » sont posées par la base, quel que
-- soit l'endroit où la collab avance
-- Titre Supabase : « Étape de collab automatique »
-- ----------------------------------------------------------------------------
-- Pourquoi (audit du 27/11, point W20) : seuls l'écran Collabs et la file « À valider »
-- créaient la tâche de l'étape atteinte et passaient la collab « gagnée » à la dernière
-- étape. avancer_collab d'Alfred, modifier_element, les étapes automatiques et les posts du
-- créateur (collab_posts_advance) ne faisaient rien : aucune tâche des étapes 7 à 10 n'a
-- jamais existé.
--
-- Quoi :
--   1) collabs_step_gagnee (BEFORE UPDATE OF step) : étape 11 atteinte, collab « active »
--      → « gagnee » (comme patchEtape dans l'app).
--   2) collabs_step_task (AFTER UPDATE OF step, security definer) : quand l'étape monte,
--      collab ni perdue ni archivée, et réglage d'équipe « une tâche à chaque étape »
--      (collabAutoTasks du blob __app_state__ ; absent ou illisible = oui), la tâche de
--      l'étape atteinte, et seulement celle-là, comme l'app :
--        • textes et échéances : copie exacte de AUTO_TASKS (src/lib/collabLinks.ts).
--          Ne jamais changer l'un sans l'autre dans le même commit (un test le vérifie) ;
--        • {prenom} = premier mot du créateur de la collab (« Créatrice », première lettre en
--          majuscule), « le créateur » s'il n'y en a pas ; {marque} = la marque, « la marque »
--          si elle est vide ; échéance = date de Paris + N jours, au format AAAA-MM-JJ ;
--        • même anti-doublon que l'app (createStepTask, hasAutoTask) : rien si une tâche au
--          même texte (sans casse) existe pour cette collab, ou sans collab et pas faite ;
--        • tâche interne de l'agence (règle de Marc) : source 'agency', ni visible ni
--          demandée, reliée à la collab, étiquette CRÉATEUR (avec créateur) ou AGENCE.
--      Quand l'étape change dans la session d'un créateur (ses posts), le drapeau de
--      transaction ttp.auto_step fait passer la tâche sans la garde ni les repères du
--      créateur : elle reste interne et à l'agence.
--      Une erreur pendant la création de la tâche ne bloque jamais le changement d'étape :
--      elle laisse un avertissement dans le journal de Postgres (« collabs_step_task : … »),
--      pour qu'une panne qui revient se voie.
--   L'app garde createStepTask comme repli : après ce SQL, elle trouve la tâche de la base
--   et ne la double pas. Le contrôle du versement reste dans l'écran Collabs.
--   Attention : un rattrapage en SQL qui fait monter des étapes crée aussi leurs tâches.
--   Pour l'éviter, couper le réglage « une tâche à chaque étape » le temps du rattrapage.
--   Attention aussi, Alfred : sa fiche (agents/alfred/fiches/app.md, « Chaque avancée met
--   aussi la to-do à jour… ») lui dit encore de créer lui-même la tâche de l'étape. Tant
--   qu'elle n'est pas mise à jour (vague suivante), chaque avancer_collab peut donner deux
--   tâches pour la même étape : celle de la base et la sienne, au texte différent, que
--   l'anti-doublon ne rapproche pas. Mettre la fiche à jour juste après ce SQL (elle se
--   recharge seule la nuit), ou supprimer les doublons d'ici là.
--
-- Contrôle : la requête à la fin. Attendu : true · true · false
-- Relançable sans risque (create or replace, drop puis create des déclencheurs).
-- À lancer APRÈS 2026-11-27-taches-pour-createur.sql (le premier bloc le vérifie).
-- Pas encore dans SETUP.sql (à replier après la réécriture de SETUP.sql en cours).
-- ============================================================================

-- Le fichier des tâches doit être passé : la garde et les repères connaissent le drapeau.
do $$
begin
  if position('ttp.auto_step' in pg_get_functiondef('public.todos_creators_guard'::regproc)) = 0
     or position('ttp.auto_step' in pg_get_functiondef('public.todos_activity'::regproc)) = 0
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'todos' and column_name = 'pour_createur') then
    raise exception 'Lance d''abord 2026-11-27-taches-pour-createur.sql';
  end if;
end $$;

-- 1) « Gagnée » à la dernière étape ------------------------------------------------------
create or replace function public.collabs_step_gagnee() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if new.step >= 11 and new.step > old.step and new.status = 'active' then
    new.status := 'gagnee';
  end if;
  return new;
end $$;
drop trigger if exists collabs_step_gagnee on public.collabs;
create trigger collabs_step_gagnee before update of step on public.collabs
  for each row execute function public.collabs_step_gagnee();

-- 2) Tâche de l'étape atteinte -------------------------------------------------------------
create or replace function public.collabs_step_task() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_modele text; v_jours int; v_blob text; v_createur text; v_prenom text; v_marque text; v_texte text;
begin
  if new.step is null or old.step is null or new.step <= old.step then return new; end if;
  if coalesce(new.status, '') in ('perdue', 'archivee') then return new; end if;
  -- Copie exacte de AUTO_TASKS (src/lib/collabLinks.ts).
  select m.texte, m.jours into v_modele, v_jours
    from (values
      (2,  'Résumer le brief pour {prenom}', 1),
      (4,  'Relancer {prenom} pour le contenu', 3),
      (5,  'Envoyer le contenu à {marque} pour validation', 1),
      (6,  'Relever les stats à 7 jours', 7),
      (7,  'Créer la facture {marque}', 1),
      (8,  'Relancer {marque} pour le paiement', 30),
      (9,  'Reverser {prenom}', 3),
      (10, 'Préparer le bilan pour {marque}', 3)
    ) as m(etape, texte, jours)
   where m.etape = new.step;
  if v_modele is null then return new; end if;
  -- Réglage d'équipe collabAutoTasks : seul false l'arrête.
  begin
    select r.a into v_blob from public.module_rows r
     where r.module = '__app_state__' order by r.created_at desc limit 1;
    if position('"collabAutoTasks"' in coalesce(v_blob, '')) > 0
       and (v_blob::jsonb -> 'collabAutoTasks') = 'false'::jsonb then
      return new;
    end if;
  exception when others then
    null; -- blob illisible : réglage absent, donc oui
  end;
  begin
    v_createur := nullif(btrim(new.creator), '');
    -- Premier mot du créateur, comme firstNameOf (« CRÉATRICE A » → « Créatrice »).
    v_prenom := substring(coalesce(new.creator, '') from '\S+');
    v_prenom := case when coalesce(v_prenom, '') = '' then 'le créateur'
                     else upper(left(v_prenom, 1)) || lower(substr(v_prenom, 2)) end;
    v_marque := coalesce(nullif(btrim(new.brand), ''), 'la marque');
    v_texte := replace(replace(v_modele, '{prenom}', v_prenom), '{marque}', v_marque);
    -- Même anti-doublon que l'app.
    if exists (select 1 from public.todos t
                where lower(t.text) = lower(v_texte)
                  and (t.collab_id = new.id or (t.collab_id is null and not coalesce(t.done, false)))) then
      return new;
    end if;
    perform set_config('ttp.auto_step', '1', true);
    insert into public.todos (text, descr, due, creator, creators, tag, priority, source, status, done,
                              sort_order, collab_id, visible_createur, pour_createur)
    values (v_texte, null,
            to_char((now() at time zone 'Europe/Paris')::date + v_jours, 'YYYY-MM-DD'),
            v_createur,
            case when v_createur is null then '{}'::text[] else array[v_createur] end,
            case when v_createur is null then 'AGENCE' else 'CRÉATEUR' end,
            'moyenne', 'agency', 'À faire', false,
            floor(extract(epoch from now()))::int, new.id, false, false);
    perform set_config('ttp.auto_step', '', true);
  exception when others then
    perform set_config('ttp.auto_step', '', true);
    -- Pas de tâche, l'étape passe quand même ; la raison reste dans le journal de Postgres.
    raise warning 'collabs_step_task : tâche de l''étape % non créée pour la collab % (%)', new.step, new.id, sqlerrm;
  end;
  return new;
end $$;
revoke execute on function public.collabs_step_task() from public, anon, authenticated;
drop trigger if exists collabs_step_task on public.collabs;
create trigger collabs_step_task after update of step on public.collabs
  for each row execute function public.collabs_step_task();

-- Contrôle (une ligne). Attendu : true · true · false
select
  exists (select 1 from pg_trigger where tgname = 'collabs_step_gagnee' and not tgisinternal) as gagnee_ok,
  exists (select 1 from pg_trigger where tgname = 'collabs_step_task' and not tgisinternal) as tache_ok,
  has_function_privilege('authenticated', 'public.collabs_step_task()', 'execute') as connecte_peut_appeler;
