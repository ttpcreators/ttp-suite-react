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
