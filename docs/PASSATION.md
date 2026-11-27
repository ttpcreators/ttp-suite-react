# 🤝 PASSATION : projet TTP Creators

> ⚠️ **Périmé depuis le 24/11/2026 pour les accès, le déploiement et le travail à deux :
> suivre [`../CLAUDE.md`](../CLAUDE.md)** (« Travailler à deux », « Règle prod », « Déploiement »).
> Ce socle date de juillet 2026 ; les sections 2, 4, 5, 8, 10 et 11 ont été remises à jour le
> 27/11/2026. L'état courant est dans [`../CLAUDE.md`](../CLAUDE.md) et dans le tableau d'état
> [`../supabase/sql/README.md`](../supabase/sql/README.md).

> **But de ce document** : permettre à n'importe qui (toi sur un autre compte, un futur
> dev, ou une nouvelle session Claude) de **reprendre le projet entièrement**, sans rien
> perdre. Il décrit le socle **durable** : projet, accès, architecture, déploiement, base,
> sécurité, pièges.
>
> _Socle rédigé le 2026-07-13._

> ⚠️ **À LIRE JUSTE APRÈS — l'état RÉCENT n'est pas dans ce fichier.**
> Deux grosses sessions ont eu lieu les **2026-07-18 et 19** (module Gifting, calculateur
> d'engagement, contrats durcis au droit FR, refonte de la navigation, perfs, espace
> créateur enrichi, PDF refondus…). Tout est décrit — avec **les décisions de sécurité à
> ne pas défaire** et les **points restés ouverts** — dans :
> **[`docs/archives/HANDOFF-2026-07-18.md`](archives/HANDOFF-2026-07-18.md)**.
> Le présent fichier reste valable pour le produit, la base et les pièges ; pour les accès et le
> déploiement, `CLAUDE.md` fait foi.

---

## 1. C'est quoi TTP Creators ?

Agence de **talent management** (Sport & Lifestyle, Lyon · Genève). Le projet = **2 produits**
qui partagent **une seule base de données** :

| Produit | Rôle | En ligne | Dossier local | Repo GitHub |
|---|---|---|---|---|
| **L'app** (TTP Suite) | Outil interne : côté **agence** (roster, factures, contrats, planning, contacts, stats, mails, media kits) + **espace créateur** | https://app.ttpcreators.pro | `ttp-suite-react/` | `ttpcreators/ttp-suite-react` |
| **Le site vitrine** | Site public de l'agence + **media kits** publics des créateurs | https://ttpcreators.pro | `websitettpcreators/` | `ttpcreators/websitettpcreators` |

Base de données commune = **Supabase**, projet `zizvggziggswhrbuyhuo`.

**Contrainte clé du projet : 0 €.** Tout tourne sur des offres gratuites (Supabase free,
GitHub Pages, domaine déjà payé). Ne rien introduire qui coûte.

---

## 2. Ce qu'il faut pour reprendre la main (accès)

1. **GitHub** : les 2 repos appartiennent au compte GitHub `ttpcreators` (un compte, pas une
   organisation). Chacun travaille avec **son propre compte** : Marc avec `ttpcreators` (alias
   SSH `github-ttp` du dépôt), Gianni avec le sien, qui a le droit d'écriture. Jamais
   `gh auth login` ni `gh auth switch` pour pousser, et le compte `ttpcreators` n'est jamais
   prêté. `main` est protégée : tout passe par une PR (voir `CLAUDE.md`, « Travailler à deux »).
2. **Supabase** : accès au compte qui possède le projet `zizvggziggswhrbuyhuo` (dashboard).
   Les fonctions se déploient par « Déploiement des fonctions » (GitHub Actions) ; le **CLI
   Supabase** (`supabase login`) ne sert qu'à Marc, pour déployer à la main.
3. **Domaine** : `ttpcreators.pro` est chez **OVH** (DNS). ⚠️ Ne JAMAIS toucher aux
   enregistrements **MX / SPF / DMARC** (emails Google `partnerships@…`).
4. **Machine** : sur le Mac de Marc, `gh` et `supabase` sont déjà connectés, et le dépôt pousse
   par l'alias SSH du compte `ttpcreators`. Sur une autre machine : son propre compte GitHub
   (clé SSH), et `supabase login` seulement pour déployer à la main ; tout le reste est dans Git.

L'app **ne dépend d'aucun compte Claude** : elle tourne seule sur Supabase + GitHub Pages.
Claude est juste l'assistant qui aide à la faire évoluer.

---

## 3. Architecture en bref

- **App** : React 19 + Vite + **TypeScript** + **Tailwind** + **shadcn/ui** (`src/components/ui/`).
  Vues dans `src/views/`, entrée `src/App.tsx`. Auth + données + fichiers = Supabase.
  Deux rôles : **agence** (tout) et **créateur** (son espace = `src/views/CreatorSpace.tsx`),
  distingués par `profiles.role`.
- **Vitrine** : React 19 + Vite en **CSS pur** (PAS de Tailwind/TS — ne pas en introduire).
  Sections dans `src/components/`, données éditoriales dans `src/data.js`.
- **Media kits** : dans le repo vitrine, dossier `mediakit/`. Un **moteur JS générique**
  (`_assets/mediakit.js`) lit la vue Supabase `public_mediakit` et génère **1 page par
  créateur** (`/mediakit/<slug>/`) + un **PDF paysage 16:9**. 100 % automatique (voir §6).

---

## 4. Déploiement (comment mettre en ligne)

**Règle : une PR fusionnée dans `main` = mise en ligne.** Les deux repos ont un GitHub Actions.
Sur l'app, `main` est protégée : jamais de push direct, une PR et le contrôle « build » vert.

- **App** → fusion d'une PR dans `main` → build (`npm run build`) → **GitHub Pages**
  (`app.ttpcreators.pro`).
- **Vitrine** → push `main` → build React + génération des media kits + rendu des PDF →
  **GitHub Pages** (`ttpcreators.pro`). Un **cron horaire** régénère aussi les media kits.
- **Edge Functions Supabase** (`ttp-suite-react/supabase/functions/`) → **jamais** par une
  fusion. « Déploiement des fonctions » (onglet Actions de GitHub, depuis `main`), ou Marc à la
  main, après le « oui » de Marc ou de Gianni pour ce déploiement :
  ```
  supabase functions deploy <noms> --project-ref zizvggziggswhrbuyhuo
  ```

**Avant de commit sur l'app**, toujours faire passer la **porte de qualité** :
```
npm run build      # = oxlint && vitest run && tsc -b && vite build
```
Si elle échoue, ne pas commit. (La vitrine, elle, fait juste `vite build`.)

---

## 5. La base de données (Supabase)

- **Schéma = source de vérité : [`supabase/SETUP.sql`](../supabase/SETUP.sql)** (tables,
  fonctions `is_agency()` / `my_creator()`, RLS, Storage, rôle agence). À relancer pour tout
  recréer de zéro.
- **Migrations** = [`supabase/sql/`](../supabase/sql/), une par changement. **Le fichier
  [`supabase/sql/README.md`](../supabase/sql/README.md) est le TABLEAU DE BORD** : il liste
  chaque migration avec son statut (✅ appliqué en prod / ⏳ à faire). **Le lire en premier.**
- La **clé anon** (dans le code) est **publique par design**. Les données sont protégées par
  **RLS** (Row Level Security). Modèle : **lecture large, écriture stricte**
  (`is_agency() or <colonne> = my_creator()`).

### ⚠️ Règle d'or : « la session prépare, la personne décide »
Le détail est dans [`../CLAUDE.md`](../CLAUDE.md), « Règle prod ». En bref, pour tout
changement de base, de réglage ou de fonction :
1. la session **écrit** le SQL (foldé dans `SETUP.sql` **et** déposé dans `supabase/sql/`) ou
   la fonction, par une PR, avec une ligne ⏳ au tableau de bord ;
2. elle **applique** le SQL (connecteur Supabase) ou lance « Déploiement des fonctions »
   seulement après le « oui » de Marc ou de Gianni pour ce changement précis, une seule
   personne à la fois ; les secrets et les réglages Auth restent à Marc ;
3. elle **vérifie** (requête de contrôle, comptes de test `ZZZ-*` uniquement) et **met à jour le
   tableau de bord** `supabase/sql/README.md`.

C'est CE cycle qui rend la reprise possible d'une session à l'autre. **Tenir le tableau à jour.**

---

## 6. Media kits — comment ça marche

- Chaque créateur remplit ses données dans l'app (onglet **Media kit** → `MediakitEditor`)
  → écrit dans la colonne `creators.mediakit` (jsonb) → exposée par la vue anon
  `public_mediakit`.
- Au déploiement de la vitrine (+ cron horaire), `mediakit/_build_mediakits.py` génère **1
  page par créateur** et `_render_pdfs.py` rend le **PDF 16:9**. **Ajouter un créateur =
  100 % auto** : sa page `/mediakit/<slug>/` apparaît toute seule dans l'heure.
- Le slug = champ « Lien » de l'app, sinon le prénom (sans accent). L'espace créateur affiche
  le lien seulement si la page répond vraiment (vérif HEAD).
- **PDF paysage** rendu en CI par Chrome headless (feuille `@media print` 16:9). PDF gitignorés.

---

## 7. Sécurité — état actuel (détail : `supabase/sql/README.md` + audits)

Plusieurs **audits adversariaux** menés et corrigés (identité/privilège, OWASP). Points clés :
- **Inscription publique DÉSACTIVÉE** (dashboard). Les comptes se créent via la fonction
  admin `create-access`. `handle_new_user` ne fait **jamais** confiance au `creator_name`
  envoyé par le client (sinon usurpation d'un créateur).
- **RLS durcie** : `contacts` / `messages` / `creators` / `events` séparés lecture/écriture ;
  colonnes sensibles de `creators` (ca, commission, status, exclu, sort_order) verrouillées
  par le trigger `creators_guard` ; factures en écriture agence uniquement.
- Fonctions edge : `report-error` corps de notif générique (anti-phishing) ; garde-fou
  anti-flood.
- **Aucun secret dans le code ni dans le dépôt** (ni clé service_role, ni jeton, ni mot de
  passe). Les identifiants des boîtes gérées pour certains créateurs sont rangés en base, dans
  le blob agence `credVault` (lisible par l'agence seulement, RLS), par choix assumé de
  l'utilisateur : voir `src/views/CredentialVault.tsx`.

---

## 8. Tâches courantes (où toucher)

| Je veux… | Où |
|---|---|
| Ajouter/modifier un créateur | App côté agence → Roster (écrit dans `creators`) |
| Changer une vue de l'app | `ttp-suite-react/src/views/<Vue>.tsx` |
| Changer le site vitrine | `websitettpcreators/src/components/` + `src/data.js` |
| Changer le design d'un media kit | `websitettpcreators/mediakit/_assets/mediakit.css` (+ `.js`) |
| Ajouter une colonne / changer la RLS | écrire le SQL (fichier daté + `SETUP.sql`), PR, puis l'appliquer après le « oui » (voir §5) |
| Déployer une fonction edge | « Déploiement des fonctions » (onglet Actions de GitHub, depuis `main`) après le « oui », ou Marc à la main (voir `CLAUDE.md`, « Déploiement ») |

---

## 9. Pièges connus (à ne pas refaire)

- **Ne jamais déployer la vitrine depuis une branche autre que `main`.** Une vieille branche
  archive (`claude/agency-website-m3e282`) contient l'ANCIEN site ; elle est neutralisée. La
  réautoriser a déjà écrasé le vrai site une fois.
- **GitHub Pages est sensible à la casse** des noms de fichiers (macOS non) → renommage de
  casse = `git mv -f`.
- **Ne pas introduire Tailwind/TypeScript dans la vitrine** (elle est en CSS pur volontairement).
- **Écritures dans un blob jsonb** : toujours relire frais avant de fusionner (bug historique :
  « écrasement depuis un état local périmé »).
- **DNS OVH** : ne jamais toucher aux MX/SPF/DMARC (emails Google).

---

## 10. Comment démarrer une nouvelle session

Ouvre le dossier `ttp-suite-react/` avec Claude Code et dis simplement :

> « Lis `CLAUDE.md` puis `supabase/sql/README.md`, et dis-moi l'état actuel du projet et ce
>   qui reste à faire. »

Tu seras opérationnel en une minute. Pour un changement, la session travaille dans un atelier
(`~/Code/TTP Suite/_ateliers/<nom>`, sur une branche partie de `origin/main` à jour) et finit par
une PR : voir `docs/RECETTES.md`, recette 7.

---

## 11. Ce qui reste (backlog léger, non urgent)

- Remplacer les **données de test** (« test ») restées dans le media kit d'un créateur par les vrais chiffres.
- Purger les **comptes de test `ZZZ-*`** dans Supabase Auth (créés pendant les audits).
- Remplir les vraies données/images des autres créateurs dans l'app.
