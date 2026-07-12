-- ============================================================================
-- 14-media-kit.sql
-- ----------------------------------------------------------------------------
-- Données du MEDIA KIT par créatrice.
--
-- La page de saisie « Media Kit » de l'app écrit TOUT le contenu du media kit
-- dans une seule colonne JSONB `creators.mediakit`. La vue `public_mediakit`
-- l'expose en ANONYME au site vitrine (ttpcreators.pro/mediakit/<slug>), qui la
-- lit en direct → remplir dans l'app met le site à jour automatiquement.
--
-- ⚠️ SÉCURITÉ : la vue est publique. Ne mettre AUCUNE donnée sensible dans le
-- blob mediakit (jamais email / téléphone / adresse / SIREN / CA / commission).
-- Uniquement du contenu de media kit destiné à être vu par les marques.
--
-- Forme du blob `creators.mediakit` (tout est optionnel) :
-- {
--   "slug": "candice",                       -- segment d'URL /mediakit/<slug>
--   "bio": "Deux phrases sur la créatrice…",
--   "tags": ["Lifestyle & Blogging", "Paris", "Audience 18–25"],
--   "audience": {
--     "age":     [{"label": "18–24 ans", "pct": 49}, {"label": "25–34 ans", "pct": 40}],
--     "gender":  {"femmes": 29, "hommes": 71},
--     "pays":    [{"name": "France", "pct": 77}, {"name": "Belgique", "pct": 4}],
--     "formats": [{"label": "Réels", "pct": 79}, {"label": "Story", "pct": 19}, {"label": "Publication", "pct": 2}]
--   },
--   "platforms": [
--     {"key": "instagram", "followers": "10,3K", "er": "0,89%", "ageBracket": "18–24",
--      "impressions30j": "1M", "nonFollowersPct": "90,5%", "bestFormatPct": "79,2%"},
--     {"key": "tiktok", "followers": "45,8K", "er": "11,24%", "ageBracket": "18–24",
--      "likesTotal": "1,7M", "views30j": "153,3K", "newViewers30j": "90,2K"}
--   ],
--   "brands": [{"name": "CertiDeal", "logo": null}, {"name": "waynabox", "logo": null}],
--   "photos": {"hero": null, "contact": null, "instagram": null, "tiktok": null}
-- }
--
-- À exécuter une fois sur la base live (SQL Editor).
-- ============================================================================

alter table public.creators add column if not exists mediakit jsonb;

-- Vue publique dédiée au media kit : n'expose QUE des champs publics + le blob
-- mediakit (contenu de media kit, non sensible). security_invoker=false → lit
-- creators avec les droits du propriétaire, mais la liste SELECT est volontairement
-- limitée (jamais de champ sensible ; ne PAS remplacer par select *).
create or replace view public.public_mediakit
with (security_invoker = false) as
  select
    name,
    handle,
    niche,
    platform,
    photo_url,
    sort_order,
    mediakit
  from public.creators
  where coalesce(status, 'actif') <> 'inactif';

grant select on public.public_mediakit to anon, authenticated;

-- Vérifier (déconnecté) :
--   select name, mediakit->>'slug' as slug from public.public_mediakit order by sort_order;
