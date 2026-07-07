# Architecture — TTP Suite

Référence technique pour reprendre le projet plus tard (ou par un autre dev / une IA).

## Vue d'ensemble

```
Navigateur (React SPA)  ──anon key──►  Supabase (Postgres + RLS + Auth + Storage)
        │                                      ▲
        │  functions.invoke (JWT)              │ service_role (bypass RLS)
        ▼                                      │
   Edge Functions Deno  ──────────────────────┘
   (Google OAuth, Gmail, Resend, Web Push, ponts créateur)
```

- Le **front** parle à Supabase avec la clé **anon** uniquement. La RLS fait respecter
  qui voit quoi. Aucun secret serveur n'est dans le bundle.
- Les **Edge Functions** utilisent `service_role` (bypass RLS) et détiennent les secrets
  (VAPID privé, Google client secret, CRON_SECRET, Resend). Elles font leur propre auth.

## Rôles & sécurité (RLS)

- Table `profiles` : `role` = `agency` | `creator`, `creator_name`.
- Helpers SQL : `public.is_agency()`, `public.my_creator()`.
- Modèle : **anonyme = rien · agence = tout · créateur = ses données**.
- Trigger `handle_new_user` : force `role='creator'` (anti-escalade). Le rôle agence est
  posé à part (voir `supabase/sql/admin-role-agence.sql`).
- Écriture **agence-seule** sur les données financières/internes (factures, blob).
  Le créateur a un accès **lecture** cloisonné (ses factures, ses documents).

## Le blob agence (`__app_state__`)

Beaucoup de réglages agence (objectifs, pricing, notifs, historique engagement,
échéances contrat, templates/signatures mail, historique contrats, debriefs…) vivent
dans **un seul blob JSON** : table `module_rows`, ligne `module='__app_state__'`,
colonne `a`. RLS : **agence uniquement**.

Accès via [`src/lib/appState.ts`](../src/lib/appState.ts) :
- `useAppState(select)` — lit une tranche (mémoïsé, re-sync au tick `useLive`).
- `saveAppStateKey(key, value)` — **read-modify-write** ; renvoie un booléen.
- **Règle d'or** : avant d'écrire, relire **frais** (`invalidateAppState()` +
  `getAppState()`), fusionner, puis `saveAppStateKey`, et **vérifier le booléen**.
  Sinon deux onglets/postes agence s'écrasent mutuellement.

## Frontière créateur ↔ agence

Un créateur **ne peut pas** lire le blob agence (RLS). Toute donnée du blob qu'un
créateur doit voir passe par une **Edge Function fail-closed** qui filtre sur SON
`creator_name` :
- `creator-history` → son historique d'engagement.
- `debrief-history` → ses debriefs.

## Edge Functions (`supabase/functions/`)

| Fonction | Rôle | Auth (config.toml) |
|---|---|---|
| `google-connect-url` / `-callback` / `-status` / `-disconnect` | OAuth Google | JWT agence / public (state signé) |
| `google-sync` / `-webhook` / `-watch-renew` | Sync Agenda | CRON_SECRET / webhook |
| `gmail-send` | Envoi depuis la vraie boîte Gmail | JWT agence |
| `gmail-history` / `gmail-thread` | Lecture des fils | JWT agence |
| `gmail-poll` | Alertes de réception (cron) | CRON_SECRET **ou** JWT agence |
| `send-email` | Envoi via Resend | JWT agence |
| `create-access` | Créer un compte connexion | JWT agence |
| `creator-history` / `debrief-history` | Ponts créateur (filtrés) | JWT |
| `daily-digest` | Résumé push matinal | CRON_SECRET |

Helpers partagés : [`_shared/google.ts`](../supabase/functions/_shared/google.ts)
(`getServiceClient`, `corsHeaders`, `getAccessToken` = refresh OAuth).

## Tâches planifiées (pg_cron)

- `gmail-poll-5min` → `gmail-poll` toutes les 5 min (alertes email).
- `google-watch-renew` (1h/jour) + `google-sync-hourly` (chaque heure).

Définies dans [`supabase/sql/`](../supabase/sql/) (`05-cron-alertes-email.sql`,
`crons-google-agenda.sql`).

## Migrations SQL

- [`supabase/SETUP.sql`](../supabase/SETUP.sql) — **source de vérité** du schéma +
  sécurité (idempotent, à relancer pour tout recréer).
- [`supabase/sql/`](../supabase/sql/) — migrations manuelles **titrées** (une par
  fichier) avec un `README.md` index. ⚠️ Ne jamais relancer l'ancien « schéma maître »
  (il rouvre des failles) — utiliser `SETUP.sql`.

## Déploiement

- Front : `git push origin main` → GitHub Actions → Pages (auto).
- Edge Functions : `supabase functions deploy <nom> --project-ref zizvggziggswhrbuyhuo`.
- SQL : coller le fichier concerné dans Supabase → SQL Editor.
