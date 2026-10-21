# TTP Suite : application de l'agence (espace agence + espace créateur)

Point d'entrée pour toute IA ou tout développeur qui reprend le projet. À lire en entier
avant de toucher au code. Les autres outils d'IA lisent [`AGENTS.md`](AGENTS.md), qui renvoie
ici.

**En production sur https://app.ttpcreators.pro.** Tout push sur `main` met l'app à jour en
1 à 2 minutes pour toute l'agence et tous les créateurs. Agir en conséquence.

## À lire selon le besoin

| Document | Pour |
|---|---|
| [`supabase/sql/README.md`](supabase/sql/README.md) | **État de la prod** : SQL et fonctions appliqués (✅) ou à faire (⏳). À lire en premier pour reprendre le fil. |
| [`docs/CARTE-DU-CODE.md`](docs/CARTE-DU-CODE.md) | Où vit chaque page, composant, module et Edge Function. |
| [`docs/RECETTES.md`](docs/RECETTES.md) | Les changements courants pas à pas (page, onglet créateur, colonne, fonction, outil Claude, PDF, mise en ligne, retour arrière). |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Flux de données, rôles, blob agence, frontière créateur ↔ agence. |
| [`docs/README.md`](docs/README.md) | Index de toute la documentation. |

## Le produit en bref

TTP Creators est une agence de talents (créateurs de contenu et sportifs). Une seule app,
deux espaces, choisis à la connexion par `profiles.role` :

- **Espace agence** (`role = 'agency'`) : roster, scouting et sourcing, contacts et
  prospection, collabs en 11 étapes, briefs, contrats, facturation et reversements, planning
  (Google Agenda), mails (deux boîtes Gmail), media kits, gifting, statistiques, agents IA.
  Deux niveaux : fondateur (tout) et membre (sans Facturation, Relances, Reversements, Fins
  de contrat, Accès, Diagnostic, Agents : liste `FOUNDER_ONLY` dans `src/App.tsx`).
  Interface en français uniquement.
- **Espace créateur** (`role = 'creator'`, `src/views/CreatorSpace.tsx`) : ses missions et
  briefs, sa boîte mail, ses gains et factures, son media kit, ses statistiques, sa to-do.
  Chaque créateur ne voit que ses données (RLS). En français ou en anglais selon
  `creators.lang`.

Repo frère : le **site vitrine** `websitettpcreators` (ttpcreators.pro). Il héberge aussi les
media kits publics (`/mediakit/<slug>/`), lus depuis la vue Supabase `public_mediakit`. Les
deux repos partagent le **même projet Supabase**.

## Stack

React 19 + Vite + TypeScript strict, Tailwind v4 + briques shadcn/Radix
(`src/components/ui/`), motion, recharts. Supabase : Postgres + RLS, Auth, Storage, Edge
Functions Deno (`supabase/functions/`). Icônes : **toujours** `@/components/icons` (voir
Conventions). Vues = `src/views/`, coque = `src/App.tsx`, logique = `src/lib/`.

## Commandes

```bash
npm install
npm run dev
npm run build   # PORTE DE QUALITÉ : oxlint && vitest run && tsc -b && vite build
```

**Toujours faire passer `npm run build` avant de commit.** Pas de commit d'un code qui ne
compile pas ou d'une tâche à moitié faite.

## Déploiement

- **Production = branche `main`.** `.github/workflows/deploy.yml` : `npm ci && npm run build`,
  puis `upload-pages-artifact` et `deploy-pages`. Domaine `app.ttpcreators.pro`
  (`public/CNAME`).
- **Edge Functions** : **PAS déployées par la CI.** Déploiement MANUEL par Marc :
  `supabase functions deploy <noms> --project-ref zizvggziggswhrbuyhuo`
  (`ttp-mcp` : ajouter `--no-verify-jwt`).
- **SQL** : lancé à la main par Marc dans le SQL Editor de Supabase.
- Vérifier une mise en ligne : `https://app.ttpcreators.pro/version.json` affiche les 12
  premiers caractères du commit déployé.

## Supabase : projet `zizvggziggswhrbuyhuo`

- **Schéma = source de vérité : [`supabase/SETUP.sql`](supabase/SETUP.sql)** (tables,
  fonctions `is_agency()` / `my_creator()`, RLS, Storage, rôle agence). Relançable pour tout
  recréer.
- **Migrations** = `supabase/sql/*.sql`, une par changement (`AAAA-MM-JJ-sujet.sql`),
  relançables sans risque, avec une requête de contrôle à la fin.
- **État de reprise = [`supabase/sql/README.md`](supabase/sql/README.md)** : tableau ✅
  appliqué / ⏳ à faire.
- La clé **anon** (dans `src/lib/supabase.ts`) est **publique par design** ; les données sont
  protégées par la RLS. La clé `service_role` n'existe que dans les Edge Functions.
- `verify_jwt` de chaque fonction : `supabase/config.toml`. Une fonction appelée par un cron,
  un webhook ou un retour OAuth doit être en `verify_jwt = false` et s'authentifier dans son
  code (`CRON_SECRET`, signature, `state` signé).

## ⚠️ Règle prod : « l'assistant prépare, l'utilisateur applique »

L'assistant n'a que la **clé anon** : il **ne peut PAS** faire de DDL, changer les réglages
Auth, ni déployer les Edge Functions (le harnais bloque à raison l'usage de credentials de
prod). Donc, pour tout changement de base / auth / fonction :

1. l'assistant **écrit** le SQL (foldé dans `SETUP.sql` **et** déposé dans `supabase/sql/`
   comme fichier daté) ou le code de fonction, **commit + push** ;
2. l'assistant **donne à l'utilisateur** le SQL à lancer / le toggle dashboard / la commande
   `supabase functions deploy` ;
3. après application, l'assistant **vérifie** avec la clé anon (comptes de test `ZZZ-*`
   uniquement, jamais de vraie donnée) et **met à jour le tableau d'état** du runbook.

Ce cycle est la raison d'être du runbook : il rend la reprise possible d'une session à
l'autre. **Mettre le tableau à jour à CHAQUE changement.** Comme l'app part en ligne avant le
SQL et les fonctions, elle doit marcher dans les deux états (voir Pièges connus).

## Sécurité

Plusieurs audits adversariaux menés (identité et privilège, OWASP). Détail dans le runbook.

- Motif RLS de référence : **lecture large, écriture stricte**
  (`is_agency() or <col> = my_creator()`). **Jamais** de branche `creator is null` en
  écriture.
- Inscription publique **désactivée** : les comptes se créent via la fonction `create-access`
  (fondateurs).
- `handle_new_user` ne fait **jamais** confiance au `creator_name` envoyé par le client.
- Le trigger `creators_guard` empêche un créateur d'écrire les colonnes sensibles de sa fiche.
- Un créateur ne lit jamais le blob agence : ce qu'il doit voir passe par une fonction qui
  filtre sur son nom (`creator-history`, `debrief-history`, `creator-report`, `creator-mail`).

## Secrets et données personnelles

**Le dépôt est PUBLIC.**

- Jamais de `.env`, de clé (`.p8`, `.p12`, `.pem`, `.key`), de mot de passe, de jeton ou de
  `CRON_SECRET` dans un fichier commité. `.gitignore` les exclut ; vérifier `git status` avant
  chaque commit.
- Tous les secrets serveur sont des secrets Supabase, posés par Marc avec
  `supabase secrets set`.
- Un SQL qui a besoin d'un secret contient un marqueur (`<CRON_SECRET>`, `COLLE_ICI`) que Marc
  remplace dans le SQL Editor. Un ancien `CRON_SECRET` a déjà fuité dans le dépôt et a dû être
  changé : voir `supabase/sql/2026-10-14-rotation-secret-crons.sql`.
- Aucune donnée personnelle dans le code, les docs, les tests ou les captures : pas
  d'adresse, de téléphone, d'IBAN ni de vrais chiffres de créateurs. Utiliser des noms fictifs.

## Conventions d'interface

- **Vocabulaire** : toujours « créateurs » (accords au masculin), jamais « créatrices », dans
  l'app comme dans les docs. Certains ids historiques (`creatrices`) et commentaires anciens
  restent : ne pas renommer un id.
- **Ponctuation** : pas de tiret long (—) ni de demi-tiret (–) dans les textes affichés
  qu'on écrit ou modifie. Utiliser « : », « , » ou une nouvelle phrase. Des « — » anciens
  existent encore (valeur vide, quelques messages) : les corriger quand on passe dessus.
  `pdfFileTitle` les retire des noms de fichiers ; les outils Claude les retirent du texte
  qu'ils déposent.
- **Langue** : interface en français. L'espace créateur est traduit en anglais par
  `src/lib/i18n.tsx` : le texte français est la clé (`t("Mes factures")`), les traductions
  vivent dans `src/lib/i18n/en-shared.ts`, `en-creatorSpace.ts`, `en-creatorPages.ts`, et
  `src/lib/i18n.test.ts` vérifie que chaque traduction garde les mêmes `{variables}`. Tout
  nouveau texte de l'espace créateur passe par `t()` et reçoit sa traduction.
- **Icônes** : toujours importées depuis `@/components/icons`, jamais depuis `lucide-react`.
  `src/components/icons/index.ts` réexporte lucide et remplace les icônes courantes (Mail,
  Receipt, Users…) par les icônes TTP de `src/components/icons/ttp-icons.tsx` : un export
  nommé l'emporte sur `export *`. Une nouvelle icône métier se dessine dans `ttp-icons.tsx`.
- **Couleurs** : jetons uniquement, définis dans `src/index.css` (seul endroit des couleurs,
  tailles, rayons). Accent : `--accent` (bleu par défaut, `--primary` et `--ring` le
  relisent). Thèmes par `data-theme` sur `<html>` : `clair`, `verre`, `noir` (`auto` choisit
  clair ou noir ; logique dans `src/lib/accent.ts`).
- **Sobriété** : gris par défaut, pas de pastel ni d'icônes multicolores. La couleur dit
  seulement une action ou un état, via les jetons `--st-*` et `src/lib/statusTone.ts` (un sens
  par couleur) :
  - `ok` (vert) : payé, signé, validé ;
  - `progress` (bleu) : en cours, envoyé ;
  - `info` ;
  - `wait` (orange) : en attente, à relancer ;
  - `late` (rouge) : **argent en retard uniquement** ;
  - `closed` (gris).

  La priorité haute d'une tâche est en rouge vif (`bg-priority`). La sélection est en bleu
  (accent).
- **Garder** les boutons bleus et la police Inter (`--font-app` dans `src/index.css`). Une
  maquette sert pour la mise en page, pas pour changer ces deux choix.
- **Une phrase d'aide** sous le titre de chaque page (`src/lib/viewHints.ts`, `TAB_HINTS` côté
  créateur), en mots simples.

## Conventions de code

- **Logique pure** dans `src/lib/<nom>.ts` (ni React ni Supabase), avec son test
  `src/lib/<nom>.test.ts` à côté. Accès base dans des fichiers séparés (`*Db.ts`, `use*.ts`).
  Un module pur ne doit pas importer `supabase.ts` (le client plante sous Node dans les tests).
- **Logique pure serveur** dans `supabase/functions/_shared/<nom>.ts` (ou `logic.ts` dans le
  dossier de la fonction), testée par un `.test.ts` qui l'importe **avec** l'extension `.ts`.
- **État d'interface mémorisé** (onglet, filtre) : `useStickyState` de
  `src/lib/useStickyState.ts` (ex. `useStickyState("briefs:vue", ["board", "list"], "list")`,
  rangé en localStorage sous `ttp:ui:briefs:vue`), valeurs permises listées.
- **Réglages partagés de l'agence** : le blob `module_rows` ligne `__app_state__`, via
  `src/lib/appState.ts`.
  - Lecture : `useAppState(select)`.
  - Avant d'écrire à partir de ce qu'on a lu : relire frais (`invalidateAppState()` puis
    `getAppState()`).
  - Écrire une clé entière : `saveAppStateKey` (fonction SQL `app_state_set`).
  - Ne toucher que ses entrées : `mergeAppStateKey` pour un objet (`app_state_merge`),
    `listAppStateKey` pour une liste d'objets à `id` (`app_state_list`).
  - Toujours vérifier le booléen renvoyé.
  - Le blob est réservé à l'agence (RLS).
- **Événements Agenda** : toute modification depuis l'app repasse par `src/lib/db.ts` (qui
  pose `sync_source = 'agence'` pour la synchro Google).
- **Mises en ligne sans écran d'erreur** :
  - chaque build écrit `version.json` (`vite.config.ts`) ;
  - `src/lib/appUpdate.ts` le surveille ;
  - toute page chargée à la demande passe par `lazy(lazyImport(() => import(...)))`, qui
    recharge l'app si une nouvelle version est en ligne ;
  - en cas d'échec de chargement, `recoverStaleApp` (`src/components/ErrorBoundary.tsx`) prend
    le relais.
- **Pas de refonte au passage** : ne pas renommer ni déplacer du code sans demande ; un `id`
  de page, d'onglet ou de clé de blob ne change jamais.

## Mécanismes à connaître

- **Connecteur Claude** (`supabase/functions/ttp-mcp`) : serveur MCP + OAuth 2.1 (PKCE).
  - Page d'accord : `/connecteur/` (`src/connecteur/main.tsx`).
  - Jetons hachés, révocables dans Paramètres → Claude ; chaque appel est journalisé
    (`mcp_log`).
  - Outils dans `tools.ts`. Un outil qui écrit porte `write: true`, ce qui fait demander
    l'accord de l'utilisateur à Claude avant chaque appel.
  - Les mails ne sont jamais envoyés : brouillon seulement. Les outils `founder: true` sont
    cachés aux membres.
- **« Rédiger avec Claude » / « Résumer avec Claude »** : aucune clé API, on passe par
  l'abonnement Claude et le connecteur.
  1. L'app ouvre claude.ai avec la demande écrite.
  2. Claude lit puis écrit avec un outil du connecteur.
  3. L'app relit toutes les 5 secondes et affiche le résultat.

  Mails : outil `preparer_reponse_mail`, table `mail_reply_drafts`, composant
  `src/components/mail-claude.tsx`. Briefs : outil `resumer_brief`, colonne `briefs.resume`,
  composant `src/components/brief-resume.tsx`.
- **Notifications push** : un seul module d'envoi `supabase/functions/_shared/push.ts`
  (VAPID). Format unique `_shared/pushPayload.ts`, miroir des liens profonds de
  `src/lib/deepLink.ts`. Réception et affichage dans `public/sw.js` ; abonnement côté app
  dans `src/lib/push.ts`. Sur iPhone, le push ne marche que dans l'app installée sur l'écran
  d'accueil.
- **Deux boîtes Gmail** (`supabase/functions/_shared/gmailBox.ts`) :
  - partnerships@ passe par la connexion Google OAuth de l'app ;
  - talent@ passe par un compte de service (délégation de domaine).

  Le contrat entre l'app et les fonctions `gmail-*` est dans
  [`docs/mails-contrat-v2.md`](docs/mails-contrat-v2.md). La boîte d'un créateur
  (`creator-mail`) est filtrée côté serveur.
- **Crons** : `pg_cron` appelle les fonctions avec `CRON_SECRET`, en heures UTC (les résumés
  sont doublés, par exemple `6,7`, pour tomber à 8 h à Paris toute l'année). Liste dans
  `docs/CARTE-DU-CODE.md`, section 6.
- **Fonctions en attente d'un accord** (Meta, TikTok, Google) : interrupteurs dans
  `src/lib/features.ts`, à passer à `true` après l'accord.

## Documents PDF (brief, bilan, facture, contrats, rapport)

Tous les PDF de l'app partagent UNE identité, celle des media kits du site (direction
« Éditorial », 2026-10-07).

- Briques : `src/lib/pdfDoc.ts`.
  - Style commun et `docHead` / `docMast` / `docFoot`.
  - `pdfShell` pour les documents simples (brief, bilan, rapport).
  - `CONTRACT_CSS` pour les contrats.
  - `pdfFileTitle` pour le nom de fichier.
- Polices Instrument Serif et Sans dans `public/fonts/`.
- Impression via `printHtml` (`src/lib/printPdf.ts`), qui attend polices et images.
- Tout nouveau PDF réutilise ces briques : pas de nouvelle feuille de style.
- Le corps d'EMAIL du bilan (`debriefHTML`) reste à part (styles en ligne : les clients mail
  ignorent `<style>`).

## Git et GitHub

- `main` = production. Chaque chantier se fait sur une branche courte, fusionnée dans `main`
  puis supprimée.
- Commits en français, une phrase « Zone : ce qui change » (ex. « Mails : filtre « Non lus »
  côté agence et côté créateur »). Ils se terminent par la ligne `Co-Authored-By` de
  l'assistant.
- Commit seulement en fin de tâche, build vert. Le push se fait avec le compte du projet
  (alias SSH du dépôt, jamais `gh auth switch`).
- Tags :
  - `sauvegarde-AAAA-MM-JJ` (suffixe possible) avant un gros changement ;
  - `archive/…` pour garder une piste abandonnée.

  Retour arrière : `git revert`, jamais de `push --force` sur `main` (voir
  `docs/RECETTES.md`, section 8).
- Pull requests et tickets : modèles dans `.github/` (checklist build, SQL et fonctions à
  appliquer, tableau d'état, captures).

## Pièges connus

- **Colonne ou table pas encore créée en prod** : l'app est en ligne avant le SQL.
  - Toute lecture ou écriture d'une nouvelle colonne prévoit un repli : erreur `42703` /
    `PGRST204` ou message qui cite la colonne, puis on recommence sans elle. Modèles :
    `src/lib/todoCreatorsDb.ts`, `aliasesColumnMissing` dans `src/lib/mailAddresses.ts`,
    `src/views/Briefs.tsx` (colonne `resume`).
  - Fonction SQL absente : `isMissingFunction` (`src/lib/appState.ts`).
- **Blob agence** : ne jamais confondre « lecture échouée » et « ligne absente ». Sinon une
  seconde ligne `__app_state__` presque vide masque tout le blob. Toujours relire frais avant
  de fusionner.
- **Nouvelle version d'une Edge Function** : l'app peut parler à l'ancienne version encore
  déployée. Garder le contrat compatible et faire renvoyer un écho que l'app teste
  (`docs/mails-contrat-v2.md`). Ne rien ajouter à `gmail-trash`.
- **`verify_jwt`** : une fonction de cron, de webhook ou de retour OAuth sans bloc
  `verify_jwt = false` dans `config.toml` est rejetée en 401 avant le code.
- **GitHub Pages et `.well-known/`** : `upload-pages-artifact` ignore les dossiers cachés.
  `include-hidden-files: true` dans `deploy.yml` est indispensable au connecteur Claude.
- **GitHub Pages est sensible à la casse** des noms de fichiers (macOS non) : pour un
  renommage de casse, `git mv -f`.
- **Pas de routeur** : la page active est gardée en localStorage (`ttp:view`), et les liens
  profonds sont des paramètres (`/?open=mails&thread=…`). Pas besoin de `404.html`.
- **Nom du PDF dans Chrome** : Chrome prend le titre de la page, pas celui de l'iframe.
  `printHtml` prête le `<title>` du document à la page le temps d'imprimer : ne pas retirer ce
  mécanisme.
- **PDF** : images et polices en adresse absolue (`appAssetUrl`), car l'iframe d'impression
  est en `about:srcdoc`.
- **Mails créateur** : `creator-mail` ne montre que les messages qui concernent le créateur
  (ses adresses ou son libellé), plus les réponses de l'agence à la marque dans ces fils.
  - Un transfert interne entre adresses de l'agence reste caché.
  - Un alias de créateur ne peut jamais être une boîte partagée de l'agence.
- **iPhone** :
  - un `window.open` lancé après un `await` est bloqué : ouvrir l'onglet dans le clic
    (`src/lib/openLater.ts`) ;
  - le push exige l'app installée ;
  - la barre d'état change au lancement suivant seulement.
- **Service worker** : il ne met en cache que la même origine (jamais Supabase ni Google). La
  page d'accueil est demandée au réseau d'abord. Pour tout purger, changer le nom des caches
  (`ttp-shell-v2`, `ttp-assets-v2`).
- **Meta retire les @** des textes de posts : la détection des comptes cités se fait sans @
  (`_shared/mentions.ts`).
- **Quotas** :
  - Meta, par heure glissante : les scans s'arrêtent à 80 % (`ig_quota`) ;
  - YouTube, 10 000 unités par jour (`yt_quota`).
- **Traductions** : changer un texte français fait perdre sa traduction anglaise (la clé ne
  correspond plus). Aucun test ne le voit : mettre à jour la clé dans `src/lib/i18n/` en même
  temps.
- **Ids partagés avec le site** : les thèmes et l'adresse des media kits
  (`src/lib/mediakitThemes.ts`, `src/lib/mediakitSlug.ts`) doivent rester identiques au site
  vitrine.
- **Textes des notifications** (`src/lib/notifTexts.ts`) : modifier un texte ne demande aucun
  redéploiement. Ajouter ou retirer une clé demande de redéployer `daily-digest`.
- **Fichiers SQL anciens** :
  - `supabase/PUSH_SETUP.sql` contient un ancien cron, remplacé par
    `sql/06-crons-resume-matin-semaine.sql` ;
  - ne jamais relancer l'ancien « schéma maître » côté Supabase : utiliser `SETUP.sql` ;
  - `sql/2026-10-19-connecteur-claude.sql` n'est pas encore foldé dans `SETUP.sql` : le
    fichier daté fait foi.
- **DNS** : ne jamais toucher aux enregistrements mail (MX, SPF, DMARC) du domaine.
