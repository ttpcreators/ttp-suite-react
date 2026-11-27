# Architecture de TTP Suite

Référence technique pour reprendre le projet plus tard (ou par un autre dev / une IA). Les
règles de travail sont dans [`../CLAUDE.md`](../CLAUDE.md), la liste complète des fichiers et
des fonctions dans [`CARTE-DU-CODE.md`](CARTE-DU-CODE.md).

## Vue d'ensemble

```
Navigateur (React SPA)  ──anon key──►  Supabase (Postgres + RLS + Auth + Storage)
        │                                      ▲
        │  functions.invoke (JWT)              │ service_role (bypass RLS)
        ▼                                      │
   Edge Functions Deno  ──────────────────────┘
   (Google OAuth, Gmail, Resend, Web Push, ponts créateur, connecteur Claude)
```

- Le **front** parle à Supabase avec la clé **anon** uniquement. La RLS fait respecter
  qui voit quoi. Aucun secret serveur n'est dans le bundle.
- Les **Edge Functions** utilisent `service_role` (bypass RLS) et détiennent les secrets
  (VAPID privé, Google client secret, CRON_SECRET, Resend). Elles font leur propre auth.
- Le **connecteur Claude** (`ttp-mcp`) est une Edge Function : Claude, ChatGPT et l'agent
  Alfred lisent et écrivent dans l'app par lui, avec un jeton propre à chaque connexion.

## Rôles & sécurité (RLS)

- Table `profiles` : `role` = `agency` | `creator`, `creator_name` ; pour l'agence,
  `agency_role` = `founder` | `member`.
- Helpers SQL : `public.is_agency()`, `public.is_founder()`, `public.my_creator()`.
- Modèle : **anonyme = rien · agence = tout · créateur = ses données**.
- Trigger `handle_new_user` : force `role='creator'` (anti-escalade). Le rôle agence est
  posé à part (voir `supabase/sql/admin-role-agence.sql`).
- Écriture **agence-seule** sur les données financières/internes (factures, blob).
  Le créateur a un accès **lecture** cloisonné (ses factures, ses documents).
- Écritures d'un créateur bridées par des déclencheurs : `creators_guard` (colonnes
  sensibles de sa fiche et tarifs de son media kit) et `todos_a_creators_guard` (origine et
  liste des créateurs de ses tâches, « fait par » = le compte connecté).
- Storage : bucket `avatars` limité aux photos (pas de SVG) et à 25 Mo ; bucket `documents`
  limité à 25 Mo par fichier.
- OAuth : chaque `state` signé porte son usage (`via`, `_shared/state.ts`), et un retour
  refuse un jeton émis pour un autre usage. Les adresses de retour du connecteur sont fermées
  (`_shared/oauthRetour.ts`).
- Agents du connecteur : une connexion marquée « agent autonome » (`mcp_grants.agent`, pour
  Alfred) fait valider ses envois et ses actions irréversibles dans la page Agents
  (`ttp-mcp/verrou.ts`, règles `_shared/verrouAgent.ts`).
- Détail et règles du 24 et du 27 novembre 2026 : [`../CLAUDE.md`](../CLAUDE.md), section
  « Sécurité ».

## Le blob agence (`__app_state__`)

Beaucoup de réglages agence (objectifs, pricing, notifs, historique engagement,
échéances contrat, templates/signatures mail, historique contrats, debriefs…) vivent
dans **un seul blob JSON** : table `module_rows`, ligne `module='__app_state__'`,
colonne `a`. RLS : **agence uniquement**.

**L'argent à part** (2026-10-25) : les clés `invoiceDetails`, `invoiceBankAccounts`,
`invoiceIssuer`, `creatorPayouts`, `creatorCommission`, `comptaSettings` et `collabCashMode`
(page Compta, SQL 2026-10-29) vivent dans une 2e ligne,
`module='__finance_state__'`, lisible des seuls **fondateurs** (RLS `module_rows_agency`).
Les fonctions `app_state_set/merge/list` y rangent d'office ces clés (liste dans
`app_finance_key()`), et l'app (`src/lib/appState.ts`) comme le serveur
(`supabase/functions/_shared/appState.ts`) lisent les deux lignes, la ligne finance
l'emportant. Nouvelle clé d'argent : l'ajouter à `app_finance_key()` (SQL) et la déplacer.

Accès via [`src/lib/appState.ts`](../src/lib/appState.ts) :
- `useAppState(select)` : lit une tranche (mémoïsé, re-sync au tick `useLive`).
- `saveAppStateKey(key, value)` : **read-modify-write** ; renvoie un booléen.
- **Règle d'or** : avant d'écrire, relire **frais** (`invalidateAppState()` +
  `getAppState()`), fusionner, puis `saveAppStateKey`, et **vérifier le booléen**.
  Sinon deux onglets/postes agence s'écrasent mutuellement.

## Frontière créateur ↔ agence

Un créateur **ne peut pas** lire le blob agence (RLS). Toute donnée du blob qu'un
créateur doit voir passe par une **Edge Function fail-closed** qui filtre sur SON
`creator_name` :
- `creator-history` → son historique d'engagement.
- `debrief-history` → ses debriefs.
- `creator-report` → son rapport mensuel et « Ce qu'on te doit » (l'argent seulement pour
  lui et les fondateurs).
- `creator-mail` → sa boîte mail, filtrée côté serveur (ses adresses ou son libellé).

Tâches et rendez-vous (24/11/2026) : une tâche de l'agence (`source = 'agency'`) est
interne, sauf si elle est cochée « Visible par le créateur » (`todos.visible_createur`). Les
tâches écrites à la main pour un créateur et celles d'Alfred ou du connecteur sont visibles
par défaut ; les rappels automatiques des collabs et les rendez-vous « Tâche : … »
(`events.interne`) restent internes. La règle est dans la RLS, et l'app la reprend
(`visiblePourCreateur`, `src/lib/todoVisibility.ts`).

## Edge Functions (`supabase/functions/`)

La liste complète, avec l'appelant, le réglage `verify_jwt`, le contrôle fait par le code et
le cron de chaque fonction, est dans [`CARTE-DU-CODE.md`](CARTE-DU-CODE.md), section 6. Les
façons de s'authentifier :

| Appelant | Contrôle |
|---|---|
| L'app (agence ou créateur) | JWT de la session, puis rôle lu dans `profiles` : agence, fondateur (par exemple `create-access`, `google-disconnect`, `creator-box-mail`) ou créateur limité à ses données |
| Un cron `pg_cron` | `Authorization: Bearer <CRON_SECRET>`, comparé à temps constant (`verify_jwt = false`) |
| Un retour OAuth (Google, Instagram, TikTok, YouTube) | `state` signé, avec son usage (`verify_jwt = false`) |
| Un webhook (Google, Meta) | jeton du canal ou signature (`verify_jwt = false`) |
| Une page publique (`rdv`, `site-lead`) | aucun compte : piège à robots et plafonds par heure |
| Un client à part (widget iPhone, iMac d'Alfred) | clé du widget (`widget`) ou secret du pont (`alfred-pont`), `verify_jwt = false` |
| Un crash de l'app (`report-error`) | aucun (un crash peut arriver hors connexion) : texte de notification générique et garde-fou anti-flood |
| Claude, ChatGPT, Alfred | jetons propres du connecteur `ttp-mcp`, hachés en base |

Helpers partagés : [`_shared/google.ts`](../supabase/functions/_shared/google.ts)
(`getServiceClient`, `corsHeaders`, `getAccessToken` = refresh OAuth).

## Tâches planifiées (pg_cron)

Les crons appellent les fonctions avec `CRON_SECRET`, en heures UTC. Liste et horaires :
[`CARTE-DU-CODE.md`](CARTE-DU-CODE.md), section 6. Deux tâches ne sont que du SQL :
`ttp-app-state-backup` (sauvegarde quotidienne du blob) et `events-purge-tombstones`
(ménage des évènements d'agenda supprimés).

## Migrations SQL

- [`supabase/SETUP.sql`](../supabase/SETUP.sql) : **source de vérité** du schéma +
  sécurité (idempotent, à relancer pour tout recréer).
- [`supabase/sql/`](../supabase/sql/) : migrations **titrées** (une par fichier), avec un
  `README.md` qui sert de tableau d'état. ⚠️ Ne jamais relancer l'ancien « schéma maître »
  (il rouvre des failles) : utiliser `SETUP.sql`.

## Déploiement

- Front : fusion d'une PR dans `main` (contrôle « build » vert) → GitHub Actions → Pages
  (auto). Aucun push direct sur `main`.
- Edge Functions : « Déploiement des fonctions » (GitHub Actions, depuis `main`), ou
  `supabase functions deploy <nom> --project-ref zizvggziggswhrbuyhuo` par Marc. Jamais par
  une fusion.
- SQL : fichier daté appliqué dans le SQL Editor de Supabase.
- Une session prépare ; elle n'applique un SQL ou ne déploie qu'après le « oui » de Marc ou de
  Gianni pour ce changement précis, une seule personne à la fois (voir
  [`../CLAUDE.md`](../CLAUDE.md), « Règle prod »).
