-- Sécurité : verrouille les colonnes « agence » de la table creators
-- ---------------------------------------------------------------------------
-- Contexte : la policy `creators_scoped` est `for all to authenticated`, ce qui
-- laisse un créateur écrire SA propre fiche. Via l'UI ce n'est pas un problème
-- (aucun champ sensible n'est éditable), mais via un appel API direct (le créateur
-- possède une session authentifiée + la clé anon), il pourrait modifier des colonnes
-- qui ne le regardent pas : ca (CA, calculé depuis les factures), commission, status
-- (actif/inactif), exclu (exclusivité), sort_order (ordre du roster côté agence).
-- Même logique que pour invoices : on ferme le trou côté BASE, pas seulement côté UI.
--
-- Ce trigger BEFORE UPDATE force ces colonnes à conserver leur ANCIENNE valeur quand
-- l'auteur n'est pas l'agence. L'agence n'est jamais affectée ; les éditions légitimes
-- du créateur (coordonnées, réseaux, followers/ER/reach, bio, media kit…) passent
-- normalement. Idempotent (create or replace + drop if exists) et réversible
-- (`drop trigger creators_guard_upd on public.creators;`).
--
-- À exécuter UNE FOIS dans le SQL Editor du dashboard Supabase (projet
-- zizvggziggswhrbuyhuo). Déjà foldé dans SETUP.sql pour les futures installations.

create or replace function public.creators_guard() returns trigger
  language plpgsql security definer as $$
begin
  if not public.is_agency() then
    new.ca         := old.ca;
    new.commission := old.commission;
    new.status     := old.status;
    new.exclu      := old.exclu;
    new.sort_order := old.sort_order;
  end if;
  return new;
end $$;

drop trigger if exists creators_guard_upd on public.creators;
create trigger creators_guard_upd before update on public.creators
  for each row execute function public.creators_guard();
