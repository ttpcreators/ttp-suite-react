# 📒 Suivi des migrations SQL — TTP Suite

Chaque fichier = **une migration** lancée à la main dans le **SQL Editor de Supabase**
(projet `zizvggziggswhrbuyhuo`). Même nom que la requête enregistrée côté Supabase →
tu retrouves tout d'un coup d'œil, et c'est **versionné dans Git**.

> **Base du schéma** : le schéma complet (tables, fonctions, rôle agence, RLS de base,
> Storage) vit dans [`../SETUP.sql`](../SETUP.sql) — c'est **la source de vérité**, à
> relancer si tu dois tout recréer. Les fichiers ci-dessous sont les **ajouts/correctifs**
> appliqués par-dessus. Tout correctif est TOUJOURS foldé dans `SETUP.sql` *et* déposé
> comme fichier daté ici.

---

## 🚦 État d'application en prod — dernière MAJ : **2026-07-15**

> **Pour un nouvel assistant / une nouvelle session** : ce tableau est la reprise en main.
> `✅ Appliqué` = déjà lancé sur la base live. `⏳ À faire` = écrit + commité mais **pas
> encore appliqué en prod** (l'agent ne peut pas toucher la prod : DDL, réglages dashboard
> et déploiement de fonctions passent par l'utilisateur). Mettre ce tableau à jour à CHAQUE
> changement. Contexte détaillé aussi dans la mémoire `ttp-security-todo`.

| Correctif | Fichier / Action | Statut prod | Vérifié |
|---|---|---|---|
| Verrou colonnes agence de `creators` (trigger `creators_guard`) | [`securite-creators-colonnes-agence.sql`](securite-creators-colonnes-agence.sql) | ✅ Appliqué (2026-07-13) | ✅ testé live 11/11 (PATCH + upsert bloqués) |
| Anti-usurpation d'identité au signup (`handle_new_user` → creator_name NULL) | [`securite-signup-creator-name.sql`](securite-signup-creator-name.sql) | ✅ Appliqué (2026-07-13) | ✅ `my_creator()`=NULL sur signup injecté |
| Audit RLS : `contacts` / `messages` / `creators` (INSERT/DELETE agence) / `events` + section 4 | [`securite-audit-2026-07-13.sql`](securite-audit-2026-07-13.sql) | ✅ Appliqué (2026-07-13) | ✅ INSERT creators = 403 ; contacts→null = 403 |
| Désactiver l'**inscription publique** (défense en profondeur : bloque les comptes auto-inscrits qui lisent contacts partagés/annonces + le spam) | Dashboard → Authentication → *Allow new users to sign up* = **OFF** | ✅ Fait (2026-07-13) | ✅ signup = HTTP 422 « Signups not allowed » ; login existant = 200 |
| Déployer les edge functions corrigées | `supabase functions deploy report-error daily-digest create-access --project-ref zizvggziggswhrbuyhuo` | ✅ Déployé (2026-07-13) | ✅ report-error 400 « empty » ; create-access 401 sans auth |
| Limite taille/type du bucket `avatars` (anti-abus hébergement, LOW) | Dashboard → Storage → avatars (max size + `image/*`) | ⏳ optionnel | — |
| **Media kit agence** : table singleton `agency_mediakit` + vue anon `public_agency_mediakit` (contenu éditable du deck agence) | [`media-kit-agence.sql`](media-kit-agence.sql) | ✅ Appliqué (2026-07-15) | ✅ vue anon = HTTP 200 (1 ligne `data`) ; éditeur charge + enregistre |
| **Gifting** : table `gifting` (cadeaux/dotations créateurs) + RLS motif `briefs` (agence + créateur sur ses lignes) | [`gifting.sql`](gifting.sql) | ✅ Appliqué (2026-07-18) | ✅ anon : SELECT = 200 `[]` (scoppé) ; INSERT = 401 `42501` (RLS écriture) |
| **Dépôt de facture par le créateur** : INSERT `documents` + storage limités à `creator-uploads/<auth.uid()>/…` (la contrainte de chemin ferme la fuite inter-créateurs) | [`creator-depot-facture.sql`](creator-depot-facture.sql) | ✅ Appliqué (2026-07-19) | ✅ anon : SELECT `documents` = 200 `[]` ; INSERT = 401 `42501` ; upload storage dans `creator-uploads/…` = 403 RLS. ⚠️ Le chemin côté créateur AUTHENTIFIÉ (peut déposer chez lui / pas chez une autre) n'est **pas** testable sans un login créatrice — à valider par un dépôt réel. |
| **Tâches : sous-tâches + pièces jointes** : colonnes `todos.subtasks` + `todos.attachments` (jsonb) | [`todos-subtasks-attachments.sql`](todos-subtasks-attachments.sql) | ✅ Appliqué (2026-08-04) | ✅ anon : `select=subtasks,attachments` = 200 (colonnes présentes, RLS filtre). ⚠️ upload pièces jointes (bucket documents, chemin `todo-attachments/…`) non testé sans login agence — à valider par un vrai ajout. |
| **Idées : sous-tâches** : colonne `ideas.subtasks` (jsonb) — checklist repliable sur chaque idée (agence + créateur, RLS `ideas` existante) | [`ideas-subtasks.sql`](ideas-subtasks.sql) | ✅ Appliqué (2026-08-05) | ✅ anon : `select=subtasks` sur `ideas` = 200 `[]` (colonne présente, RLS filtre) ; colonne bidon = 400 `42703` (contrôle négatif). ⚠️ écriture réelle (cocher/ajouter une sous-tâche) non testée sans login — à valider par un vrai clic. |
| **Contacts : dernier contact** : colonne `contacts.last_contacted` (timestamptz) — anti sur-contact (MàJ auto à l'envoi + réconciliation Gmail) | [`contacts-last-contacted.sql`](contacts-last-contacted.sql) | ✅ Appliqué (2026-08-12) | ✅ anon : `select=last_contacted` sur `contacts` = 200 ; colonne bidon = 400 (contrôle négatif). ⚠️ MàJ réelle (envoi mail / ouverture fiche) non testée sans login agence. |
| **Briefs : PDF joint** : colonne `briefs.pdf` (jsonb) — PDF uploadé + ligne `documents` (type brief) → visible Docs + portail créateur | [`briefs-pdf.sql`](briefs-pdf.sql) | ✅ Appliqué (2026-08-12) | ✅ anon : `select=pdf` sur `briefs` = 200. ⚠️ upload PDF réel + apparition Docs/portail non testés sans login agence — à valider par un vrai ajout. |
| **Vivier créateurs** : table `creator_pool` (nom, handle, email, tag, note, last_contacted) — répertoire de créateurs hors roster à solliciter, RLS **agence-only** | [`creator-pool.sql`](creator-pool.sql) | ✅ Appliqué (2026-08-25) | ✅ anon : SELECT = 200 `[]` (RLS filtre) ; INSERT = 401 (écriture agence-only) ; colonne bidon = 400 (contrôle négatif). |
| **Feuille de route partagée** : table `creator_roadmap` (agence écrit `roadmap` ↔ créateur lit + reporte sa cadence dans `self_cadence`) + trigger `creator_roadmap_guard` (le créateur ne peut pas modifier sa feuille de route) | [`creator-roadmap.sql`](creator-roadmap.sql) | ✅ Appliqué (2026-07-28) | ✅ anon : SELECT = 200 `[]` (RLS filtre tout) ; INSERT = 401 `42501` (écriture refusée). ⚠️ Le verrou `roadmap` côté créateur AUTHENTIFIÉ (lit sa feuille, ne peut pas la réécrire, écrit `self_cadence`) n'est pas testable sans login créateur — à valider par un report réel. |
| **Rôles agence fondateur/membre** : colonne `profiles.agency_role` + fonction `is_founder()` + RLS `invoices` réservé aux fondateurs (membre = tout sauf Finance & Accès). | [`2026-09-08-agency-roles.sql`](2026-09-08-agency-roles.sql) | ✅ Appliqué (2026-09-08) | ✅ anon : `select=agency_role` sur `profiles` = 200 (colonne présente) ; colonne bidon = 400 (contrôle négatif) ; `invoices` = 200 `[]` (RLS `is_founder` filtre) ; RPC `is_founder()` = `false` en anon. ⚠️ Test membre réel (Finance/Accès masqués + `invoices` vide) à faire avec un vrai login membre. |
| **Contacts : @Instagram + Ville** : colonnes `contacts.instagram` + `contacts.city` (fiches marques) | [`2026-09-08-contacts-instagram-city.sql`](2026-09-08-contacts-instagram-city.sql) | ✅ Appliqué (2026-09-08) | ✅ anon : `select=instagram,city` = 200 (colonnes présentes) ; colonne bidon = 400 (contrôle négatif). |
| **↳ Redéployer `create-access`** (réservé aux fondateurs + enregistre `agency_role` du nouveau compte) | `supabase functions deploy create-access --project-ref zizvggziggswhrbuyhuo` (⚠️ **Terminal**, pas SQL Editor) | ✅ Déployé (2026-09-08) | ✅ POST en anon = **401 `unauthorized`** (gate fondateur actif). Création réelle d'un membre depuis un compte fondateur : à valider par un vrai ajout. |
| **Collabs (Agent · Phase 2)** : tables `collabs` (étape courante 1 à 11) + `collab_steps` (historique daté par trigger `collabs_log_step`) — cycle de vie complet des collaborations, socle de l'agent IA. RLS motif `briefs` (agence + créatrice sur ses lignes). | [`2026-09-27-collabs.sql`](2026-09-27-collabs.sql) | ✅ Appliqué (2026-09-27) | ✅ anon : SELECT `collabs`/`collab_steps` = 200 `[]` (RLS filtre) ; INSERT `collabs` = 401 `42501` ; colonne bidon = 400 `42703` (contrôle négatif). ⚠️ Trigger de journalisation (`collab_steps` daté à chaque changement d'étape) à valider par une vraie collab côté agence. |
| **Agent · Phase 5 — rôle `ttp_agent`** : rôle Postgres de l'agent (login, mot de passe HORS dépôt, connection limit 5, timeouts) — SELECT sur `agent_lecture`, SELECT/INSERT/UPDATE sans DELETE sur `agent` (+ policies dédiées), rien sur `public`/`auth`. | [`2026-09-27-agent-role.sql`](2026-09-27-agent-role.sql) (remplacer `REMPLACE_MOI` par le mdp, ne pas l'enregistrer côté Supabase) | ✅ Appliqué (2026-09-27) | ✅ **12/12 en connexion RÉELLE ttp_agent** (accès direct `db.<ref>.supabase.co:5432`, PG 17.6) : vues `agent_lecture` lisibles ; INSERT/UPDATE `agent.journal` OK ; `public.creators` / `module_rows` / `auth.users` / DELETE / CREATE TABLE = 42501 ; colonne `birth` = 42703 ; catégorie mémoire interdite = 23514. Chaîne de connexion remise à Marc hors dépôt. ⚠️ Pooler : `ttp_agent.<ref>` non reconnu sur les régions testées → utiliser l'accès direct. |
| **↳ Tests de sécurité du rôle** (rejouables) : `grant ttp_agent to postgres` + 11 tests en `SET LOCAL ROLE ttp_agent` (résultats en NOTICE). | [`2026-09-27-agent-role-tests.sql`](2026-09-27-agent-role-tests.sql) | ✅ Joué (2026-09-27) | ✅ Confirmé par la connexion réelle ci-dessus (traces `test_securite_phase5` dans `agent.journal`, non supprimables par l'agent — par design). |
| **Agent · Phase 4 — schéma `agent`** : les 7 tables où l'agent écrit (`cockpits`, `actions`, `prospects`, `cercle`, `memoire_createurs` à catégories fermées, `lecons`, `journal`) + RLS agence pour l'app + grants authenticated. ⚠️ Étape dashboard associée : Settings → API → Exposed schemas → ajouter `agent` (JAMAIS `agent_lecture`). | [`2026-09-27-agent-schema.sql`](2026-09-27-agent-schema.sql) | ✅ SQL appliqué (2026-09-27) · ✅ Exposed schemas fait (2026-09-27) | ✅ anon : `agent` exposé mais « permission denied » 42501 (lecture ET écriture) ; `agent_lecture` toujours non exposé (406 `PGRST106`, l'API annonce « public, graphql_public, agent ») ; `public` intact. Tables vérifiées par les tests Phase 5 (12/12). |
| **Agent · Phase 3 — schéma `agent_lecture`** : 11 vues en lecture seule pour l'agent (créatrices PRO, collabs + étapes datées, briefs, planning, échéances et reversements extraits du blob SANS montants, factures sans montant, contacts marques, prospection, scouting). Aucun droit accordé (schéma inerte jusqu'à la Phase 5, revoke anon/authenticated explicite). | [`2026-09-27-agent-lecture.sql`](2026-09-27-agent-lecture.sql) | ✅ Appliqué (2026-09-27) | ✅ anon : `creatrices` côté public = 404 `PGRST205` ; `Accept-Profile: agent_lecture` = 406 `PGRST106` (« Only the following schemas are exposed: public, graphql_public ») ; contrôle positif `collabs` public = 200. ⚠️ Contenu des vues à valider en SQL Editor (`select * from agent_lecture.creatrices limit 3;` → colonnes PRO uniquement). |

> Les deux migrations « À lancer » ci-dessus peuvent être exécutées **en un seul bloc**
> (elles sont idempotentes). Après application, relancer les **tests synthétiques** (comptes
> `ZZZ-*` uniquement, jamais de vraie créatrice) : usurpation signup → `my_creator()` NULL ;
> `DELETE contacts?creator=is.null` refusé ; `INSERT creators` par un créateur refusé ;
> `DELETE` d'un évènement partagé par un créateur listé refusé.

⚠️ **Comptes de test `ZZZ-*`** créés dans `auth.users` pendant l'audit du 2026-07-13
(non supprimables sans clé admin) — à purger depuis le dashboard Auth quand possible.

---

## Index (tous les fichiers)

| Fichier | Titre Supabase | Rôle |
|---|---|---|
| [`securite-signup-creator-name.sql`](securite-signup-creator-name.sql) | 🔒 Sécurité · signup creator_name | **CRITIQUE** : `handle_new_user` ne fait plus confiance au `creator_name` du client (anti-usurpation d'une créatrice via signup public) |
| [`securite-audit-2026-07-13.sql`](securite-audit-2026-07-13.sql) | 🔒 Sécurité · audit 2026-07-13 | Durcissement RLS : `contacts`/`messages` (écriture ≠ `creator is null`), `creators` (INSERT/DELETE agence), `events` (écriture = perso strict) |
| [`securite-creators-colonnes-agence.sql`](securite-creators-colonnes-agence.sql) | 🔒 Sécurité · verrou colonnes creators | Trigger `creators_guard` : un créateur ne peut pas écrire `ca`/`commission`/`status`/`exclu`/`sort_order` de sa fiche |
| [`securite-documents-storage-trigger.sql`](securite-documents-storage-trigger.sql) | 🔒 Sécurité · handle_new_user + storage | Storage documents cloisonné + `handle_new_user` (⚠️ MàJ 2026-07-13 : creator_name NULL — ne réintroduit plus l'ancienne faille) |
| [`securite-documents-table.sql`](securite-documents-table.sql) | 🔒 Sécurité · table documents | Table documents : agence-écriture / créateur-lecture |
| [`securite-avatars-storage.sql`](securite-avatars-storage.sql) | 🔒 Sécurité · storage avatars | Bucket avatars : upload ouvert, écrasement/suppression agence-only |
| [`push-subscriptions.sql`](push-subscriptions.sql) | 🔒 Push · table push_subscriptions | Abonnements push — RLS cloisonnée (chacun ses lignes, agence tout) |
| [`01-factures-rls-events-source.sql`](01-factures-rls-events-source.sql) | 1+2 · Factures RLS + Events source | Factures en écriture agence + `events.source` |
| [`03-outil-email-tables.sql`](03-outil-email-tables.sql) | 3 · Outil email (tables) | `email_sequences`, `sequence_enrollments`, `email_activity` |
| [`04-todos-status.sql`](04-todos-status.sql) | 4 · Tâches status | Colonne `todos.status` (À faire/En cours/Fait) |
| [`05-cron-alertes-email.sql`](05-cron-alertes-email.sql) | 5 · Cron alertes email | pg_cron `gmail-poll` toutes les 5 min |
| [`06-crons-resume-matin-semaine.sql`](06-crons-resume-matin-semaine.sql) | 6 · Crons résumé matin + semaine | Digest quotidien 8h + hebdo lundi 8h (`daily-digest`) |
| [`07-blob-atomique-et-backup.sql`](07-blob-atomique-et-backup.sql) | 7 · Blob atomique + backup | `app_state_set` (écriture atomique) + backup quotidien du blob (30 j) |
| [`08-error-log.sql`](08-error-log.sql) | 8 · Journal des bugs | Table `error_log` (crashs remontés par report-error, lecture agence) |
| [`09-events-description.sql`](09-events-description.sql) | 9 · Events · description | Colonne `events.description` (Planning + sync Google Agenda bidirectionnelle) |
| [`10-public-roster.sql`](10-public-roster.sql) | 10 · Vue publique roster | Vue `public_roster` (site vitrine, lecture anonyme, colonnes publiques) |
| [`11-rappel-datas-createurs.sql`](11-rappel-datas-createurs.sql) | 11 · Rappel datas créateurs | Colonne `creators.stats_month` + cron quotidien 9h |
| [`12-contacts-createur.sql`](12-contacts-createur.sql) | 12 · Contacts créateur | Colonne `contacts.creator` + RLS de base (durcie ensuite par l'audit 2026-07-13) |
| [`13-events-writecheck-createur.sql`](13-events-writecheck-createur.sql) | 13 · Events write-check créateur | `with check who = my_creator()` (durci ensuite par l'audit 2026-07-13) |
| [`14-media-kit.sql`](14-media-kit.sql) | 14 · Media kit | Colonne `creators.mediakit` (jsonb) + vue anon `public_mediakit` |
| [`crons-google-agenda.sql`](crons-google-agenda.sql) | Crons · Google Agenda | pg_cron watch-renew + sync |
| [`creators-reseaux-email-pro.sql`](creators-reseaux-email-pro.sql) | Créateurs · instagram/tiktok/email_pro | Colonnes réseaux + email pro |
| [`contacts-prenom-nom.sql`](contacts-prenom-nom.sql) | Contacts · prénom / nom | Colonnes `first_name` / `last_name` |
| [`admin-role-agence.sql`](admin-role-agence.sql) | Admin · Rôle agence (par user_id) | Promeut un compte réel en agence (bootstrap sûr, par `user_id`) |

⚠️ **À NE JAMAIS relancer** : l'ancien « schéma maître » (celui nommé
`⚠️ ANCIEN schéma maître — NE PAS relancer` dans Supabase) — il rouvre des failles.
Utilise `../SETUP.sql` à la place.
