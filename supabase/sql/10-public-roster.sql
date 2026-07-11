-- ============================================================================
-- 10-public-roster.sql
-- ----------------------------------------------------------------------------
-- Vue PUBLIQUE du roster pour le site vitrine (websitettpcreators), qui la lit
-- en anonyme. La table `creators` est privée (RLS `to authenticated`), donc le
-- site ne peut pas la lire directement : cette vue n'expose QUE des colonnes
-- publiques et se lit sans authentification.
--
-- security_invoker=false (définer) → la vue lit `creators` avec les droits de
-- son propriétaire, en contournant la RLS, MAIS ne renvoie que des champs
-- publics (nom, handle, niche, plateforme, photo). Aucune donnée sensible
-- (email, tel, SIREN, CA…) n'est exposée.
--
-- À exécuter sur la NOUVELLE base (zizvggziggswhrbuyhuo).
-- ============================================================================

create or replace view public.public_roster
with (security_invoker = false) as
  select name, handle, niche, platform, photo_url, sort_order
  from public.creators
  where coalesce(status, 'actif') <> 'inactif';

grant select on public.public_roster to anon, authenticated;

-- Vérifier : select * from public.public_roster order by sort_order;
