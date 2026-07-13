# 🤝 PASSATION — Projet TTP Creators

> **But de ce document** : permettre à n'importe qui (toi sur un autre compte, un futur
> dev, ou une nouvelle session Claude) de **reprendre le projet entièrement**, sans rien
> perdre. Tout est expliqué ici. Si tu ne lis qu'un fichier, lis celui-ci.
>
> _Dernière mise à jour : 2026-07-13._

---

## 1. C'est quoi TTP Creators ?

Agence de **talent management** (Sport & Lifestyle, Lyon · Genève). Le projet = **2 produits**
qui partagent **une seule base de données** :

| Produit | Rôle | En ligne | Dossier local | Repo GitHub |
|---|---|---|---|---|
| **L'app** (TTP Suite) | Outil interne : côté **agence** (roster, factures, contrats, planning, contacts, stats, mails, media kits) + **espace créateur** | https://app.ttpcreators.pro | `ttp-suite-react/` | `ttpcreators/ttp-suite-react` |
| **Le site vitrine** | Site public de l'agence + **media kits** publics des créatrices | https://ttpcreators.pro | `websitettpcreators/` | `ttpcreators/websitettpcreators` |

Base de données commune = **Supabase**, projet `zizvggziggswhrbuyhuo`.

**Contrainte clé du projet : 0 €.** Tout tourne sur des offres gratuites (Supabase free,
GitHub Pages, domaine déjà payé). Ne rien introduire qui coûte.

---

## 2. Ce qu'il faut pour reprendre la main (accès)

1. **GitHub** : être membre de l'org `ttpcreators` (les 2 repos y sont). Se connecter avec
   `gh auth login` sur la machine.
2. **Supabase** : accès au compte qui possède le projet `zizvggziggswhrbuyhuo` (dashboard).
   Le **CLI Supabase** doit être connecté (`supabase login`) pour déployer les fonctions.
3. **Domaine** : `ttpcreators.pro` est chez **OVH** (DNS). ⚠️ Ne JAMAIS toucher aux
   enregistrements **MX / SPF / DMARC** (emails Google `partnerships@…`).
4. **Machine** : le plus simple = **le Mac de Marc** (`marcmaher`), où `gh` + `supabase`
   sont déjà connectés et où vit la mémoire locale de Claude. Sur une autre machine, il faut
   re-faire `gh auth login` + `supabase login` (2 min) ; tout le reste est dans Git.

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
  créatrice** (`/mediakit/<slug>/`) + un **PDF paysage 16:9**. 100 % automatique (voir §6).

---

## 4. Déploiement (comment mettre en ligne)

**Règle : pousser sur `main` = déployer.** Les deux repos ont un GitHub Actions.

- **App** → push `main` → build (`npm run build`) → **GitHub Pages** (`app.ttpcreators.pro`).
- **Vitrine** → push `main` → build React + génération des media kits + rendu des PDF →
  **GitHub Pages** (`ttpcreators.pro`). Un **cron horaire** régénère aussi les media kits.
- **Edge Functions Supabase** (`ttp-suite-react/supabase/functions/`) → **PAS** automatiques.
  Déploiement **manuel** :
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

- **Schéma = source de vérité : [`supabase/SETUP.sql`](supabase/SETUP.sql)** (tables,
  fonctions `is_agency()` / `my_creator()`, RLS, Storage, rôle agence). À relancer pour tout
  recréer de zéro.
- **Migrations** = [`supabase/sql/`](supabase/sql/), une par changement. **Le fichier
  [`supabase/sql/README.md`](supabase/sql/README.md) est le TABLEAU DE BORD** : il liste
  chaque migration avec son statut (✅ appliqué en prod / ⏳ à faire). **Le lire en premier.**
- La **clé anon** (dans le code) est **publique par design**. Les données sont protégées par
  **RLS** (Row Level Security). Modèle : **lecture large, écriture stricte**
  (`is_agency() or <colonne> = my_creator()`).

### ⚠️ Règle d'or : « l'assistant prépare, l'utilisateur applique »
Une session Claude n'a que la **clé anon** : elle **ne peut PAS** faire de DDL, changer les
réglages Auth, ni déployer les fonctions (le harnais bloque l'usage de credentials de prod —
c'est voulu). Donc le cycle pour tout changement base/auth/fonction est :
1. l'assistant **écrit** le SQL (foldé dans `SETUP.sql` **et** déposé dans `supabase/sql/`) et
   **commit** ;
2. il **donne** à l'utilisateur le SQL à coller dans le **SQL Editor**, ou la commande à lancer ;
3. l'utilisateur **applique**, puis l'assistant **vérifie** (clé anon, comptes de test `ZZZ-*`
   uniquement) et **met à jour le tableau de bord** `supabase/sql/README.md`.

C'est CE cycle qui rend la reprise possible d'une session à l'autre. **Tenir le tableau à jour.**

---

## 6. Media kits — comment ça marche

- Chaque créatrice remplit ses données dans l'app (onglet **Media kit** → `MediakitEditor`)
  → écrit dans la colonne `creators.mediakit` (jsonb) → exposée par la vue anon
  `public_mediakit`.
- Au déploiement de la vitrine (+ cron horaire), `mediakit/_build_mediakits.py` génère **1
  page par créatrice** et `_render_pdfs.py` rend le **PDF 16:9**. **Ajouter une créatrice =
  100 % auto** : sa page `/mediakit/<slug>/` apparaît toute seule dans l'heure.
- Le slug = champ « Lien » de l'app, sinon le prénom (sans accent). L'espace créateur affiche
  le lien seulement si la page répond vraiment (vérif HEAD).
- **PDF paysage** rendu en CI par Chrome headless (feuille `@media print` 16:9). PDF gitignorés.

---

## 7. Sécurité — état actuel (détail : `supabase/sql/README.md` + audits)

Plusieurs **audits adversariaux** menés et corrigés (identité/privilège, OWASP). Points clés :
- **Inscription publique DÉSACTIVÉE** (dashboard). Les comptes se créent via la fonction
  admin `create-access`. `handle_new_user` ne fait **jamais** confiance au `creator_name`
  envoyé par le client (sinon usurpation d'une créatrice).
- **RLS durcie** : `contacts` / `messages` / `creators` / `events` séparés lecture/écriture ;
  colonnes sensibles de `creators` (ca, commission, status, exclu, sort_order) verrouillées
  par le trigger `creators_guard` ; factures en écriture agence uniquement.
- Fonctions edge : `report-error` corps de notif générique (anti-phishing) ; garde-fou
  anti-flood.
- **Le seul secret « sensible »** = les mots de passe en clair dans le code (choix assumé de
  l'utilisateur — voir mémoire). Rien d'autre (aucune service_role key / token dans le repo).

---

## 8. Tâches courantes (où toucher)

| Je veux… | Où |
|---|---|
| Ajouter/modifier une créatrice | App côté agence → Roster (écrit dans `creators`) |
| Changer une vue de l'app | `ttp-suite-react/src/views/<Vue>.tsx` |
| Changer le site vitrine | `websitettpcreators/src/components/` + `src/data.js` |
| Changer le design d'un media kit | `websitettpcreators/mediakit/_assets/mediakit.css` (+ `.js`) |
| Ajouter une colonne / changer la RLS | écrire le SQL, le donner à l'utilisateur (voir §5) |
| Déployer une fonction edge | `supabase functions deploy <nom> --project-ref zizvggziggswhrbuyhuo` |

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

> « Lis `PASSATION.md`, `CLAUDE.md` et `supabase/sql/README.md`, puis dis-moi l'état actuel
>   du projet et ce qui reste à faire. »

Tu seras opérationnel en une minute.

---

## 11. Ce qui reste (backlog léger, non urgent)

- Remplacer les **données de test** (« test ») dans le media kit de Candice par les vrais chiffres.
- Optionnel LOW : limite de taille/type sur le bucket Storage `avatars` (anti-abus hébergement).
- Purger les **comptes de test `ZZZ-*`** dans Supabase Auth (créés pendant les audits).
- Remplir les vraies données/images des autres créatrices dans l'app.
