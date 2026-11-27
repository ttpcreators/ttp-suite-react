# TTP Suite : application de l'agence (espace agence + espace créateur)

Point d'entrée pour toute IA ou tout développeur qui reprend le projet. À lire en entier
avant de toucher au code. Les autres outils d'IA lisent [`AGENTS.md`](AGENTS.md), qui renvoie
ici.

**En production sur https://app.ttpcreators.pro.** Chaque PR fusionnée dans `main` met l'app à
jour en 1 à 2 minutes pour toute l'agence et tous les créateurs. Agir en conséquence. `main` est
protégée : on n'y pousse jamais directement (voir « Travailler à deux »).

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
compile pas ou d'une tâche à moitié faite. La session en ligne de Gianni ne peut pas le lancer :
pour elle, le contrôle « build » de la PR fait foi (voir « Travailler à deux »).

## Déploiement

- **Production = branche `main`**, protégée : PR obligatoire et contrôle « build » vert (voir
  « Travailler à deux »). À chaque fusion, `.github/workflows/deploy.yml` lance
  `npm ci && npm run build`, puis `upload-pages-artifact` et `deploy-pages`. Domaine
  `app.ttpcreators.pro` (`public/CNAME`).
- **Edge Functions** : **jamais déployées par une fusion.** Toujours depuis `main` à jour. Une
  session ne déploie qu'après le « oui » de Marc ou de Gianni pour ce déploiement précis (voir
  « Règle prod »). Deux façons :
  - par GitHub : « Déploiement des fonctions » (`.github/workflows/deploy-fonctions.yml`), lancé
    exprès en nommant les fonctions (onglet Actions › Run workflow, ou par une session). Il part
    seulement de `main`, refuse un nom inconnu, prend 12 fonctions au plus, lit `verify_jwt` dans
    `supabase/config.toml` et a besoin du secret GitHub `SUPABASE_ACCESS_TOKEN` ;
  - à la main, par Marc : `supabase functions deploy <noms> --project-ref zizvggziggswhrbuyhuo`
    (`ttp-mcp` : ajouter `--no-verify-jwt`).
- **SQL** : dans le SQL Editor de Supabase par Marc, ou par une session (connecteur Supabase)
  après le « oui » de Marc ou de Gianni pour ce SQL précis (voir « Règle prod »).
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

## ⚠️ Règle prod : « la session prépare, la personne décide »

Une session Claude (de Marc ou de Gianni) prépare tout changement de base, de réglage ou de
fonction. Elle ne l'applique qu'avec un « oui » explicite, donné pour ce SQL ou ce déploiement
précis :

1. **Préparer** : le SQL (fichier daté dans `supabase/sql/` **et** foldé dans `SETUP.sql`) ou le
   code de la fonction, par une PR, avec une ligne `⏳` dans le tableau d'état
   (`supabase/sql/README.md`).
2. **Appliquer après le « oui »** de la personne pour qui elle travaille, Marc ou Gianni : le SQL
   par le connecteur Supabase, la fonction par « Déploiement des fonctions » (depuis `main`, donc
   après la fusion). Avant un déploiement, vérifier que la version en ligne ne vient pas d'une
   branche pas encore fusionnée (date du dernier déploiement, PR ouvertes qui touchent la
   fonction) : dans le doute, s'arrêter et le dire. Respecter l'ordre noté dans le tableau (SQL
   puis fusion, ou l'inverse).
3. **Une seule personne à la fois** touche la prod : si Marc et Gianni ont chacun un SQL ou un
   déploiement prêt, ils se préviennent et passent l'un après l'autre. Un SQL et un déploiement
   liés passent aussi l'un après l'autre, chacun avec son « oui ».
4. **Vérifier** : lancer la requête de contrôle, essayer avec les comptes de test `ZZZ-*`
   seulement (jamais une vraie donnée), puis passer la ligne en `✅`.

Restent à Marc : les secrets (`supabase secrets set`), les réglages Auth et ceux des tableaux de
bord (Supabase, Google, Meta…). Ni Alfred ni un agent du connecteur n'appliquent de SQL ni ne
déploient.

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
- Le trigger `creators_guard` empêche un créateur d'écrire les colonnes sensibles de sa fiche et
  les tarifs de son media kit (`hideRates`, `rates`, `ratesNote`, `ratesNoteEn`). Le déclencheur
  `todos_a_creators_guard` (fonction `todos_creators_guard`) bride ses tâches : il ne choisit ni
  l'origine (`source`) ni la liste des créateurs, et le « fait par » (`done_by`) est toujours le
  nom du compte connecté.
- Un créateur ne lit jamais le blob agence : ce qu'il doit voir passe par une fonction qui
  filtre sur son nom (`creator-history`, `debrief-history`, `creator-report`, `creator-mail`).
- **Tâches et rendez-vous internes** (24/11) : une tâche de l'agence (`source = 'agency'`) est
  interne, sauf si elle est cochée « Visible par le créateur » (`visible_createur`). Visibles par
  défaut : les tâches écrites à la main pour un créateur et celles d'Alfred ou du connecteur
  (`creer_tache`). Internes : les rappels automatiques des collabs et les rendez-vous
  « Tâche : … » (`events.interne`, déclencheur `events_interne_auto`). Toute nouvelle lecture
  côté créateur applique la même règle : RLS en base, `visiblePourCreateur`
  (`src/lib/todoVisibility.ts`) dans l'app.
- **Storage** : bucket `avatars` limité aux photos (pas de SVG) et à 25 Mo ; bucket `documents`
  limité à 25 Mo par fichier. Pages publiques plafonnées : `rdv` (table `rdv_journal` : 10
  réservations par heure, 2 par jour et par adresse) et `site-lead` (30 demandes par heure).
- **OAuth** : chaque `state` signé porte son usage (`via`, `_shared/state.ts`), et un retour
  refuse un jeton émis pour un autre usage. Les adresses de retour du connecteur sont fermées
  (`_shared/oauthRetour.ts`).
- **Réservé aux fondateurs** côté serveur : `create-access`, `google-disconnect`,
  `creator-box-mail`, le lien de connexion Instagram (`ig-connect`, action `lien`) et les outils
  `founder: true` du connecteur.
- **Agents du connecteur** : une connexion « agent autonome » (Alfred) fait valider ses envois et
  ses actions irréversibles dans la page Agents (voir « Mécanismes à connaître »).

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
- **Une phrase d'aide par page** (`src/lib/viewHints.ts`, `TAB_HINTS` côté créateur), en mots
  simples, derrière le « ? » à côté du titre (`PageFrame`), jamais affichée en permanence.
- **Règles d'écriture de l'interface** (Marc, 2026-10-22), à respecter partout :
  - un bouton : un verbe, deux mots maximum (« Écrire », « Copier l'email ») ; une même
    action porte le même nom partout ; seul le style (plein ou gris) dit si c'est urgent ;
  - un titre de ligne : 45 caractères maximum, ce qui dépasse va dans le détail ;
  - les métadonnées sous un titre : trois éléments maximum, séparés par « · » ;
  - les dates : « 21 oct. » pour une date (`fmtDay`), « 23 j » ou « 4 mois » pour une durée
    (`fmtAgoDays`, `fmtAgoSince`), tous dans `src/lib/dates.ts` ; l'heure seulement là où elle
    est l'information (`fmtDayTime`) ; jamais de format maison dans une page (les documents
    PDF et factures gardent leur date longue ou `frDate`) ;
  - les états vides : un seul mot, « Aucun », ou un tiret « — » (`EMPTY`), seule exception à
    la règle du tiret ci-dessus ;
  - les explications : jamais affichées en permanence, toujours derrière un « ? »
    (`src/components/ui/help-tip.tsx`) ;
  - pas de doublon : une info ou un filtre n'apparaît qu'une fois par page ; les filtres
    d'une page = un bouton « Filtres » (`FilterPanel`), pas une carte.

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
  - Le blob est réservé à l'agence (RLS). L'argent (lignes des factures, banques,
    versements, commissions) vit dans la ligne `__finance_state__`, réservée aux
    fondateurs : lue et écrite automatiquement par les mêmes fonctions (voir
    `docs/ARCHITECTURE.md`). Côté serveur, lire le blob avec `_shared/appState.ts`.
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
  - Jetons hachés, révocables dans Paramètres › Assistants IA ; chaque appel est journalisé
    (`mcp_log`, avec la raison d'un échec dans `error`). Toutes les connexions de l'agence,
    leur case « agent » et leur valideur : Paramètres › Connexions Claude (fondateurs, fonctions
    SQL `connexions_claude` et `connexion_claude_regler`, jamais d'accès direct aux jetons).
  - Outils dans `tools.ts` (pour tous), `admin.ts` (fondateurs), `autonomie.ts` (prospection
    autonome), `envois.ts` (file d'envoi) et `prospection.ts` (séquences), réunis dans le tableau
    `TOOLS` de `tools.ts`. Un outil qui écrit porte `write: true`, ce qui fait demander l'accord
    de l'utilisateur à Claude avant chaque appel. Tout nouvel outil se classe aussi pour Alfred
    (voir **Alfred** ci-dessous).
  - Connexion marquée « agent autonome » (case de la page d'accord, `mcp_grants.agent`, pour
    Alfred) : ses envois et ses actions irréversibles exigent une validation faite dans la
    page Agents (`ttp-mcp/verrou.ts`, règles `_shared/verrouAgent.ts`), par le valideur de la
    connexion s'il y en a un (`mcp_grants.valideur`). Chaque proposition garde son compte et sa
    connexion (`agent.actions.cree_par`, `grant_id`), affichés dans la page Agents. Un nouvel
    outil qui envoie ou agit sans retour possible s'ajoute à `besoinValidation`. Pas encore
    activé pour Alfred : l'étape sur l'iMac reste à faire par Marc (`agents/alfred/LISEZ-MOI.md`).
  - Pour un membre, un mail n'est jamais envoyé : brouillon seulement. Les fondateurs ont
    en plus des outils qui envoient vraiment (`envoyer_mail`, `envoyer_brouillon`,
    `envoyer_dm` depuis le 2026-10-28, puis `envoyer_brouillons_valides` et `programmer_envoi` ;
    `ttp-mcp/admin.ts` et `envois.ts`). Les outils `founder: true` sont cachés aux membres.
  - **Prospection** : un lot de mails de prospection passe toujours par la file d'envoi
    (`programmer_envoi`, après le « oui » de Gianni pour cette liste de brouillons), jamais par
    `envoyer_brouillons_valides`. La tâche `envoi-file-minute` appelle `ttp-mcp/file-envoi`
    chaque minute : un mail par boîte au plus, en semaine aux heures de bureau, avec un écart et
    un plafond par jour. Juste avant chaque envoi : liste « ne plus contacter »
    (`ne_plus_contacter`), adresse en erreur ou rebond reçu (lu aussi dans `email_activity`, pour
    les adresses sans fiche contact), domaine sans serveur mail, premier mail déjà parti à la même
    société depuis 30 jours, media kit, et pour un brouillon programmé par un agent la validation
    toujours en place (chaque ligne garde sa connexion, `envoi_file.grant_id` : cochée « agent »
    après la programmation, une ligne sans validation ne part pas) ; la file s'arrête si les
    rebonds montent. Règles dans `_shared/fileEnvoi.ts`. Un nouvel outil qui envoie de la
    prospection passe par ces contrôles.
  - **Anti-doublon d'équipe** : `creer_brouillon_mail` refuse un nouveau mail à une personne à
    qui un autre membre de l'équipe a écrit par son propre Claude depuis 15 jours, ou une réponse
    dans un fil où il a répondu depuis 2 jours (lu dans `mcp_log`, `_shared/equipeClaude.ts`) ;
    `forcer` seulement si Marc le demande.
  - **FullEnrich** (`trouver_emails_marque`, `trouver_email_personne`, page Contacts) consomme
    des crédits mensuels limités : annoncer le coût et attendre l'accord de l'utilisateur, jamais
    d'appel en boucle ni de tâche planifiée sans décision de Marc. Hunter est mis de côté depuis
    le 24/11 : ne pas créer de compte.
- **Alfred** (`agents/alfred/`, voir son `LISEZ-MOI.md`) : l'agent autonome de l'agence. Il
  tourne sur l'iMac avec l'abonnement Claude de Marc et agit dans l'app par le connecteur.
  - Il ne reçoit que le dossier `agents/alfred` de `main` : `mise-a-jour.sh` le télécharge
    chaque nuit à 4 h (et au démarrage de l'iMac). Une PR fusionnée qui touche ce dossier
    arrive donc chez lui la nuit suivante, sans passer par l'iMac. Un changement fait ailleurs
    (connecteur, app) ne lui arrive que par les outils et leurs descriptions.
  - Ses droits sont dans `alfred.sh` : chaque outil du connecteur est dans une seule des listes
    `lire`, `agir`, `sur_oui` ou `interdits` (plus `valides_app`, les actions validées dans
    l'app, à garder égale à `OUTILS_A_VALIDER` de `_shared/verrouAgent.ts`). Quand Marc n'a pas
    écrit, seuls `lire` et `agir` sont ouverts, plus une partie de `sur_oui` selon le passage
    (délégation, envoi validé dans la page Agents, revue du 1er du mois) : un outil absent des
    listes lui est refusé. Quand Marc écrit, tous les outils sont ouverts. Le test
    `agents/alfred/tests/outils.test.ts` (contrôle « build ») exige que chaque outil soit
    classé : voir `docs/RECETTES.md`, recette 5.
  - Ses consignes : un tronc, `agents/alfred/CLAUDE.md`, qui doit rester sous 40 000 caractères
    (test `agents/alfred/tests/consignes.test.ts`, contrôle « build »), et des fiches par sujet
    (`agents/alfred/fiches/`). Un nouveau savoir va dans la fiche du sujet, jamais dans le tronc,
    déjà presque plein.
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

- `main` = production, protégée. Chaque chantier se fait sur une branche courte, partie de
  `origin/main` à jour, fusionnée dans `main` par une PR (squash) puis supprimée. Recette pas à
  pas : `docs/RECETTES.md`, section 7.
- Commits en français, une phrase « Zone : ce qui change » (ex. « Mails : filtre « Non lus »
  côté agence et côté créateur »). Ils se terminent par la ligne `Co-Authored-By` de
  l'assistant.
- Commit seulement en fin de tâche, build vert. Chacun pousse avec son propre compte : Marc avec
  le compte `ttpcreators` (alias SSH `github-ttp` du dépôt), Gianni avec le sien. Jamais
  `gh auth login` ni `gh auth switch` pour pousser ; le compte `ttpcreators` n'est jamais prêté
  (voir « Travailler à deux »).
- Tags :
  - `sauvegarde-AAAA-MM-JJ` (suffixe possible) avant un gros changement ;
  - `archive/…` pour garder une piste abandonnée.

  Retour arrière : `git revert` sur une branche, puis PR et contrôle vert comme tout
  changement ; jamais de `push --force` sur `main` (GitHub le refuse). Voir `docs/RECETTES.md`,
  section 8.
- Pull requests et tickets : modèles dans `.github/` (checklist build, SQL et fonctions à
  appliquer, tableau d'état, captures).

## Travailler à deux : Marc et Gianni

Depuis le 24 novembre 2026, Marc et Gianni (son associé) développent l'app tous les deux, chacun avec son propre compte GitHub et ses propres sessions Claude. Les règles :

- **`main` est protégée** : on ne pousse jamais dessus directement. Tout passe par une PR, et le contrôle « build » du workflow « Vérification des PR » (`.github/workflows/verif-pr.yml` : lint, tests, types, build) doit être vert avant la fusion. Le même workflow lance un second contrôle, « fonctions » (`deno check` de toutes les Edge Functions) : GitHub ne l'exige pas encore, mais on l'attend vert lui aussi quand la PR touche `supabase/functions`. Pas de force-push, pas de suppression de `main`. Chacun peut fusionner ses propres PR (`gh pr merge <n> --squash --delete-branch`), sans relecture obligatoire.
- **Une branche par modification**, au nom parlant. Les copies de travail locales vont dans `~/Code/TTP Suite/_ateliers/<nom>`, et on les efface après la fusion.
- **Avant de commencer** : `git fetch` et partir de `origin/main` à jour. Regarder les PR ouvertes (`gh pr list`) pour ne pas toucher aux mêmes fichiers que l'autre. Si c'est le cas, on se prévient.
- **SQL et déploiements Supabase** : la session prépare, la personne décide (voir « Règle prod ») : un « oui » de Marc ou de Gianni pour ce SQL ou ce déploiement précis, et une seule personne à la fois touche la prod (on se prévient). Chaque SQL est daté dans `supabase/sql/` et noté dans `supabase/sql/README.md` (⏳ puis ✅), pour que l'autre sache ce qui est en prod.
- **Les accès** : chacun pousse avec son propre compte GitHub, jamais avec `gh auth login` ni `gh auth switch`. Le compte `ttpcreators` (propriétaire du dépôt) n'est jamais partagé, et les clés restent dans les secrets Supabase.
- **En cas de doute** sur le contexte (ce qui est en ligne, ce qui reste à faire) : `supabase/sql/README.md` d'abord, puis les PR fusionnées récentes (`gh pr list --state merged`), et le journal des agents dans l'app.
- **Session Claude en ligne de Gianni** (décisions de Gianni du 24 novembre 2026, à la suite de l'audit du même jour) :
  - elle ne peut pas lancer `npm run build` (les paquets npm ne se téléchargent pas dans cette session) : pour ses PR, le contrôle « Vérification des PR » fait foi, et elle fusionne elle-même dès qu'il est vert ;
  - elle applique le SQL elle-même, par le connecteur Supabase de Gianni, après le « oui » de Gianni pour ce SQL précis. Le fichier daté est quand même déposé dans `supabase/sql/` et le tableau d'état mis à jour (⏳ puis ✅), comme pour tout SQL ;
  - elle déploie les Edge Functions elle-même par « Déploiement des fonctions » (voir Déploiement), après le « oui » de Gianni pour ce déploiement précis (décision de Gianni du 24 novembre 2026 au soir). Avant de lancer, elle vérifie que la fonction en ligne n'a pas été déployée depuis une branche pas encore fusionnée (date du dernier déploiement, PR ouvertes qui touchent la fonction) : dans le doute, elle s'arrête et le dit. Après, elle met le tableau d'état à jour ;
  - ses modifications venaient de l'audit du 24 novembre 2026 (points M1 à M30). L'audit lui-même n'est pas dans le dépôt : les points déjà faits sont cités dans les PR et dans le tableau d'état.

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
  - Meta, par heure glissante et pour toute l'app (dernier relevé dans `ig_quota`) : chaque
    tâche s'arrête à son plafond, `PLAFONDS` de `_shared/quotaMeta.ts` (lecture des profils
    85 %, import de l'historique des DM 75 %, radar de fond 60 %), et 80 % pour le sourcing
    lancé à la main (`ig-sourcing`) ;
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
