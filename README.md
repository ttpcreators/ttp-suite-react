# TTP Suite

Application de gestion pour l'agence de créateurs **TTP Creators** — en ligne sur
**[app.ttpcreators.pro](https://app.ttpcreators.pro)**.

Deux espaces dans une seule app : **Agence** (pilotage complet) et **Créateur**
(chaque créateur ne voit que ses données). Facturation, roster, briefs, planning,
media kits, contrats, debriefs, suivi d'engagement, et un **cockpit email** (envoi
Gmail/Resend, historique, relances, alertes de réception).

---

## Stack

| Couche | Techno |
|---|---|
| Front | React 19 · Vite · TypeScript (strict) · Tailwind v4 · shadcn/Radix · recharts |
| Back | Supabase (Postgres + RLS + Auth + Storage) |
| Serveur | Edge Functions Deno (`supabase/functions/*`) |
| Intégrations | Google OAuth (Agenda + Gmail) · Web Push (VAPID) · Resend |
| Hébergement | GitHub Pages (déploiement auto via GitHub Actions au `git push`) |

## Démarrer

```bash
npm install
npm run dev      # serveur local
npm run build    # build de prod (tsc + vite) — DOIT passer avant tout commit
npm run lint     # oxlint
```

## Déploiement

- **Front** : automatique — chaque `git push` sur `main` → GitHub Actions → Pages.
- **Edge Functions** : manuel —
  `supabase functions deploy <nom> --project-ref zizvggziggswhrbuyhuo`
- **Base de données** : SQL manuel — voir [`supabase/sql/`](supabase/sql/) (migrations
  titrées) et [`supabase/SETUP.sql`](supabase/SETUP.sql) (schéma complet, source de vérité).

## Structure

```
src/
  views/         une page = un fichier .tsx (Facturation, Roster, Mails, Debrief…)
  components/    Login, Sidebar, GlobalSearch + ui/ (composants réutilisables)
  lib/           appState (blob), db, dates, nav, push, search, platform…
supabase/
  functions/     Edge Functions Deno (google-*, gmail-*, send-email, *-history…)
  SETUP.sql      schéma + sécurité complets (à relancer pour tout recréer)
  sql/           migrations manuelles titrées (une par fichier) + README index
docs/            documentation (architecture, prompt d'audit)
```

## Conventions clés

- **Modèle de données** : la plupart des données sont dans des tables Postgres avec
  **RLS** (agence = tout · créateur = les siennes). Les réglages agence sont dans **un
  seul blob JSON** (`module_rows` ligne `__app_state__`), agence-only, via
  [`src/lib/appState.ts`](src/lib/appState.ts). Toute écriture du blob **relit frais**
  (`invalidateAppState` + `getAppState`) avant de fusionner.
- **Frontière créateur↔agence** : un créateur ne lit jamais le blob agence ; chaque
  passerelle est une Edge Function qui filtre côté serveur sur `creator_name`
  (`creator-history`, `debrief-history`).
- **Sécurité** : seule la clé **anon** est côté client. Les secrets (service_role,
  VAPID privé, OAuth, CRON_SECRET, Resend) sont des secrets Supabase. Voir
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

📄 Détails d'architecture, sécurité et flux : **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**.
