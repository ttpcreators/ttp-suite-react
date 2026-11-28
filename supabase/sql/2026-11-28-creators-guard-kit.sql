-- ============================================================================
-- 2026-11-28 · Media kit : le créateur ne touche plus aux chiffres qui fixent les prix ni à
-- son kit public ; sa photo vient seulement du stockage de l'agence
-- Titre Supabase : « Garde du media kit »
-- ----------------------------------------------------------------------------
-- Pourquoi (audit des 14 attaques du 28/11, points 4 et 11) : par un appel direct à l'API, un
-- créateur pouvait écrire sa niche (coefficient de la calculette), sa plateforme et tout son
-- media kit (vues, audience, adresse publique /mediakit/<slug>/, marques, photos, captures).
-- Ce sont les entrées de la calculette de prix de l'agence et ce que les marques lisent sur
-- le site. Il pouvait aussi mettre dans photo_url une adresse extérieure, recopiée telle
-- quelle par les pages du site. L'espace créateur n'écrit jamais ces champs : seule la
-- photo de profil, envoyée dans le bucket public avatars (avatar-upload.tsx).
--
-- Quoi :
--   1) creators_guard, pour un compte créateur connecté : la valeur d'avant est remise (sans
--      erreur) pour niche, platform et tout mediakit, en plus des colonnes déjà gardées (ca,
--      commission, status, exclu, sort_order, stats_month). Le bloc des 4 clés de tarifs du
--      kit devient inutile : tout le kit reste à l'agence. photo_url : seulement une adresse
--      publique du bucket avatars du projet (dossiers et nom de fichier sans « .. » ni « % »),
--      ou rien ; sinon la photo d'avant reste. L'agence et le serveur (sans compte connecté)
--      ne changent pas.
--   2) creators_infos_activity : l'agence reçoit aussi un repère quand le créateur change ses
--      abonnés, son engagement ou sa portée (followers, er, reach : formulaire « Mes infos »,
--      entrées de repli de la calculette). niche et platform ne sont plus modifiables par lui.
--
-- Avant ce SQL, l'app marche comme aujourd'hui ; après, l'espace créateur aussi (il n'écrit
-- que ses infos et sa photo du bucket avatars).
-- Contrôle : la requête à la fin. Attendu : true · true · true · false · false
-- Puis l'essai annulé du bas (compte de test ZZZ seulement) : niche, kit, slug et photo
-- extérieure restent inchangés, abonnés changés.
-- Relançable sans risque (create or replace).
-- Pas encore dans SETUP.sql (à replier avec 2026-11-27-reperes-depots-infos.sql, qui y manque
-- aussi). Après ce SQL, ne plus relancer 2026-11-27-reperes-depots-infos.sql ni
-- 2026-11-27-securite-14.sql (ni un ancien fichier qui redéfinit creators_guard ou
-- creators_infos_activity) : la garde y perd le kit et la photo, sans aucune erreur.
-- ============================================================================

-- 1) Garde de la fiche ----------------------------------------------------------------------
create or replace function public.creators_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.is_agency() then
    new.ca          := old.ca;
    new.commission  := old.commission;
    new.status      := old.status;
    new.exclu       := old.exclu;
    new.sort_order  := old.sort_order;
    new.stats_month := old.stats_month;
    -- Entrées de la calculette de prix et kit public (tarifs, vues, audience, adresse,
    -- marques, photos) : à l'agence.
    new.niche       := old.niche;
    new.platform    := old.platform;
    new.mediakit    := old.mediakit;
    -- Photo : une adresse publique du bucket avatars de ce projet, ou rien.
    if new.photo_url is distinct from old.photo_url
       and nullif(btrim(new.photo_url), '') is not null
       and new.photo_url !~ '^https://zizvggziggswhrbuyhuo\.supabase\.co/storage/v1/object/public/avatars/([A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+\.[A-Za-z0-9]+$' then
      new.photo_url := old.photo_url;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.creators_guard() from public, anon, authenticated;
-- Le déclencheur creators_guard_upd (before update) ne change pas.

-- 2) Repère de l'agence : abonnés, engagement et portée en plus ---------------------------
create or replace function public.creators_infos_activity() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  -- Colonne suivie, puis son nom affiché. Jamais la valeur.
  champs constant text[][] := array[
    array['address', 'adresse'], array['ville', 'ville'], array['siren', 'SIREN'],
    array['email', 'email'], array['email_pro', 'email pro'], array['phone', 'téléphone'],
    array['birth', 'date de naissance'], array['instagram', 'Instagram'], array['tiktok', 'TikTok'],
    array['followers', 'abonnés'], array['er', 'engagement'], array['reach', 'portée']];
  n jsonb; o jsonb; deja text[]; liste text[] := '{}'; change boolean := false; i int;
begin
  begin
    if public.activity_actor() is distinct from 'creator' then return new; end if;
    n := to_jsonb(new);
    o := to_jsonb(old);
    -- Champs déjà signalés et pas encore lus : on les garde dans le détail.
    select coalesce(array_agg(btrim(x)), '{}') into deja
      from public.activity_events e, unnest(string_to_array(coalesce(e.excerpt, ''), ',')) x
     where e.target = 'agency' and e.object_type = 'creator' and e.object_id = new.id::text and e.read_at is null;
    for i in 1 .. array_length(champs, 1) loop
      if nullif(btrim(n->>champs[i][1]), '') is distinct from nullif(btrim(o->>champs[i][1]), '') then
        change := true;
        liste := liste || champs[i][2];
      elsif champs[i][2] = any (deja) then
        liste := liste || champs[i][2];
      end if;
    end loop;
    if not change then return new; end if;
    perform public.log_activity_event('agency', coalesce(public.my_creator(), new.name), 'creator', new.id::text,
      new.name, 'update', public.activity_actor_name(), array_to_string(liste, ', '));
  exception when others then
    null; -- jamais bloquant : la fiche s'enregistre toujours
  end;
  return new;
end $$;
revoke execute on function public.creators_infos_activity() from public, anon, authenticated;

-- Contrôle (une ligne). Attendu : true · true · true · false · false
select
  position('new.mediakit    := old.mediakit' in pg_get_functiondef('public.creators_guard'::regproc)) > 0
    and position('new.niche' in pg_get_functiondef('public.creators_guard'::regproc)) > 0 as kit_garde,
  position('object/public/avatars' in pg_get_functiondef('public.creators_guard'::regproc)) > 0
    and position('stats_month' in pg_get_functiondef('public.creators_guard'::regproc)) > 0 as photo_et_stats,
  position('''followers''' in pg_get_functiondef('public.creators_infos_activity'::regproc)) > 0 as abonnes_suivis,
  has_function_privilege('authenticated', 'public.creators_guard()', 'execute') as garde_appelable,
  has_function_privilege('authenticated', 'public.creators_infos_activity()', 'execute') as infos_appelable;

-- Essai annulé (facultatif, compte de test ZZZ seulement : remplacer les deux marqueurs).
-- Attendu : la niche, le slug et la photo restent ceux d'avant ; followers vaut '123'.
-- begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<uuid du compte de test ZZZ>","role":"authenticated"}', true);
--   update public.creators
--      set niche = 'luxe', followers = '123', mediakit = jsonb_build_object('slug', 'essai-garde'),
--          photo_url = 'https://exemple.invalid/a.png'
--    where name = '<nom de la fiche de test ZZZ>';
--   select niche, followers, mediakit->>'slug' as slug, photo_url from public.creators where name = '<nom de la fiche de test ZZZ>';
-- rollback;
