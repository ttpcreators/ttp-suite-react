# 📒 Suivi des migrations SQL — TTP Suite

Chaque fichier = **une migration** lancée à la main dans le **SQL Editor de Supabase**
(projet `zizvggziggswhrbuyhuo`). Même nom que la requête enregistrée côté Supabase →
tu retrouves tout d'un coup d'œil, et c'est **versionné dans Git**.

> **Base du schéma** : le schéma complet (tables, fonctions, rôle agence, RLS de base,
> Storage) vit dans [`../SETUP.sql`](../SETUP.sql) — c'est **la source de vérité**, à
> relancer si tu dois tout recréer. Les fichiers ci-dessous sont les **ajouts/correctifs**
> appliqués par-dessus.

## Index

| Fichier | Titre Supabase | Rôle |
|---|---|---|
| [`securite-documents-storage-trigger.sql`](securite-documents-storage-trigger.sql) | 🔒 Sécurité · handle_new_user + storage | Rôle forcé `creator` + storage documents cloisonné |
| [`securite-documents-table.sql`](securite-documents-table.sql) | 🔒 Sécurité · table documents | Table documents : agence-écriture / créateur-lecture |
| [`01-factures-rls-events-source.sql`](01-factures-rls-events-source.sql) | 1+2 · Factures RLS + Events source | Factures en écriture agence + `events.source` |
| [`03-outil-email-tables.sql`](03-outil-email-tables.sql) | 3 · Outil email (tables) | `email_sequences`, `sequence_enrollments`, `email_activity` |
| [`04-todos-status.sql`](04-todos-status.sql) | 4 · Tâches status | Colonne `todos.status` (À faire/En cours/Fait) |
| [`05-cron-alertes-email.sql`](05-cron-alertes-email.sql) | 5 · Cron alertes email | pg_cron `gmail-poll` toutes les 5 min |
| [`crons-google-agenda.sql`](crons-google-agenda.sql) | Crons · Google Agenda | pg_cron watch-renew + sync |
| [`push-subscriptions.sql`](push-subscriptions.sql) | Push · table push_subscriptions | Abonnements notifications push |
| [`creators-reseaux-email-pro.sql`](creators-reseaux-email-pro.sql) | Créateurs · instagram/tiktok/email_pro | Colonnes réseaux + email pro |
| [`contacts-prenom-nom.sql`](contacts-prenom-nom.sql) | Contacts · prénom / nom | Colonnes `first_name` / `last_name` |
| [`admin-role-agence.sql`](admin-role-agence.sql) | Admin · Rôle agence (partnerships@) | Promeut un compte en agence (raccourci) |

⚠️ **À NE JAMAIS relancer** : l'ancien « schéma maître » (celui nommé
`⚠️ ANCIEN schéma maître — NE PAS relancer` dans Supabase) — il rouvre des failles.
Utilise `../SETUP.sql` à la place.
