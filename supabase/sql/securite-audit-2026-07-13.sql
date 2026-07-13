-- ============================================================================
-- Durcissement RLS — audit adversarial du 2026-07-13
-- ----------------------------------------------------------------------------
-- À exécuter UNE FOIS dans le SQL Editor Supabase (projet zizvggziggswhrbuyhuo).
-- Idempotent (drop if exists + recreate). Tout est déjà foldé dans SETUP.sql.
-- Motif de référence sûr = invoices : lecture large (peut inclure les lignes
-- agence partagées) MAIS écriture (INSERT/UPDATE/DELETE) réservée à
-- `is_agency() or <colonne> = my_creator()` — jamais une branche `creator is null`.
-- ============================================================================

-- 1) CONTACTS (HIGH) — la policy `for all` incluait `creator is null` dans le USING.
--    Comme DELETE n'applique pas le WITH CHECK, N'IMPORTE quel compte connecté
--    pouvait vider tout le carnet partagé de l'agence : DELETE ...?creator=is.null.
--    Un créateur pouvait aussi se réattribuer un contact agence (UPDATE creator=son nom).
drop policy if exists contacts_scoped on public.contacts;
drop policy if exists contacts_read   on public.contacts;
drop policy if exists contacts_write  on public.contacts;
create policy contacts_read  on public.contacts for select to authenticated
  using (public.is_agency() or creator is null or creator = public.my_creator());
create policy contacts_write on public.contacts for all to authenticated
  using (public.is_agency() or creator = public.my_creator())
  with check (public.is_agency() or creator = public.my_creator());

-- 2) MESSAGES (même faille que contacts) — `creator is null` (annonces globales)
--    était atteignable en écriture → suppression/hijack des annonces par tout compte.
drop policy if exists messages_scoped on public.messages;
drop policy if exists messages_read   on public.messages;
drop policy if exists messages_write  on public.messages;
create policy messages_read  on public.messages for select to authenticated
  using (public.is_agency() or creator = public.my_creator() or creator is null);
create policy messages_write on public.messages for all to authenticated
  using (public.is_agency() or creator = public.my_creator())
  with check (public.is_agency() or creator = public.my_creator());

-- 3) CREATORS (MEDIUM) — creators_guard est BEFORE UPDATE seulement, donc un créateur
--    pouvait FORGER à l'INSERT une fiche à son nom avec ca/commission/status/exclu/
--    sort_order arbitraires (et supprimer sa propre fiche). On scinde : lecture + UPDATE
--    ouverts au créateur (colonnes sensibles toujours verrouillées par creators_guard),
--    mais INSERT et DELETE réservés à l'agence.
drop policy if exists creators_scoped          on public.creators;
drop policy if exists creators_read            on public.creators;
drop policy if exists creators_creator_update  on public.creators;
drop policy if exists creators_agency_insert   on public.creators;
drop policy if exists creators_agency_delete   on public.creators;
create policy creators_read           on public.creators for select to authenticated
  using (public.is_agency() or name = public.my_creator());
create policy creators_creator_update on public.creators for update to authenticated
  using (public.is_agency() or name = public.my_creator())
  with check (public.is_agency() or name = public.my_creator());
create policy creators_agency_insert  on public.creators for insert to authenticated
  with check (public.is_agency());
create policy creators_agency_delete  on public.creators for delete to authenticated
  using (public.is_agency());

-- 4) EVENTS (MEDIUM) — le USING `my_creator() = any(who)` autorisait un créateur à
--    SUPPRIMER un évènement multi-créateurs (who = "A, B") où son nom figure — et
--    via events_guard_delete, à PROPAGER la suppression à l'agenda Google. On garde
--    la LECTURE par appartenance à la liste, mais on réserve l'écriture/suppression
--    aux évènements qui le concernent LUI SEUL (who = son nom, strict).
drop policy if exists events_scoped on public.events;
drop policy if exists events_read   on public.events;
drop policy if exists events_write  on public.events;
create policy events_read  on public.events for select to authenticated
  using (public.is_agency() or public.my_creator() = any(string_to_array(coalesce(who,''), ', ')));
create policy events_write on public.events for all to authenticated
  using (public.is_agency() or who = public.my_creator())
  with check (public.is_agency() or who = public.my_creator());

-- 5) PROMOTION AGENCE (HIGH, latent) — la section 4 promeut en 'agency' tout compte
--    dont l'email est dans une liste codée en dur, en matchant la CHAÎNE email. Le
--    placeholder 'agence@ttp.com' (domaine NON possédé) était squattable via signup
--    public : si SETUP.sql est relancé, un tel compte devient agence. On retire le
--    placeholder et on exige un email confirmé. (Bootstrap réel = admin-role-agence.sql
--    par user_id.) La désactivation du signup public ferme le vecteur immédiat.
--    -> Rien à réappliquer ici sur des comptes existants ; la correction vit dans
--    SETUP.sql (section 4). Aucune promotion n'est retirée par ce fichier.

-- NOTE hors-SQL (à faire dans le dashboard) :
--   • Authentication → « Allow new users to sign up » = OFF (obligatoire : ferme
--     l'usurpation par signup ET empêche un compte auto-inscrit de lire les contacts
--     partagés / annonces globales). La création de comptes passe par create-access.
--   • Storage → bucket `avatars` : fixer une taille max de fichier + types autorisés
--     (image/*) pour couper l'abus d'hébergement (finding LOW, non bloquant).
