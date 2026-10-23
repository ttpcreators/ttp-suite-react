-- ════════════════════════════════════════════════════════════════════════════
-- Titre Supabase : « Espace créateur · futures collabs (onglet En discussion) »
-- 2026-10-23 · Missions › « En discussion » : la créatrice voit les futures collabs qui la
-- concernent (table `prospects`, réservée à l'agence). On n'ouvre PAS la table : une
-- fonction `security definer` ne renvoie que des colonnes non sensibles (marque,
-- livrables, étape, date), seulement pour SES négociations pas encore devenues collab.
-- Jamais : montants (value, proposal), contact de la marque, notes.
--   • créatrice : toujours elle-même (my_creator(), le paramètre est ignoré) ;
--   • agence : la créatrice demandée (aperçu « Voir son espace ») ;
--   • sans compte : rien (exécution retirée à anon).
-- Relançable sans risque. L'app marche avant ce SQL (onglet vide, sans erreur).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.creator_discussions(p_creator text default null)
returns table (id uuid, brand text, deliverables text, stage text, created_at timestamptz)
  language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.brand, p.deliverables, p.stage, p.created_at
    from public.prospects p
   where p.collab_id is null
     and lower(btrim(coalesce(p.creator, ''))) <> ''
     and lower(btrim(p.creator)) = lower(btrim(
           case when public.is_agency() then coalesce(p_creator, '') else coalesce(public.my_creator(), '') end))
   order by p.created_at desc
   limit 50;
$$;
revoke all on function public.creator_discussions(text) from public, anon;
grant execute on function public.creator_discussions(text) to authenticated;

-- Contrôle : la fonction existe, anon ne peut pas l'exécuter (attendu : 1 et false).
select
  (select count(*) from pg_proc where proname = 'creator_discussions') as fonction_ok,
  has_function_privilege('anon', 'public.creator_discussions(text)', 'execute') as anon_peut_executer;
