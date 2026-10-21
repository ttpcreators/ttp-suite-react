# Recettes : les changements courants, pas à pas

Chaque recette donne les fichiers à toucher, un exemple réel à copier et les vérifications.
Avant tout : lire [`../CLAUDE.md`](../CLAUDE.md) (règles) et
[`../supabase/sql/README.md`](../supabase/sql/README.md) (état de la base). Pour savoir où
vit une chose : [`CARTE-DU-CODE.md`](CARTE-DU-CODE.md).

Vérification commune à toutes les recettes :

```bash
npm run build   # oxlint + vitest + tsc + vite build : doit être vert avant tout commit
```

## Sommaire

1. [Ajouter une page au menu agence](#1-ajouter-une-page-au-menu-agence)
2. [Ajouter un onglet à l'espace créateur (et ses traductions)](#2-ajouter-un-onglet-à-lespace-créateur-et-ses-traductions)
3. [Ajouter une colonne en base sans casser la prod](#3-ajouter-une-colonne-en-base-sans-casser-la-prod)
4. [Ajouter ou modifier une Edge Function](#4-ajouter-ou-modifier-une-edge-function)
5. [Ajouter un outil au connecteur Claude (`ttp-mcp`)](#5-ajouter-un-outil-au-connecteur-claude-ttp-mcp)
6. [Ajouter un document PDF](#6-ajouter-un-document-pdf)
7. [Mettre en ligne et vérifier](#7-mettre-en-ligne-et-vérifier)
8. [Revenir en arrière](#8-revenir-en-arrière)

---

## 1. Ajouter une page au menu agence

Exemple à copier : la page To-do (`todo`).

1. **La vue** : créer `src/views/MaPage.tsx` avec un export nommé
   (`export function MaPage() { … }`). Titre et phrase d'aide sont posés par la coque
   (`PageFrame`), pas par la page.
2. **Le menu** : dans `src/lib/nav.tsx`
   - ajouter `"mapage"` à l'union `ViewId` ;
   - ajouter l'entrée dans les `items` de la bonne famille de `NAV`, comme
     `{ id: "todo", label: "To-do", icon: TtpTodo }` ;
   - l'icône vient de `@/components/icons/ttp-icons` (icônes `Ttp*`) ou de
     `@/components/icons`, jamais de `lucide-react` ;
   - sous-pages : ajouter `children: [{ id: "agenda", label: "Agenda" }, …]` (modèle :
     `planning`) et, dans la vue, lire `useNavSub()` / signaler `useSetNavSub()`
     (`src/lib/navSub.ts`, exemple `src/views/Planning.tsx`).
   - Un `id` ne change plus jamais une fois en ligne (favoris, onglets et droits
     enregistrés s'en servent).
3. **Le branchement** : dans `src/App.tsx`
   - `const MaPage = lazy(lazyImport(() => import("@/views/MaPage").then((m) => ({ default: m.MaPage }))));`
     (à côté de `Todo`) ;
   - `mapage: MaPage,` dans l'objet `VIEWS`. Sans ça : « Page introuvable » ;
   - réservée aux fondateurs : ajouter l'id à `FOUNDER_ONLY` ;
   - la page pose son propre titre : ajouter l'id à `NO_PAGE_HEADER`.
4. **Les textes** :
   - `src/lib/viewHints.ts` : une phrase simple sous le titre (« Les tâches de l'équipe, par
     priorité. ») ;
   - `src/lib/pageAliases.ts` : synonymes pour la recherche et ⌘K (facultatif).
5. **Ce qui suit tout seul** (rien à faire) : menu ordinateur, écran « Plus » de l'iPhone,
   palette ⌘K, recherche globale, Paramètres → « Pages affichées », favoris.
6. **Options** : rangée par défaut (`DEFAULT_HIDDEN_PAGES` de `src/lib/hiddenPages.ts`),
   pastille rouge « argent » (`LATE_BADGE` de `src/components/Sidebar.tsx`), pastilles
   d'activité (`src/lib/useNavBadges.ts`).
7. **Vérifier** : `npm run build`, puis `npm run dev` et ouvrir la page depuis le menu, la
   palette ⌘K et en largeur iPhone. Mettre à jour [`CARTE-DU-CODE.md`](CARTE-DU-CODE.md).

## 2. Ajouter un onglet à l'espace créateur (et ses traductions)

Exemple à copier : l'onglet « À faire » (`todo`).

1. **L'id** : dans `src/lib/creatorTabs.ts`, ajouter l'id à `CsTab` et à `CS_ALL_TABS`
   (sinon `normalizeCsTab` renvoie l'Accueil). Ne pas toucher `CS_MAIN_TABS` : la barre du
   bas a 5 onglets fixes, vérifiés par `creatorTabs.test.ts`.
2. **Le menu** : dans `src/views/CreatorSpace.tsx`
   - ajouter `{ id: "monid", label: "Mon libellé", icon: TtpX }` dans un groupe de
     `CREATOR_GROUPS` (comme `{ id: "todo", label: "À faire", icon: TtpTodo }`) ;
   - ajouter la phrase d'aide dans `TAB_HINTS` ;
   - ajouter le rendu `{tab === "monid" && ( … )}` à côté des autres blocs
     (ex. `{tab === "roadmap" && <CreatorRoadmap … />}`).
3. **Les textes** : tout texte visible passe par `t("Texte français")` (fourni par `useT()`
   de `src/lib/i18n.tsx` dans un composant, ou le `t` local de `CreatorSpace`). Variables :
   `t("Bonjour {name}", { name })`.
4. **Les traductions** : ajouter chaque texte français exact comme clé dans
   `src/lib/i18n/en-creatorSpace.ts` (ou `en-creatorPages.ts` pour une page annexe,
   `en-shared.ts` pour un composant partagé) :
   ```ts
   "À faire": "To-do",
   ```
   Garder exactement les mêmes `{variables}` : `src/lib/i18n.test.ts` le vérifie. Changer un
   texte français fait perdre sa traduction (la clé ne correspond plus) : mettre à jour la clé
   anglaise en même temps.
5. **Vérifier** : `npm run build`, puis l'aperçu de l'espace créateur depuis l'agence, en
   français et avec un créateur réglé en anglais (fiche créateur, colonne `lang`).

## 3. Ajouter une colonne en base sans casser la prod

L'assistant n'a que la clé publique : il écrit le SQL, Marc le lance. L'app doit marcher
**avant** et **après** le SQL. Exemple complet : `todos.creators`
(`supabase/sql/2026-10-21-taches-plusieurs-createurs.sql`, `src/lib/todoCreatorsDb.ts`).

1. **Le fichier de migration** : `supabase/sql/AAAA-MM-JJ-sujet.sql`, modèle
   `supabase/sql/2026-10-21-langue-createur.sql` :
   - un en-tête qui dit ce que ça fait, « Déjà foldé dans SETUP.sql », « Peut être relancé
     sans risque » ;
   - du SQL relançable : `add column if not exists`, `drop … if exists` avant `create` ;
   - une requête de contrôle à la fin (ce que Marc doit voir s'afficher) ;
   - jamais de secret : mettre un marqueur (`<CRON_SECRET>`, `COLLE_ICI`) à remplacer dans le
     SQL Editor.
2. **Le report dans `supabase/SETUP.sql`** : ajouter les mêmes lignes à leur place, avec un
   commentaire qui renvoie au fichier daté.
3. **La sécurité** : nouvelle table = RLS activée, lecture large et écriture stricte
   (`is_agency() or creator = my_creator()`), jamais `creator is null` dans une écriture.
4. **Le repli dans l'app** : tant que la colonne n'existe pas, Supabase répond une erreur
   (code `42703` ou `PGRST204`, message qui cite la colonne). Détecter ce cas et relire ou
   écrire sans la colonne. Modèles :
   - `creatorsColumnMissing` + `selectTodosFor` (`src/lib/todoCreators.ts`,
     `src/lib/todoCreatorsDb.ts`) ;
   - `aliasesColumnMissing` (`src/lib/mailAddresses.ts`) ;
   - `src/views/Briefs.tsx` relit sans `resume` si l'erreur cite cette colonne.
   Pour une fonction SQL absente : `isMissingFunction` (`src/lib/appState.ts`).
5. **Le tableau d'état** : ajouter une ligne en tête du tableau de
   `supabase/sql/README.md`, statut `⏳ À faire`, avec le nom du fichier à lancer.
6. **Commit, puis message à Marc** : le nom du fichier à coller dans le SQL Editor et ce que la
   requête de contrôle doit afficher.
7. **Après application** : vérifier avec la clé publique (comptes de test `ZZZ-*`
   seulement), passer la ligne en `✅`, et retirer le repli quand il ne sert plus.

## 4. Ajouter ou modifier une Edge Function

Exemple court à copier : `supabase/functions/team-notify/index.ts`.

1. **Le code** : `supabase/functions/<nom>/index.ts`, en-tête qui dit le rôle, l'appelant,
   l'authentification et les secrets. Squelette habituel :
   - `Deno.serve`, `corsHeaders(req.headers.get("Origin"))` et réponse à `OPTIONS`
     (`_shared/google.ts`) ;
   - client serveur `getServiceClient()` ;
   - contrôle du JWT (`sb.auth.getUser(bearer)`) puis du rôle dans `profiles`, ou
     `CRON_SECRET` comparé à temps constant pour un cron.
2. **La logique pure** va dans `supabase/functions/_shared/<nom>.ts` (sans réseau), testée
   par un `.test.ts` qui l'importe **avec** l'extension `.ts` (modèles
   `_shared/meetEvent.test.ts`, `src/lib/pushPayload.test.ts`).
3. **`supabase/config.toml`** : ajouter un bloc `[functions.<nom>]` avec `verify_jwt` et une
   ligne de commentaire. `verify_jwt = false` est obligatoire pour un cron, un webhook ou un
   retour OAuth (sinon 401 avant le code), et l'authentification se fait alors dans le code.
4. **L'appel depuis l'app** : `supabase.functions.invoke("<nom>", { body })`, dans un fichier
   de `src/lib/` de préférence.
5. **Un changement de contrat** (nouveau champ, nouvelle action) doit rester compatible avec
   l'ancienne version déployée : l'app est en ligne avant la fonction. Modèle :
   [`mails-contrat-v2.md`](mails-contrat-v2.md) (la fonction renvoie un écho que l'app teste).
6. **Le tableau d'état** : ligne `⏳ À faire` dans `supabase/sql/README.md` avec la commande.
7. **Donner la commande à Marc** (l'assistant ne déploie jamais) :
   ```bash
   supabase functions deploy <nom> --project-ref zizvggziggswhrbuyhuo
   ```
   Plusieurs fonctions : les noms à la suite. `ttp-mcp` : ajouter `--no-verify-jwt`. Nouveau
   secret : `supabase secrets set NOM=… --project-ref zizvggziggswhrbuyhuo`, tapé par Marc.
   Nouveau cron : un fichier SQL (étape 3 de la recette précédente).
8. Mettre à jour la section 6 de [`CARTE-DU-CODE.md`](CARTE-DU-CODE.md).

## 5. Ajouter un outil au connecteur Claude (`ttp-mcp`)

Fichier : `supabase/functions/ttp-mcp/tools.ts`.

1. **Définir l'outil** sur le modèle d'un outil existant :
   - lecture : `lister_createurs` ;
   - écriture : `creer_tache` ou `preparer_reponse_mail`, avec `write: true`.

   Forme :
   ```ts
   const monOutil: Tool = {
     name: "mon_outil",                 // snake_case, en français
     title: "Titre court",
     description: "Ce que fait l'outil, quand l'utiliser, ce qu'il ne fait pas.",
     write: true,                       // seulement s'il écrit dans l'app
     // founder: true,                  // seulement pour des données réservées aux fondateurs
     inputSchema: { type: "object", properties: { … }, required: [ … ], additionalProperties: false },
     run: async (sb, ctx, a) => { … return ok("…"); },
   };
   ```
2. **L'ajouter au tableau `TOOLS`** en bas du fichier.
3. **Règles** :
   - `write: true` publie `readOnlyHint: false` : Claude demande l'accord de l'utilisateur
     avant chaque appel ;
   - rien ne part vers l'extérieur : un mail est un brouillon, un message va dans la file
     « À valider » ;
   - valider chaque argument (`str`, `int`, nom exact du roster via `rosterName`) ;
   - ne jamais exposer le coffre d'identifiants, les IBAN ni les jetons ;
   - chaque appel est noté dans `mcp_log` (visible dans Paramètres → Claude).
4. **Mettre à jour** le commentaire d'en-tête de `tools.ts` et, si besoin, les
   `INSTRUCTIONS` de `ttp-mcp/index.ts`.
5. **Pour un bouton « … avec Claude » dans l'app** (sans clé API) :
   - l'app ouvre claude.ai avec la demande ;
   - Claude écrit dans une table ou une colonne avec l'outil ;
   - l'app relit toutes les 5 secondes.

   Modèles :
   - `src/components/mail-claude.tsx` (table `mail_reply_drafts`) ;
   - `src/components/brief-resume.tsx` (colonne `briefs.resume`).
6. **Déploiement par Marc** :
   `supabase functions deploy ttp-mcp --no-verify-jwt --project-ref zizvggziggswhrbuyhuo`,
   plus le SQL de la table ou de la colonne s'il y en a une (recette 3).

## 6. Ajouter un document PDF

Tous les PDF partagent l'identité de `src/lib/pdfDoc.ts` : pas de nouvelle feuille de style.
Exemple à copier : `briefHTML` dans `src/views/Briefs.tsx`.

1. **Construire le HTML** :
   - document simple : `pdfShell({ title, eyebrow, heading, sub?, ref?, body, lang? })` avec
     les briques `pdfHeading`, `pdfMeta`, `pdfSection`, `pdfKpis`, `pdfTicks`, `pdfShots` ;
   - contrat : `docHead(titre, CONTRACT_CSS)` + `contractHead` + `contractTitle` (modèle
     `src/views/Contrats.tsx`).
2. **Nom du fichier** : `title: pdfFileTitle("Brief", "Marque x Créateur")`. Le `<title>`
   devient le nom proposé à l'enregistrement.
3. **Échapper** tout texte saisi avec `esc()`. Les images et polices passent par
   `appAssetUrl()` (adresses absolues obligatoires dans l'iframe d'impression).
4. **Imprimer** : `printHtml(html)` (`src/lib/printPdf.ts`) sur un clic.
5. **Côté créateur** : textes via `t()`, et `lang: "en"` pour un créateur anglophone (modèle
   `src/components/MonthlyReport.tsx`).
6. **Vérifier** : `npm run build`, puis « Enregistrer au format PDF » dans Chrome et Safari
   (nom du fichier, polices Instrument, sauts de page).

## 7. Mettre en ligne et vérifier

`main` est la production : un push met l'app à jour en 1 à 2 minutes.

1. Gros changement : poser d'abord une sauvegarde :
   ```bash
   git tag sauvegarde-AAAA-MM-JJ && git push origin sauvegarde-AAAA-MM-JJ
   ```
2. Travailler sur une branche courte, puis `npm run build` vert.
3. Commit en français, une phrase « Zone : ce qui change », terminé par la ligne
   `Co-Authored-By` de l'assistant. Vérifier qu'aucun fichier sensible n'est inclus
   (`git status`, `git diff --cached`).
4. Fusionner dans `main`, `git push origin main`, supprimer la branche.
5. Vérifier :
   - le déploiement GitHub Actions « Deploy to GitHub Pages » est vert ;
   - le numéro en ligne est celui du commit : `curl -s https://app.ttpcreators.pro/version.json`
     affiche les 12 premiers caractères de `git rev-parse HEAD` ;
   - les pages ouvertes se mettent à jour seules à la navigation suivante
     (`src/lib/appUpdate.ts`).
6. SQL ou fonctions à appliquer : donner à Marc les fichiers et commandes, ligne `⏳` dans le
   tableau d'état.

## 8. Revenir en arrière

L'app (le code) :

- **Annuler un commit précis** (cas normal) : `git revert <sha>`, `npm run build`, push sur
  `main`. L'historique est gardé.
- **Revenir à une sauvegarde** : `git tag -l 'sauvegarde-*'` liste les tags.
  - Voir l'écart : `git diff sauvegarde-AAAA-MM-JJ HEAD --stat`.
  - Annuler tout ce qui a suivi, en un commit :
    ```bash
    git revert --no-commit sauvegarde-AAAA-MM-JJ..HEAD
    git commit
    ```
    Puis build et push.
- **Jamais de `git push --force` sur `main`.**

Une Edge Function :

- Remettre l'ancienne version du dossier : `git checkout <sha> -- supabase/functions/<nom>`.
- Commit, puis Marc redéploie avec la commande habituelle.

La base :

- Pas de retour automatique.
- Écrire une migration inverse datée, avec son repli dans l'app (recette 3).
- Le blob agence a une sauvegarde quotidienne de 30 jours (`app_state_backups`, cron
  `ttp-app-state-backup`, voir `supabase/sql/07-blob-atomique-et-backup.sql`).
