-- TITRE : TTP Suite · Dispos du mois pour les agences (2026-11-22)
-- ============================================================================
-- Stratégie de Gianni (20/11/2026, « Les agences : notre premier canal ») : le 1er de chaque
-- mois, les agences reçoivent un lien vers les créateurs disponibles, leurs chiffres à jour,
-- un prix agence indicatif et les catégories prises en exclusivité (jamais la marque).
-- On réutilise les listes de la Base créateurs et la page ttpcreators.pro/selection/ :
--   1. creator_lists.dispos : la sélection du mois (calculée par l'app, l'outil Claude
--      `dispos_du_mois` ou la fonction `dispos-du-mois`), seulement des données publiables ;
--   2. la vue anonyme public_creator_lists expose aussi `dispos` (colonne ajoutée à la fin) ;
--   3. cron « dispos-du-mois » : le 1er du mois à 6 h 45 UTC, après les relevés du matin
--      (ig-sync 5 h 20, tt-sync 6 h, yt-sync 6 h 15). Le secret des crons est repris d'un
--      cron existant : rien à coller.
-- ORDRE : ce SQL peut être lancé avant ou après `supabase functions deploy dispos-du-mois` ;
-- tant que la fonction n'est pas déployée, l'appel du 1er échoue sans rien casser.
-- Relançable sans risque. Contrôle en fin de fichier.
-- ============================================================================

-- 1) La sélection du mois ------------------------------------------------------------
alter table public.creator_lists add column if not exists dispos jsonb;

-- 2) Vue publique : mêmes colonnes qu'avant, `dispos` en plus à la fin ----------------
create or replace view public.public_creator_lists
with (security_invoker = false) as
  select l.slug, l.title, l.brand, l.intro, l.updated_at,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'username',  p.username,
                    'name',      p.data->>'name',
                    'followers', nullif(p.data->>'followers', '')::numeric,
                    'er',        nullif(p.data->>'er', '')::numeric,
                    'perWeek',   nullif(p.data->>'perWeek', '')::numeric,
                    'picture',   p.data->>'picture',
                    'niche',     m.niche,
                    'ville',     m.ville)
                  order by array_position(l.usernames, p.username))
           from public.ig_profiles p
           left join public.creator_base_meta m on m.username = p.username
           where p.username = any(l.usernames) and coalesce(m.excluded, false) = false
         ), '[]'::jsonb) as creators,
         l.dispos
  from public.creator_lists l
  where l.public;
grant select on public.public_creator_lists to anon, authenticated;
revoke insert, update, delete, truncate on public.public_creator_lists from anon, authenticated, public;

-- 3) Cron du 1er du mois --------------------------------------------------------------
do $do$
declare v_secret text;
begin
  select substring(command from 'Bearer ([^'']+)') into v_secret
    from cron.job
   where (jobname = 'ig-sync-quotidien' or jobname = 'tt-sync-quotidien' or command like '%functions/v1/gmail-%') and command like '%Bearer %'
   order by (jobname = 'tt-sync-quotidien') desc, jobid limit 1;
  if v_secret is null or v_secret like 'REMPLACE_MOI%' then
    raise notice 'Secret des crons introuvable : cron dispos-du-mois NON planifié.';
    return;
  end if;
  perform cron.unschedule('dispos-du-mois') where exists (select 1 from cron.job where jobname = 'dispos-du-mois');
  perform cron.schedule('dispos-du-mois', '45 6 1 * *', format($cmd$
    select net.http_post(
      url := 'https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/dispos-du-mois',
      headers := jsonb_build_object('Authorization', 'Bearer %s', 'Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cmd$, v_secret));
end $do$;

-- Contrôle : colonne_1 = 1 · vue_dispos_1 = 1, puis dispos-du-mois · 45 6 1 * * · true.
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'creator_lists' and column_name = 'dispos') as colonne_1,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'public_creator_lists' and column_name = 'dispos') as vue_dispos_1;
select jobname, schedule, active from cron.job where jobname = 'dispos-du-mois';
