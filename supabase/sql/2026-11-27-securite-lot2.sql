-- ============================================================================
-- 2026-11-27 · Sécurité, deuxième lot (suite de l'audit « 14 attaques »)
-- ----------------------------------------------------------------------------
-- Relançable sans risque. Aucun changement visible dans l'app.
--
-- 1. Bucket privé « documents » : 25 Mo au plus par fichier, comme les plus gros envois
--    de l'app (Documents, Media kit, pièces jointes d'Alfred). Les types restent libres :
--    les pièces jointes des tâches acceptent tout fichier et les contrats sont rangés en HTML.
-- 2. search_path fixé pour les 13 fonctions signalées par le contrôle de sécurité de
--    Supabase (« Function Search Path Mutable »). Elles n'utilisent que des fonctions de
--    base de Postgres ou des noms complets (public.events) : même résultat qu'avant.
-- 3. Les fonctions de déclencheur SECURITY DEFINER ne sont plus appelables par les comptes
--    connectés non plus (anon : déjà fait le 25/11). Un déclencheur ne vérifie pas ce
--    droit : tout continue de se déclencher comme avant.
--
-- Foldé dans SETUP.sql.
-- ============================================================================

-- 1. Bucket documents ----------------------------------------------------------
update storage.buckets set file_size_limit = 26214400 where id = 'documents';

-- 2. search_path des 13 fonctions --------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.invoices_no_delete()',
    'public.invoices_paid_at()',
    'public.brief_status_for_step(integer)',
    'public.collab_step_for_brief(text)',
    'public.touch_updated_at()',
    'public.touch_updated_at_simple()',
    'public.events_guard_delete()',
    'public.collabs_touch()',
    'public.activity_last_line(text)',
    'public.activity_new_subtask(jsonb, jsonb)',
    'agent.touch_maj()',
    'agent.est_marc(text)',
    'agent.nb_pieces(jsonb)'
  ] loop
    -- Certaines viennent d'autres scripts de sql/ : seulement celles qui existent.
    if to_regprocedure(f) is not null then
      execute format('alter function %s set search_path = public, pg_temp', f);
    end if;
  end loop;
end $$;

-- 3. Fonctions de déclencheur : plus d'appel direct par un compte connecté ------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and n.nspname in ('public', 'agent')
      and pg_get_function_result(p.oid) = 'trigger'
      and (has_function_privilege('authenticated', p.oid, 'execute')
           or has_function_privilege('anon', p.oid, 'execute'))
  loop
    execute format('revoke execute on function %s from anon, authenticated, public', f.sig);
  end loop;
end $$;

-- Contrôle (une ligne) : attendu « 26214400 · 0 · 0 »
select
  (select file_size_limit from storage.buckets where id = 'documents') as documents_limite,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'agent')
      and p.proname in ('invoices_no_delete', 'invoices_paid_at', 'brief_status_for_step', 'collab_step_for_brief',
                        'touch_updated_at', 'touch_updated_at_simple', 'events_guard_delete', 'collabs_touch',
                        'activity_last_line', 'activity_new_subtask', 'touch_maj', 'est_marc', 'nb_pieces')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) as sans_search_path,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and n.nspname in ('public', 'agent')
      and pg_get_function_result(p.oid) = 'trigger'
      and has_function_privilege('authenticated', p.oid, 'execute')) as declencheurs_appelables;
