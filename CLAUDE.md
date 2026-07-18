# TTP Suite — application (agence + espace créateur)

App de gestion de l'agence **TTP Creators** : côté **agence** (roster, factures, contrats,
planning, contacts, stats, mails, media kits, gifting…) et **espace créateur** (ses tâches,
briefs, factures, gifting, suivi, media kit). **En production sur https://app.ttpcreators.pro.**
Toute modif poussée sur `main` met l'app à jour en ~1-2 min. Agir en conséquence.

> Repo frère : le **site vitrine** `websitettpcreators` (public, ttpcreators.pro) — il
> héberge aussi les **media kits** publics (`/mediakit/<slug>/`) générés depuis la vue
> Supabase `public_mediakit`. Les deux repos partagent le **même projet Supabase**.

## Stack

React 19 + Vite + **TypeScript**, **Tailwind** + **shadcn/ui** (composants dans
`src/components/ui/`), Supabase (auth + Postgres + Storage + Edge Functions),
`lucide-react` (le vrai système d'icônes). Vues = `src/views/`, entrée `src/App.tsx`.

## Commandes

```bash
npm install
npm run dev
npm run build   # PORTE DE QUALITÉ : oxlint && vitest run && tsc -b && vite build
```
**Toujours faire passer `npm run build` avant de commit** (c'est la porte : lint + tests +
types + build). Un `git push origin main` déclenche le déploiement GitHub Pages.

## Déploiement

- **Production = branche `main`.** `.github/workflows/deploy.yml` : `npm ci && npm run build`
  → `upload-pages-artifact` → `deploy-pages`. Domaine custom `app.ttpcreators.pro`.
- **Edge Functions** (`supabase/functions/*`) : **PAS déployées par la CI** → déploiement
  MANUEL via `supabase functions deploy <noms> --project-ref zizvggziggswhrbuyhuo`.

## Supabase — projet `zizvggziggswhrbuyhuo`

- **Schéma = source de vérité : [`supabase/SETUP.sql`](supabase/SETUP.sql)** (tables,
  fonctions `is_agency()`/`my_creator()`, RLS, Storage, rôle agence). À relancer pour tout
  recréer. La clé **anon** (dans le code) est **publique par design** ; les données sont
  protégées par **RLS**.
- **Migrations** = `supabase/sql/*.sql`, une par changement, lancées à la main dans le
  **SQL Editor**. **📒 État de reprise = [`supabase/sql/README.md`](supabase/sql/README.md)** :
  tableau ✅ appliqué / ⏳ à faire. **Le lire en premier pour reprendre le fil.**

## ⚠️ Règle prod : « l'assistant prépare, l'utilisateur applique »

L'assistant n'a que la **clé anon** — il **ne peut PAS** faire de DDL, changer les réglages
Auth, ni déployer les Edge Functions (le harnais bloque à raison l'usage de credentials de
prod). Donc, pour tout changement de base / auth / fonction :
1. l'assistant **écrit** le SQL (foldé dans `SETUP.sql` **et** déposé dans `supabase/sql/`
   comme fichier daté) ou le code de fonction, **commit + push** ;
2. l'assistant **donne à l'utilisateur** le SQL à lancer / le toggle dashboard / la commande
   `supabase functions deploy` ;
3. après application, l'assistant **vérifie** avec la clé anon (comptes de test `ZZZ-*`
   uniquement, jamais de vraie donnée) et **met à jour le tableau d'état** du runbook.

Ce cycle est la raison d'être du runbook : il rend la reprise possible d'une session à
l'autre. **Mettre le tableau à jour à CHAQUE changement.**

## Sécurité (résumé — détail dans le runbook + mémoire)

Plusieurs audits adversariaux menés (identité/privilège, OWASP). Motif RLS de référence :
**lecture large, écriture stricte** (`is_agency() or <col> = my_creator()`) — jamais de
branche `creator is null` en écriture. Inscription publique **désactivée** (les comptes se
créent via la fonction admin `create-access`). `handle_new_user` ne fait **jamais** confiance
au `creator_name` envoyé par le client.
