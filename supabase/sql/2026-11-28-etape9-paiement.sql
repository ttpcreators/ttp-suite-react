-- ============================================================================
-- 2026-11-28 · Étape 9 « Paiement marque reçu » sans facture payée : vérifier le paiement
-- avant de reverser
-- Titre Supabase : « Étape 9 sans paiement »
-- ----------------------------------------------------------------------------
-- Pourquoi (audit des 14 attaques du 28/11, équipe « argent », contre-vérifié) : la tâche
-- « Reverser <prénom> » de l'étape 9 suit le statut des factures de la collab, pas seulement
-- son étape (avancer_collab, modifier_element ou l'écran Collabs peuvent poser l'étape 9).
--
-- Quoi : collabs_step_task (copie de la version en prod, 2026-11-27-etape-collab-auto.sql,
-- relue en base le 28/11). À l'étape 9 seulement :
--   • une facture de la collab est « payee », ou la collab est en mode « createur »
--     (collabCashMode : la marque paie le créateur) : « Reverser <prénom> », comme avant ;
--   • sinon : « Vérifier le paiement de <marque> » (échéance J+3), même tâche interne de
--     l'agence, même anti-doublon. Blob ou factures illisibles : « Vérifier », jamais
--     « Reverser » à l'aveugle.
--   Les autres étapes ne changent pas. L'app (createStepTask, src/lib/collabLinksDb.ts)
--   reconnaît les deux textes comme la tâche de l'étape 9 et n'en crée pas une seconde ; elle
--   marche avant et après ce SQL. Un test (src/lib/collabStepSql.test.ts) vérifie que les
--   textes de ce fichier restent ceux de l'app.
--   Facture payée qui fait avancer la collab (apresFacturePayee, _shared/collabAutoDb.ts) :
--   si la facture n'était pas encore liée, le lien est écrit avant l'avance, et l'app crée
--   « Reverser » même si « Vérifier » est déjà là (paiement reçu).
--   Limite : si ce déclencheur ne pose aucune tâche (insertion en échec, notée en warning, ou
--   collab perdue ou archivée), l'app crée « Reverser » à l'étape 9 sans relire les factures.
--
-- Contrôle : la requête à la fin. Attendu : true · true · false
-- Relançable sans risque (create or replace). Le déclencheur collabs_step_task ne change pas.
-- À lancer APRÈS 2026-11-27-etape-collab-auto.sql (le premier bloc le vérifie).
-- Pas encore dans SETUP.sql (à replier avec la vague du 27/11). Après ce SQL, ne plus
-- relancer 2026-11-27-etape-collab-auto.sql : l'étape 9 y redevient « Reverser » sans
-- condition, sans aucune erreur.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'collabs_step_task' and not tgisinternal) then
    raise exception 'Lance d''abord 2026-11-27-etape-collab-auto.sql';
  end if;
end $$;

create or replace function public.collabs_step_task() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_modele text; v_jours int; v_blob text; v_finance text; v_paye boolean; v_createur text; v_prenom text; v_marque text; v_texte text;
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
  -- Étape 9 « Paiement marque reçu » : « Reverser » seulement si une facture de la collab est
  -- payée, ou si la marque paie le créateur (collabCashMode « createur », lu dans la ligne
  -- argent puis dans la ligne commune, comme l'app). Sinon : vérifier le paiement de la marque.
  -- Texte et échéance : copie exacte de VERIF_PAIEMENT (src/lib/collabLinks.ts).
  if new.step = 9 then
    begin
      v_paye := exists (select 1 from public.invoices i where i.collab_id = new.id and i.status = 'payee');
      if not v_paye then
        select r.a into v_finance from public.module_rows r
         where r.module = '__finance_state__' order by r.created_at desc limit 1;
        select r.a into v_blob from public.module_rows r
         where r.module = '__app_state__' order by r.created_at desc limit 1;
        v_paye := coalesce(nullif(v_finance, '')::jsonb -> 'collabCashMode' ->> new.id::text,
                           nullif(v_blob, '')::jsonb -> 'collabCashMode' ->> new.id::text) = 'createur';
      end if;
    exception when others then
      v_paye := false; -- lecture impossible : on fait vérifier, jamais reverser à l'aveugle
    end;
    if not coalesce(v_paye, false) then
      v_modele := 'Vérifier le paiement de {marque}';
      v_jours := 3;
    end if;
    v_blob := null;
  end if;
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

-- Contrôle (une ligne). Attendu : true · true · false
select
  position('Vérifier le paiement de {marque}' in pg_get_functiondef('public.collabs_step_task'::regproc)) > 0 as etape9_ok,
  exists (select 1 from pg_trigger where tgname = 'collabs_step_task' and not tgisinternal) as tache_ok,
  has_function_privilege('authenticated', 'public.collabs_step_task()', 'execute') as connecte_peut_appeler;
