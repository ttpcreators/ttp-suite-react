# Carte du code

Où vit chaque chose dans TTP Suite. Établie à partir de l'arborescence réelle (21 octobre
2026, complétée le 27 novembre 2026) : chaque ligne a été vérifiée dans l'en-tête ou le code
du fichier. Quand un fichier est ajouté, déplacé ou retiré, mettre cette carte à jour dans le
même commit.

Règles de travail : [`../CLAUDE.md`](../CLAUDE.md). Recettes pas à pas :
[`RECETTES.md`](RECETTES.md). État de la base et des fonctions :
[`../supabase/sql/README.md`](../supabase/sql/README.md).

## Sommaire

1. [Points d'entrée](#1-points-dentrée)
2. [Pages (`src/views/`)](#2-pages-srcviews)
3. [Menu agence et onglets créateur](#3-menu-agence-et-onglets-créateur)
4. [Composants (`src/components/`)](#4-composants-srccomponents)
5. [Logique (`src/lib/`) par domaine](#5-logique-srclib-par-domaine)
6. [Edge Functions (`supabase/functions/`)](#6-edge-functions-supabasefunctions)
7. [Base de données (`supabase/`)](#7-base-de-données-supabase)
8. [Fichiers publics (`public/`)](#8-fichiers-publics-public)
9. [Tests](#9-tests)

---

## 1. Points d'entrée

| Fichier | Rôle |
|---|---|
| `index.html` | Page de l'app (PWA : manifest, écrans de lancement iOS, couleur de barre d'état lue dans `ttp:theme`). Charge `src/main.tsx`. |
| `src/main.tsx` | Démarrage : `initAccent()`, `initIosUi()`, remontée des erreurs, liens profonds, surveillance des mises en ligne (`startUpdateWatch`), service worker `/sw.js` (production seulement), rendu de `<App/>` dans l'`ErrorBoundary`. |
| `src/App.tsx` | Session Supabase (sinon `Login`), lecture du profil (`profiles.role`, `creator_name`, `agency_role`). Créateur : `CreatorSpace`. Agence : coque complète (menu, onglets façon navigateur, volet partagé, affichage iPhone, palette ⌘K). Table `VIEWS` = id de page → composant chargé à la demande. Liste `FOUNDER_ONLY` = pages réservées aux fondateurs. |
| `connecteur/index.html` + `src/connecteur/main.tsx` | Deuxième page du build (`/connecteur/`) : page « Autoriser Claude » du connecteur (OAuth, appelle `ttp-mcp`). |
| `agents/alfred/` | Alfred, le talent manager : programme lancé par launchd sur l'iMac, installé dans `~/Code/TTPAlfred` par `installer.sh`. Plusieurs passages par jour selon `alfred.sh` (points, prospection, revues), écoute Telegram continue, mise à jour chaque nuit à 4 h et au démarrage (`mise-a-jour.sh` : seulement le dossier `agents/alfred` de `main`). Lit et écrit dans TTP Suite par le connecteur, avec les droits des listes de `alfred.sh` (test `tests/outils.test.ts`) ; prépare brouillons Gmail et devis, livre sur Telegram (`telegram.mjs`) ; pont avec l'app par la fonction `alfred-pont`. Voir `agents/alfred/LISEZ-MOI.md`. |
| `vite.config.ts` | `base: "./"`, deux entrées (app + connecteur), alias `@` = `src`, découpage `react` / `motion`, écrit `dist/version.json` à chaque build (numéro de mise en ligne), tests sans `.claude/**`. |
| `src/index.css` | Seul endroit des jetons de design (couleurs, statuts `--st-*`, thèmes `data-theme`, rayons, police). |
| `public/sw.js` | Service worker : notifications push, pastille de l'icône, cache (`ttp-shell-v2` réseau d'abord, `ttp-assets-v2` cache d'abord). |
| `.github/workflows/deploy.yml` | À chaque fusion dans `main` : `npm ci`, `npm run build`, publication GitHub Pages (avec `include-hidden-files` pour `.well-known/`). |
| `.github/workflows/verif-pr.yml` | « Vérification des PR », à chaque PR vers `main` : contrôle « build » (`npm ci`, `npm run build` : lint, tests, types, build ; exigé pour fusionner) et contrôle « fonctions » (`deno check` de toutes les Edge Functions ; pas encore exigé). |
| `.github/workflows/deploy-fonctions.yml` | « Déploiement des fonctions » : déploie les Edge Functions nommées, à la demande (onglet Actions, ou une session après le « oui »), seulement depuis `main`, 12 au plus, `--no-verify-jwt` d'après `supabase/config.toml` ; secret GitHub `SUPABASE_ACCESS_TOKEN`. |
| `.github/pull_request_template.md` | Modèle de PR : vérifications, SQL et fonctions à appliquer après le « oui », tableau d'état, captures. |

## 2. Pages (`src/views/`)

Il n'y a pas de routeur : `App.tsx` garde l'id de la page active (`ViewId`, défini dans
`src/lib/nav.tsx`) et rend `VIEWS[id]`. Les pages de premier niveau sont chargées à la
demande via `lazy(lazyImport(...))`. « F » = réservée aux fondateurs (`FOUNDER_ONLY`).

### Pages du menu agence

Pages en onglets « dossier » (classeur, `FolderTabs`, id de page = `orderKey`, liste et
couleurs par défaut dans `FOLDER_PAGES` de `src/lib/folderTabs.ts`) : fiche créateur,
Roster, Scouting, Media kit, Sourcing, Contrats, Planning, Accès, Paramètres. Leurs onglets
suivent les sous-pages de la sidebar dans les deux sens. Couleurs d'intercalaire réglables
pour toute l'équipe dans Paramètres → Apparence → « Couleurs des classeurs » (blob
`folderTabTones`, `src/lib/useFolderTones.ts`).

| Fichier | Id de nav (sous-pages) | Page |
|---|---|---|
| `Aujourdhui.tsx` | `aujourdhui` | Accueil : actions du jour triées par urgence (argent en retard, agenda, tâches, mails, demain), puis « À anticiper ». |
| `Todo.tsx` | `todo` | Tâches de l'équipe : priorités, plusieurs créateurs par tâche, ajout rapide, routines hebdo. |
| `Mails.tsx` | `mails` | Client mail des deux boîtes (partnerships@ et talent@) : lecture, réponse, transfert, collab liée, « Rédiger avec Claude ». |
| `Collabs.tsx` | `collabs` | Collaborations en 11 étapes, de la signature au bilan. |
| `Planning.tsx` | `planning` (`agenda`, `instagram`) | Agenda relié à Google Agenda et posts Instagram programmés (`IgPlanner`). |
| `RosterTabs.tsx` | `roster` | Conteneur du roster : onglets Liste (`Roster.tsx`), Accompagnement (`RosterTracking` de `CreatorTracking.tsx`), Évolution (`EngagementSuivi.tsx`) et Engagement (`Engagement.tsx`), calés sur la sous-page de la sidebar. |
| `Vivier.tsx` | `vivier` (`createurs`, `sportifs`) | Scouting : créateurs et sportifs repérés avant recrutement. |
| `Engagement.tsx` | `engagement` | Calculateur de taux d'engagement par plateforme. |
| `EngagementSuivi.tsx` | `suivi` | Évolution des abonnés et de l'engagement (exporte aussi `SuiviPanel`, réutilisé côté créateur). |
| `Mediakit.tsx` | `mediakit` (`creatrices`, `agence`, `files`) | Media kits : éditeur en ligne par créateur (`MediakitEditor.tsx`), deck agence (`MediakitAgence.tsx`), fichiers. L'id de sous-page `creatrices` est historique et ne change pas. |
| `Pricing.tsx` (+ `PricingTarif.tsx`) | `pricing` | Tarifs : influence selon la méthode TARIF (`pricingTTP.ts`, barème `pricingRates.ttp`), UGC au forfait. |
| `Contacts.tsx` | `contacts` | Carnet de marques et d'agences, journal des échanges (« touches »), historique Gmail. |
| `Sourcing.tsx` | `sourcing` | Trouver des créateurs (Instagram, YouTube), radars à marques, agences concurrentes. |
| `Whatsapp.tsx` | `whatsapp` | « À contacter » : qui relancer aujourd'hui, statut calculé depuis le journal. |
| `Prospection.tsx` | `prospection` | Pipeline des marques démarchées. |
| `Messages.tsx` | `messages` | DM Instagram du compte de l'agence (lus par `ig-inbox`). |
| `Briefs.tsx` | `briefs` | Briefs et scripts, PDF, résumé pour le créateur (« Résumer avec Claude »). |
| `Contrats.tsx` | `contrats` (`marque`, `repr`, `ugc`) | Page d'arrivée des contrats et générateurs Marque × Créateur et UGC ; rend `RepresentationContract.tsx` pour `repr`. |
| `Echeances.tsx` | `echeances` (F) | Fins de contrat, alertes à 30 et 60 jours. |
| `Exclusivites.tsx` | `exclusivites` | Exclusivités : qui est engagé avec quelle marque, jusqu'à quand, contre quels concurrents ; lecture d'un contrat PDF (`pdfText.ts`). Un créateur bloqué n'est jamais suggéré en premier, et une alerte s'affiche au-dessus d'une réponse à une marque concurrente. Une ligne lue toute seule dans un contrat reçu par mail reste « à vérifier » (signalée partout, jamais sûre) jusqu'à ce qu'on la confirme ou l'écarte. |
| `Gifting.tsx` | `gifting` | Produits offerts et contenus attendus. |
| `Debrief.tsx` | `debrief` | Bilans de campagne pour les marques (PDF, mail) ; calculateur dans `DebriefCalculator.tsx`. |
| `Idees.tsx` | `ideas` | Idées de contenus et de collabs. |
| `Facturation.tsx` | `facturation` (F) | Factures : éditeur, statuts, PDF. |
| `Relances.tsx` | `relances` (F) | Factures en retard et mail de relance. |
| `Reversements.tsx` | `reversements` (F) | Ce que l'agence doit reverser à chaque créateur. |
| `Compta.tsx` | `compta` (F) | Compte pro (solde théorique, à mettre de côté, disponible), ce que l'agence prend par collab, réglages URSSAF et TVA. |
| `Stats.tsx` | `stats` | Chiffres de l'agence sur une période. |
| `Objectifs.tsx` | `objectifs` | Objectifs du mois et réussite mois par mois (`charts/ObjectivesTrend.tsx`). |
| `Agent.tsx` | `agent` (F) | Agents IA : consignes, routines, file « À valider », mémoire. |
| `Activite.tsx` | `activite` | Journal de l'équipe (qui a fait quoi). |
| `Documents.tsx` | `documents` | Fichiers de l'agence et des créateurs. |
| `Templates.tsx` | `templates` | Modèles de mails et de messages (rangée par défaut). |
| `Checklist.tsx` | `checklist` | Checklists par collaboration (rangée par défaut). |
| `Acces.tsx` | `acces` (F) (`comptes`, `emails`) | Comptes de l'équipe et des créateurs ; `emails` rend `CredentialVault.tsx`. |
| `Parametres.tsx` | `parametres` | Réglages de l'agence et de l'app (notifications, pages affichées, signatures, connecteur Claude…). |
| `Diagnostique.tsx` | `diagnostique` (F) | Santé de l'app : audits, disponibilité, incidents, bugs remontés. |
| `Corbeille.tsx` | `corbeille` (hors menu) | Éléments supprimés, à restaurer ou effacer (30 jours). Ouverte depuis le menu, l'écran « Plus » ou la recherche. |

### Pages sans id de nav

| Fichier | Rendu par | Page |
|---|---|---|
| `CreatorDetail.tsx` | `App.tsx` (surcouche `openDetail`) | Fiche d'un créateur côté agence. |
| `CreatorSpace.tsx` | `App.tsx` | Espace créateur complet (et aperçu « portail » par l'agence). La plupart des onglets sont écrits dans ce fichier. |
| `CreatorGuide.tsx` | `CreatorSpace.tsx` | Onglet `guide` : mode d'emploi pour le créateur. |
| `CreatorMails.tsx` | `CreatorSpace`, `Mails`, `CreatorDetail` | Boîte mail du créateur (lecture, avis, remarques) et sa vue agence. |
| `CreatorTracking.tsx` | `RosterTabs`, `CreatorDetail`, `CreatorSpace` | Suivi créateur : fiche éditoriale, suivi mensuel, journal, alertes, feuille de route. |
| `Roster.tsx` | `RosterTabs.tsx` | Liste du roster. |
| `MediakitEditor.tsx`, `MediakitAgence.tsx` | `Mediakit.tsx` | Éditeurs de media kit (créateur, agence). |
| `RepresentationContract.tsx` | `Contrats.tsx` | Générateur du contrat de représentation. |
| `CredentialVault.tsx` | `Acces.tsx` | Coffre d'identifiants des boîtes gérées pour les créateurs (blob agence `credVault`). |
| `DebriefCalculator.tsx` | `Debrief.tsx` | Calculateur et captures d'un bilan. |
| `charts/CreatorStatsCard.tsx`, `charts/DashArea.tsx` | `CreatorSpace.tsx` | Graphiques de l'espace créateur (chargés à la demande). |
| `charts/ObjectivesTrend.tsx` | `Objectifs.tsx` | Barres « Réussite mois par mois ». |
| `Ugc.tsx` | rien | Roster UGC. Débranché à la demande de Marc (2026-10-20, voir `RosterTabs.tsx`) mais gardé dans le code : ne pas supprimer. |

## 3. Menu agence et onglets créateur

| Quoi | Où |
|---|---|
| Liste des pages, familles du menu, libellés, icônes, sous-pages | `src/lib/nav.tsx` (`ViewId`, `NAV`). Les `id` ne changent jamais. |
| Page devenue onglet d'une autre (Relances dans Facturation, Objectifs dans Stats…) | `src/lib/pageMerges.ts` (`PAGE_MERGES` : son id ouvre la page hôte sur le bon onglet) et `components/ui/merged-page.tsx` (page hôte à onglets) |
| Page id → composant | `src/App.tsx` (`VIEWS`, imports `lazy(lazyImport(...))`) |
| Pages réservées aux fondateurs | `src/App.tsx` (`FOUNDER_ONLY`) + contexte `src/lib/restrictedViews.ts` |
| Phrase sous le titre de chaque page | `src/lib/viewHints.ts` |
| Synonymes pour la recherche et ⌘K | `src/lib/pageAliases.ts` |
| Pages rangées (masquées pour toute l'agence) | `src/lib/hiddenPages.ts` (blob `hiddenPages`) |
| Couleurs des onglets « dossier » (pour toute l'agence) | `src/lib/folderTabs.ts` (`FOLDER_PAGES`, `resolveTabTones`), `src/lib/useFolderTones.ts` (blob `folderTabTones`) |
| Favoris et leur ordre | `withFavorites`, `orderByIds` dans `nav.tsx` (blob `pinnedPages`, `favoritesOrder`) |
| Sous-page active | `src/lib/navSub.ts` (`useNavSub`, `useSetNavSub`) |
| Pastilles du menu | `src/lib/useNavBadges.ts`, `src/lib/navSeen.ts` |
| Onglets iPhone (barre du bas) | `tabIds` dans `src/App.tsx` (Accueil, favoris, puis To-do, Mails, Collabs…) ; affichage `src/components/mobile/` |
| Pages qui posent leur propre titre | `NO_PAGE_HEADER` dans `src/App.tsx` |
| Pastille rouge « argent » dans le menu | `LATE_BADGE` dans `src/components/Sidebar.tsx` |
| Onglets créateur (liste, alias, favoris) | `src/lib/creatorTabs.ts` (`CsTab`, `CS_ALL_TABS`, `CS_MAIN_TABS`) |
| Menu créateur, aides, rendu des onglets | `src/views/CreatorSpace.tsx` (`CREATOR_GROUPS`, `TAB_HINTS`, blocs `tab === "…"`) |
| Traduction de l'espace créateur | `src/lib/i18n.tsx` + `src/lib/i18n/en-shared.ts`, `en-creatorSpace.ts`, `en-creatorPages.ts` |

## 4. Composants (`src/components/`)

### Premier niveau

| Fichier | Rôle |
|---|---|
| `Sidebar.tsx` | Menu agence (familles, favoris, pastilles). |
| `CommandPalette.tsx` | Palette ⌘K (logique dans `src/lib/commandPalette.ts`). |
| `GlobalSearch.tsx` | Recherche globale (barre, menu, plein écran). |
| `Login.tsx` | Écran de connexion. |
| `ErrorBoundary.tsx` | Barrière d'erreur ; `isChunkError` et `recoverStaleApp` (récupération après une mise en ligne). |
| `BugsPanel.tsx` | Bugs remontés (dans Diagnostic). |
| `AgentEditor.tsx`, `agent-avatar.tsx` | Fiche d'un agent IA, figurine d'un agent. |
| `MonthlyReport.tsx` | Rapport mensuel d'un créateur (écran et PDF). |
| `WeeklyRoutines.tsx` | Routines « Chaque semaine » de la To-do. |
| `brief-resume.tsx` | « L'essentiel du brief » et bouton « Résumer avec Claude ». |
| `invoice-editor.tsx` | Briques de l'éditeur de facture. |
| `signature-pad.tsx` | Signature dessinée. |
| `meet-invite.tsx` | Rendez-vous Google Meet depuis un mail. |
| `mail-*.tsx` | Briques mail : `mail-shell` (mise en page), `mail-reader` (lecture), `mail-tools` (réponse, transfert, réglages), `mail-composer` (prospection, modèles), `mail-attach` (pièces jointes), `mail-avatar`, `mail-box-chip` (boîte), `mail-collab` (collab liée), `mail-claude` (« Rédiger avec Claude »). |
| `InstagramCard.tsx`, `TikTokCard.tsx`, `YouTubeCard.tsx`, `BrandInstagram.tsx` | Chiffres réseaux d'un créateur ou d'une marque. |
| `ig-feed-stats.tsx` | « Mes stats » : feed Instagram (12 derniers posts), ce qui marche, chiffres 28 j, audience. Onglet créateur `evolution` et fiche créateur agence. |
| `HashtagSearch.tsx`, `RivalWatch.tsx`, `TikTokRadar.tsx`, `YouTubeRadar.tsx`, `RadarFrame.tsx`, `SourcingGuide.tsx`, `OutreachComposer.tsx`, `MetaQuotaBadge.tsx` | Outils du Sourcing et du Scouting. |
| `src/views/BaseCreateurs.tsx` (menu « Base créateurs », id `base`) | La base façon Kolsquare : tous les profils lus (`ig_profiles`) filtrables (niche, ville, taille, engagement, activité, partenariats, sans agence), niche et ville devinées dans la bio ou corrigées (`creator_base_meta`), courbe d'abonnés (`ig_profile_history`), retrait RGPD, et listes pour les marques (`creator_lists`) avec lien public `ttpcreators.pro/selection/?l=` (vue `public_creator_lists`). |
| `src/views/Araignee.tsx` (menu « Araignée », id `araignee`) | La salle des araignées : lance les 4 scrapings l'un après l'autre (radars Instagram, TikTok, YouTube, veille des agences), montre l'araignée au travail, ce que chaque robot a vraiment ramené, les marques repérées pendant le passage et le journal `ig_sync_state`. |
| `InstaPromenade.tsx` | Promenade Instagram de la page Araignée : départ « comme un créateur » (`ig-sourcing` mode `similar`), « qui bosse avec une marque » (`brand`) ou une liste de @ (`list`), option « Continuer la toile » (`similar` sur les 3 meilleurs gardés). Tri selon les critères de l'agence (abonnés, engagement, activité, déjà au roster ou en scouting, déjà en agence, marque), ajout au Scouting (`creator_pool`). |
| `SpiderScan.tsx` (+ `src/lib/spiderEngine.ts`) | L'araignée qui s'affiche pendant une recherche (radars Instagram, TikTok et YouTube via `RadarFrame`, hashtag, analyse d'un créateur). Visuel seulement, aucun chiffre inventé : le moteur des pattes est partagé avec les vidéos TTP. |
| `IgPlanner.tsx` | Planning → Posts Instagram. |
| `CreatorToday.tsx` | Page « Aujourd'hui » de l'espace créateur : actions rangées par moment, panneau détail (logique `src/lib/creatorToday.ts`). |
| `CreatorTodos.tsx`, `todo-parts.tsx` | « À faire » de l'espace créateur, sur le modèle de la To-do agence (logique `src/lib/creatorTodos.ts`) ; briques communes des deux pages « À faire » (rond à cocher, ligne d'info). |
| `creator-missions.tsx` | Missions de l'espace créateur : une carte par collab ou brief, frise en 5 étapes et un bouton selon l'étape (`creatorMissions.ts`). |
| `creator-networks.tsx`, `creator-skeleton.tsx`, `creator-undo.tsx` | Espace créateur : chiffres clés d'un réseau (relevés `ig-sync`, `tt-sync`, `yt-sync`) ; squelettes gris du premier chargement ; action immédiate avec un bandeau « Annuler » de 5 secondes au lieu d'une confirmation. |
| `ig-connexion-banner.tsx` | Espace créateur : bandeau Instagram (échec de connexion lu dans l'adresse ou dans `ig_connexions`, jeton qui expire) avec reconnexion en un clic (règles `_shared/igConnexion.ts`). |
| `a-valider-file.tsx` | File « À valider » de la page Agents : une carte par proposition, Valider, Modifier, Écarter, raccourcis clavier (ce que « Valider » déclenche : `src/lib/aValider.ts`). |
| `alfred-app.tsx` | Alfred dans l'app : état, « Demander à Alfred », réglages et historique (pont `alfred-pont`, tables `agent.agents`, `agent.demandes`, `agent.evenements`). |
| `monday-board.tsx` | Tableau de bord du lundi en haut de la page Objectifs : Gianni (acquisition) et Marc (closing), semaine et mois (calcul `_shared/tableauLundi.ts`, le même que l'outil `tableau_lundi`). |
| `brand-tile.tsx`, `cachet-field.tsx` | Tuile « marque + photo du créateur » des listes de Collabs (Gifting, Négociations) ; champ « Cachet » d'une collab (montant, devise, affiliation ; format `_shared/cachet.ts`). |
| `collab-creator.tsx`, `collab-links.tsx`, `collab-take.tsx` | Fiche collab : ce que le créateur a fait dans son espace (brief lu, concept à valider, posts et stats à 7 jours) ; « la collab au centre » (champ Collab, lien d'un objet vers sa collab, tout ce qui la concerne, `collabLinks.ts`) ; « Ce que je prends » pour les fondateurs (qui encaisse, commission, URSSAF, net, `compta.ts`). |
| `exclu-alert.tsx` | Au-dessus d'une réponse à une marque : les créateurs bloqués par une exclusivité avec un concurrent, puis ceux à vérifier (exclusivité pas confirmée, ou sans concurrents). |
| `creator-lookup.tsx`, `ig-dm-start.tsx` | Scouting : les collabs d'un créateur post par post et le résumé par marque (`ig-sourcing` mode `collabs`) ; « Écrire à @marque » (ouvre la conversation existante, sinon copie le message pour Instagram). |
| `find-contacts.tsx` | « Trouver des contacts » de la page Contacts : recherche par postes chez une marque, e-mail pro sur demande (FullEnrich, `src/lib/fullenrich.ts`). |
| `kit-rates-dialog.tsx`, `mediakit-roster.tsx`, `publish-site-button.tsx` | Media kit : grille de tarifs remplie depuis la page Tarifs (`mediakitRates.ts`) ; liste du roster avec l'état de chaque kit et la date des derniers chiffres réels ; bouton « Publier maintenant » (fonction `mediakit-publish`). |
| `mail-address-input.tsx`, `mail-models.tsx`, `mail-reactions.tsx`, `mail-sender.tsx` | Mails : champ À / Cc / Cci qui propose les adresses des créateurs et des contacts (`mailRecipients.ts`) ; modèles dans la réponse et le nouveau mail ; réactions emoji sous un message (`mailReactions.ts`) ; menu « De : » (boîte ou alias « Envoyer en tant que », `useSendAs.ts`). |

### Sous-dossiers

| Dossier | Contenu |
|---|---|
| `icons/` | `index.ts` : seule source d'icônes de l'app (réexporte `lucide-react` et remplace les icônes courantes par les icônes TTP) ; `ttp-icons.tsx` : icônes `Ttp*` dessinées pour l'app. |
| `contracts/` | `contracts-home.tsx` (page d'arrivée Contrats), `contract-ui.tsx` (réglages, document), `contract-relance.tsx` (relancer une signature). |
| `mobile/` | Affichage iPhone : `ios-shell` (barre d'onglets, barre de titre, groupes), `ios-sheet` (feuilles), `more-screen` (écran « Plus »), `swipe-row`, `pull-to-refresh`, `offline-banner`. |
| `ui/` | Briques d'interface (voir ci-dessous). |

### `src/components/ui/` par famille

| Famille | Fichiers |
|---|---|
| Mise en page et navigation | `page-header` (`PageFrame`, `PageHeaderRow`), `dashboard-sidebar` (primitives de menu, agence et créateur), `dash`, `welcome-modal`, `scaled-preview`, `phone-bar` (affichage téléphone de l'agence : actions en « ⋯ », pastilles, filtres compacts) |
| Onglets et filtres | `animated-tabs` (`Tabs`), `motion-tabs`, `morphing-tabs`, `folder-tabs` (onglets « dossier » de la page Agents, avec code couleur, pour fiche créateur, Roster, Scouting, Media kit, Sourcing, Contrats, Planning, Accès, Paramètres ; onglets simples avec pastille sur téléphone), `filter-bar`, `filter-panel`, `period-filter`, `date-range-picker`, `pill-search` |
| Formulaires | `form` (`AddButton`, `InlineForm`, champs), `select`, `checkbox`, `popover`, `status-select`, `creator-multi-picker`, `recipient-picker`, `image-field`, `avatar-upload`, `signature-picker`, `mediakit-theme-picker`, `subtask-checklist`, `creator-picker` (choix d'un créateur avec photos, créateurs bloqués par une exclusivité), `creator-mention` (créateur proposé sous « @ ») |
| Retours et statuts | `toast`, `alert`, `notifications`, `notification-panel`, `undo-send`, `loader`, `status-pill`, `be-ui-animated-badge`, `help-tip`, `tooltips`, `kbd`, `progress`, `deal-badge` (Gifting ou Rémunéré), `new-dot` (repère « nouveau ») |
| Données et graphiques | `chart` (recharts), `glass-stat-chart`, `stat-card`, `stats-bento`, `event-calendar`, `agent-plan`, `file-card-collections`, `cobe-globe-stickers`, `progress-ring` (anneau de la journée, pages « Aujourd'hui ») |
| Avatars et icônes | `agency-avatar`, `creator-avatar`, `platform-icon`, `icon-tile` |
| Divers | `action-menu` (`ActionMenu`, `ConfirmDialog`), `expandable-action-bar`, `google-connect` (carte Google Agenda), `push-card` (notifications côté créateur) |

## 5. Logique (`src/lib/`) par domaine

Règle : la logique pure (sans React ni Supabase) vit dans `src/lib/<nom>.ts`, avec son test
`src/lib/<nom>.test.ts` à côté. Les accès base sont dans des fichiers séparés (`*Db.ts`,
`use*.ts`).

| Domaine | Fichiers |
|---|---|
| Socle données | `supabase.ts` (client, clé anon), `db.ts` (insert / update / delete), `appState.ts` (blob agence `__app_state__`), `useLive.ts` (resynchronisation), `viewCache.ts`, `trash.ts` (corbeille), `useCreators.ts`, `money.ts`, `utils.ts`, `dates.ts`, `dateRange.ts`, `timeSeries.ts`, `safeUrl.ts` (protections des adresses et fichiers venus de l'extérieur), `nameMatch.ts` (retrouver les lignes d'un créateur dont le nom est écrit à la main, sans majuscules ni accents) |
| Navigation et interface | `nav.tsx`, `navSub.ts`, `navAction.ts`, `navSeen.ts`, `useNavBadges.ts`, `hiddenPages.ts`, `restrictedViews.ts`, `pageAliases.ts`, `viewHints.ts`, `tabs.ts`, `openIntent.ts`, `deepLink.ts`, `commandPalette.ts`, `search.ts`, `searchKinds.ts`, `useGlobalSearch.ts`, `settingsSearch.ts`, `folderTabs.ts`, `useFolderTones.ts`, `useVisitedTabs.ts`, `useStickyState.ts`, `pageMerges.ts`, `useEdgeFade.ts` (fondu au bord d'une rangée qui défile), `iosUi.ts`, `touch.ts`, `ease.ts`, `hooks/` (gestes), `collabTabs.ts` (Collabs à trois onglets ; les anciennes pages Gifting et Pipeline s'y ouvrent au bon onglet), `notifTabs.ts` (onglets du panneau de notifications), `haptics.ts` (petit « tic » du téléphone sur les actions qui comptent), `useEdgeSwipeBack.ts` (retour par glissement depuis le bord gauche), gestes de `hooks/` : `use-dismiss.ts`, `use-hover-gesture.ts`, `use-tap-gesture.ts` |
| Apparence | `accent.ts` (accent et thèmes Studio par défaut, Clair, Verre, Noir, Auto), `theme.ts` (contexte React), `statusTone.ts` (un sens par couleur) |
| Mise à jour et santé | `appUpdate.ts` (`version.json`, `lazyImport`), `errorReport.ts`, `diagnostics.ts`, `features.ts` (fonctions en attente d'accord Meta, TikTok, Google) |
| Aujourd'hui et anticipation | `aujourdhui.ts`, `anticipation.ts`, `relance.ts`, `useRelanceInvoices.ts`, `controle.ts` + `controleDb.ts` (section « À corriger » : contrôle qualité des données, composant `components/controle-section.tsx`), `todayExplain.ts` (explication de chaque ligne dans le panneau de droite), `planningEcheances.ts` (fins de contrat et d'exclusivité, anniversaires posés sur le Planning en lecture seule) |
| To-do | `todoCreators.ts` + `todoCreatorsDb.ts` (plusieurs créateurs), `todoQuickAdd.ts`, `todoProgress.ts`, `todoStatus.ts`, `routines.ts`, `todoVisibility.ts` (ce que le créateur voit des tâches et du planning de l'agence : `visiblePourCreateur`, tâches et rendez-vous internes), `activityEvents.ts` + `useActivityEvents.ts` (repères « nouveau » entre l'agence et les créateurs, table `activity_events`) |
| Mails | `mailSend.ts` (envoi, « Annuler l'envoi », brouillons), `mailSignature.ts`, `useMailSignatures.ts`, `useMailSettings.ts`, `mailTemplates.ts`, `mailThreadContext.ts` (contexte donné à Claude), `mailCollab.ts`, `mailAvatar.ts`, `useMailUnread.ts`, `useAttachments.ts`, `mailAddresses.ts`, `mailReply.ts` (à qui part une réponse dans un fil), `mailOptimistic.ts` (lu, archivé, supprimé affichés tout de suite, puis confirmés par Gmail), `mailDrafts.ts` (dossier « Brouillons »), `mailIgnored.ts` (expéditeurs « Pas à traiter », règle `_shared/mailIgnore.ts`), `mailModels.ts` (modèles fournis et ceux de l'agence), `mailReactions.ts` et `mailThreadReactions.ts` (réactions emoji), `mailReadSync.ts` (lu dans l'app = lu dans Gmail), `mailRecipients.ts` (adresses proposées après « @ »), `mailDayGroup.ts` (groupes Aujourd'hui, Hier, Cette semaine), `sentBy.ts` + `sentByDb.ts` (« Envoyé par »), `useSendAs.ts` (menu « De : »), `googlePhotos.ts` (photos Google des expéditeurs, fonction `mail-photos`), `creatorBoxMail.ts` (boîtes des créateurs dans la page Mails, fonction `creator-box-mail`) |
| Espace créateur | `creatorTabs.ts`, `creatorMissions.ts`, `creatorNextStep.ts`, `creatorGains.ts`, `creatorMail.ts`, `creatorMailCounts.ts`, `creatorTracking.ts`, `monthlyReport.ts`, `creatorOwed.ts` (« Ce qu'on te doit », collab par collab), `creatorToday.ts` (page « Aujourd'hui » du créateur), `creatorTodos.ts` (« À faire » du créateur), `briefPdf.ts` (PDF complet d'un brief, par le lien exact du document) |
| Traduction | `i18n.tsx`, `i18n/en.ts`, `i18n/en-shared.ts`, `i18n/en-creatorSpace.ts`, `i18n/en-creatorPages.ts` |
| Facturation et argent | `invoice.ts` (calcul unique HT, TVA, commission, reversement, au centime ; `invoiceTotals` pour une facture enregistrée), `reversements.ts` (dû, versé, reste par créateur, même calcul que les gains du créateur), `commission.ts` (`rateFor` : taux de la fiche sans tenir compte des majuscules), `compta.ts` + `comptaRates.ts` (micro-entreprise : CA, URSSAF, TVA, compte pro, mode d'encaissement par collab ; sources dans `docs/compta-micro.md`), `useFounder.ts` (montants visibles des fondateurs seulement), `pricing.ts` (ancien moteur : UGC, calcul du media kit), `pricingTTP.ts` + `_shared/tarif.ts` (méthode TARIF, aussi lue par l'outil Claude `methode_tarif`), `facturationResume.ts` (chiffres « à encaisser » du haut de Facturation), `quotes.ts` (devis, blob `quotes`), `invoicePrefill.ts` (« Créer le devis » ou « Créer la facture » ouvre Facturation déjà remplie), `pricingForm.ts` et `pricingTTPDb.ts` (page Tarifs : textes, lignes et barème de la méthode TARIF), `creatorAudience.ts` (audience d'un créateur par plateforme, pour Tarifs et la grille du media kit) |
| Contrats | `contractRegistry.ts` + `contractRegistryDb.ts`, `contractDuration.ts`, `brandContract.ts` (moteur Marque × Créateur et UGC), `representationContract.ts`, `contractRender.ts` (contrat rendu pour Alfred, copié dans `agents/alfred/contrats.mjs` par `npm run alfred:contrats`), `agencySignature.ts`, `useExclusivites.ts` (exclusivités lues par la page Exclusivités, le choix d'un créateur et les Mails), `exclusiviteDoc.ts` (nom du contrat dans Documents), `pdfText.ts` (texte d'un PDF lu dans le navigateur, « Lire un contrat »), `creatorExclu.ts` (créateur en exclusivité avec l'agence : colonne `creators.exclu` et blob `creatorExclusive`), `alfredDocs.ts` + `rapportCollab.ts` (documents fabriqués par Alfred avec les moteurs de l'app : contrats et rapport de fin de collab, embarqués dans `agents/alfred/contrats.mjs`) |
| PDF | `pdfDoc.ts` (identité commune des documents), `printPdf.ts` (`printHtml`) |
| Briefs, collabs, bilans | `briefResume.ts`, `collabs.ts` (11 étapes), `collabAuto.ts` + `collabAutoDb.ts` (étapes qui avancent toutes seules : facture payée → étape 9, versement qui solde la facture → étape 10, collab créée ou gagnée → prospect « Signé » ; règles et écritures dans `_shared/collabAuto.ts` et `_shared/collabAutoDb.ts`), `campaignRecap.ts`, `engagement.ts`, `objectivesTrend.ts`, `platform.ts`, `briefStatus.ts` (statut et ordre de la liste des briefs), `briefConcept.ts` + `briefConceptDb.ts` (« J'ai lu » et concept proposé par le créateur), `collabPosts.ts` + `collabPostsDb.ts` (lien du post et stats à 7 jours déclarés par le créateur, table `collab_posts`), `collabLinks.ts` + `collabLinksDb.ts` (la collab au centre : objets reliés par `collab_id`, suggestions, tâche de chaque étape), `checklistCollab.ts` (checklist reliée à sa collab, cochée par l'étape), `dealKind.ts` (Gifting ou rémunéré) |
| Contacts et prospection | `touches.ts` + `touchesDb.ts`, `contactRelance.ts`, `brandRecord.ts` + `brandRecordDb.ts` (fiche marque : collabs, chiffre d'affaires pour les fondateurs, gifts, historique mail), `contactCard.ts` (« Copier la fiche »), `prospectProposal.ts` + `prospectsDb.ts` (Tarifs → prospect → collab), `fullenrich.ts` (FullEnrich côté app, par la fonction `fullenrich` : la clé reste sur le serveur) |
| Scouting et sourcing | `scouting.ts`, `niche.ts`, `sourcingScore.ts`, `igRivals.ts`, `ttRadar.ts`, `scoutToRoster.ts` (un profil du Scouting qui signe passe au roster, sans doublon), `spiderEngine.ts` (moteur des pattes de l'araignée, partagé avec les vidéos TTP) |
| Réseaux sociaux | `instagram.ts`, `igFeed.ts`, `igPlanner.ts`, `tiktok.ts`, `youtube.ts`, `rosterAudience.ts` (chiffres du jour TikTok et YouTube, colonnes `creators.tt` et `creators.yt`) |
| Media kits | `mediakitSlug.ts` (même calcul que le site), `mediakitThemes.ts` (mêmes ids que le site), `mediakitBiosEn.ts`, `mediakitRates.ts` + `mediakitRatesDb.ts` (prix de la page Tarifs → grille « Tarifs indicatifs » du kit), `mediakitRoster.ts` (état du kit de chaque créateur), `mediakitControleDb.ts` (bouton « Mettre à jour » : chiffres réels mis dans le kit) |
| Équipe, agents, notifications | `team.ts`, `useMyName.ts`, `agentAvatars.ts`, `push.ts`, `appBadge.ts`, `useNotifications.ts`, `notifLocal.ts`, `notifTexts.ts`, `aValider.ts` + `aValiderDb.ts` (file « À valider » de la page Agents : ce que « Valider » déclenche), `alfredApp.ts` (Alfred dans l'app, miroir de `_shared/alfredPont.ts`), `widgetScript.ts` (lanceur du widget iPhone pour Scriptable, fonction `widget`) |
| Agenda et divers | `googleCalendar.ts` (connexion Google, bouton « Synchroniser », relance de la synchro après un enregistrement de rendez-vous), `synchroPlanifiee.ts` (relance groupée 2 s après la dernière écriture, nouvel essai si un passage tourne déjà), `gifting.ts`, `openLater.ts` (ouvrir un onglet après un `await` sur iPhone), `eventKind.ts` (type d'un évènement deviné d'après son titre, copie dans `_shared/eventKind.ts`), `ficheComplete.ts` (fiche créateur « complète à X % ») |

## 6. Edge Functions (`supabase/functions/`)

Jamais déployées par une fusion : « Déploiement des fonctions » (`.github/workflows/deploy-fonctions.yml`,
depuis `main`) ou Marc à la main (`supabase functions deploy <nom> --project-ref zizvggziggswhrbuyhuo`),
après le « oui » de Marc ou de Gianni pour ce déploiement (voir `../CLAUDE.md`, « Règle prod »).
Colonne « JWT » = réglage `verify_jwt` de `supabase/config.toml` ; « Contrôle » = ce que le
code vérifie en plus. Les crons sont des tâches `pg_cron` (heures UTC) qui appellent la
fonction avec `Authorization: Bearer <CRON_SECRET>`.

### Mails (Gmail)

| Fonction | Rôle | Appelée par | JWT | Contrôle | Cron |
|---|---|---|---|---|---|
| `gmail-history` | Fils avec un contact, boîte de réception par pages, coup d'œil sur les non lus | `Mails.tsx`, `Contacts.tsx`, `useMailUnread.ts` | oui | rôle agence | |
| `gmail-thread` | Fil complet, pièce jointe, lu / non lu / archivé | `Mails.tsx` | oui | rôle agence | |
| `gmail-send` | Envoi depuis la vraie boîte (partnerships@ ou talent@) | `mailSend.ts`, `Contacts.tsx`, `Debrief.tsx` | oui | rôle agence | |
| `gmail-trash` | Fil à la corbeille Gmail ou retour (jamais de suppression définitive) | `Mails.tsx` | oui | rôle agence | |
| `gmail-poll` | Nouveaux mails reçus → `email_activity` + push + tâches tirées des demandes (`tasks.ts`) | pg_cron | non | CRON_SECRET ou agence | `*/5 * * * *` |
| `gmail-reconcile` | Mails envoyés → `contacts.last_contacted` et touches | pg_cron | non | CRON_SECRET ou agence | `12 * * * *` |
| `creator-mail` | Boîte mail de l'espace créateur, filtrée côté serveur (logique pure dans `logic.ts`) | `creatorMail.ts` | oui | créateur = ses fils ; agence peut viser un créateur | |
| `mail-photos` | Photos de profil Google des expéditeurs (API People, deux boîtes ; logique `_shared/peoplePhotos.ts`) | `src/lib/googlePhotos.ts` | oui (absente de `config.toml`, défaut) | rôle agence | |
| `meet-invite` | Rendez-vous Google Agenda avec lien Meet et invitations | `components/meet-invite.tsx` | oui (absente de `config.toml`, défaut) | rôle agence | |
| `send-email` | Envoi via Resend | `Contacts.tsx`, `Mediakit.tsx`, `Vivier.tsx`, `Debrief.tsx` | oui | rôle agence | |

### Google Agenda

| Fonction | Rôle | Appelée par | JWT | Contrôle | Cron |
|---|---|---|---|---|---|
| `google-connect-url` | URL d'autorisation Google (state signé) | `googleCalendar.ts` | oui | rôle agence, origine autorisée | |
| `google-oauth-callback` | Retour de Google, jetons, premier cycle | navigateur (Google) | non | state signé | |
| `creator-box-callback` | Boîte Gmail d'un créateur reliée à TTP Suite : lien signé de 7 jours, puis retour de Google, jeton dans `creator_mail_boxes` (logique `_shared/creatorBox.ts`) | navigateur (créateur, Google) | non | state signé | |
| `creator-box-mail` | Page Mails › Boîtes créateurs : lire, rechercher et répondre dans la boîte reliée d'un créateur (sa signature Gmail) ; fondateurs seulement (écran `src/components/creator-box-mails.tsx`, logique `src/lib/creatorBoxMail.ts`) | app (fondateurs) | oui | JWT + fondateur | |
| `google-status` | Statut de connexion (sans jeton) | `googleCalendar.ts` | oui | rôle agence | |
| `google-disconnect` | Déconnexion propre | `googleCalendar.ts` | oui | fondateur (depuis le 27/11) | |
| `google-sync` | Synchro dans les deux sens `events` ↔ Agenda | pg_cron, `googleCalendar.ts`, appels internes | non | CRON_SECRET ou agence | `17 * * * *` |
| `google-watch-renew` | Renouvelle l'abonnement aux changements | pg_cron | non | CRON_SECRET | `0 1 * * *` |
| `google-webhook` | Reçoit les changements de Google | Google | non | jeton du canal | |

### Instagram, TikTok, YouTube

| Fonction | Rôle | Appelée par | JWT | Contrôle | Cron |
|---|---|---|---|---|---|
| `ig-avatar` | Profils Instagram du Scouting | `Vivier.tsx` | oui | rôle agence | |
| `ig-hashtag` | Posts par hashtag | `HashtagSearch.tsx` | oui | rôle agence | |
| `ig-sync` | Chiffres Instagram du roster (+ feed des 12 derniers posts, images copiées dans `avatars/feed/`), des collabs, des marques ; conformité des posts (tâches internes + journal `conformiteIncidents`) | pg_cron, `instagram.ts`, `ig-callback` | non | CRON_SECRET ou agence | `20 5 * * *` et `30 14 * * *` |
| `ig-connect` / `ig-callback` | Un créateur connecte son Instagram : connexion unifiée de Meta (Facebook Login for Business) quand `IG_CONFIG_ID` et `META_APP_SECRET` sont posés, sinon l'ancienne connexion Instagram (`_shared/instagram-login.ts`) ; lien de connexion de 7 jours (`ig-connect` action `lien`) ; chaque tentative notée dans `ig_connexions` par `ig-callback` (règles `_shared/igConnexion.ts`) | `instagram.ts` (espace créateur, fiche créateur) / navigateur | oui / non | créateur ou agence, lien : fondateurs / state signé ou lien signé | |
| `ig-deauth` | Meta prévient qu'un créateur a retiré l'app : jeton supprimé, `creators.ig.link` à null, ligne « annulation » dans `ig_connexions` | Meta (« URL de rappel pour les annulations d'autorisation ») | non | signature du `signed_request` (`IG_APP_SECRET`) | |
| `ig-data-deletion` | Demande de suppression des données Instagram d'un créateur : jeton, lien, statistiques privées (fiche, feed, posts de collabs, mesures auto) ; répond `{ url, confirmation_code }` (page `app.ttpcreators.pro/instagram-donnees/`) ; ligne « suppression » dans `ig_connexions` | Meta (« URL de la demande de suppression des données ») | non | signature du `signed_request` (`IG_APP_SECRET`) | |
| `ig-sourcing` | Sourcing, radar à marques, concurrents | pg_cron, `Sourcing.tsx`, `RivalWatch.tsx` | non | CRON_SECRET ou agence | `40 */2 * * *` |
| `ig-inbox` | DM du compte de l'agence ; action `backfill` : import de tout l'historique, par tranches (`_shared/igHistoriqueDb.ts`) | pg_cron, `Messages.tsx`, `ig-webhook` | non | CRON_SECRET ou agence | `25 */5 * * *` ; `*/3 * * * *` pour l'import (`ig-historique-import`, sans effet depuis la fin de l'import le 25/11) |
| `ig-send` | Envoie un DM depuis la page DM Instagram (dans les 24 h du dernier message de la personne ; logique `_shared/igSend.ts`) | `Messages.tsx` | oui (absente de `config.toml`, défaut) | rôle agence | |
| `ig-webhook` | Réception des DM en direct (Meta) | Meta | non | signature `X-Hub-Signature-256` | |
| `ig-publish` | Publie les posts programmés | pg_cron, `IgPlanner.tsx` | non | CRON_SECRET ou agence | `* * * * *` |
| `tt-connect` / `tt-callback` | Un créateur connecte son TikTok | `tiktok.ts` / navigateur | oui / non | créateur ou agence / state signé | |
| `tt-sync` | Chiffres TikTok des créateurs connectés | pg_cron, `tiktok.ts`, `tt-callback` | non | CRON_SECRET ou agence | `0 6 * * *` et `45 14 * * *` |
| `tt-radar` | Radar à collabs TikTok | pg_cron, `TikTokRadar.tsx` | non | CRON_SECRET ou agence | `0 7 * * *` |
| `yt-connect` / `yt-callback` | Un créateur connecte sa chaîne (retour via `public/yt-callback/`) | `youtube.ts` / navigateur | oui / non | créateur ou agence / state signé | |
| `yt-sync` | Chiffres YouTube des créateurs connectés | pg_cron, `youtube.ts`, `yt-callback` | non | CRON_SECRET ou agence | `15 6 * * *` et `50 14 * * *` |
| `yt-radar` | Radar à collabs YouTube | pg_cron, `YouTubeRadar.tsx` | non | CRON_SECRET ou agence | `30 7 * * *` |
| `yt-sourcing` | Sourcing YouTube | `Sourcing.tsx` | oui | rôle agence | |

### Espace créateur, équipe, système

| Fonction | Rôle | Appelée par | JWT | Contrôle | Cron |
|---|---|---|---|---|---|
| `creator-history` | Mesures d'engagement d'un créateur (pont vers le blob agence) | `CreatorSpace.tsx` | oui | créateur = les siennes | |
| `debrief-history` | Bilans d'un créateur (pont vers le blob agence) | `CreatorSpace.tsx` | oui | créateur = les siens | |
| `creator-report` | Données du rapport mensuel | `MonthlyReport.tsx` | oui | créateur = lui ; agence = le créateur demandé | |
| `create-access` | Crée un compte ou remet un mot de passe | `Acces.tsx` | oui | fondateur | |
| `team-notify` | Push « qui fait quoi » aux autres comptes agence | `team.ts` | oui | rôle agence | |
| `daily-digest` | Résumés push (matin, semaine, après-midi, rappel des stats) et notifications d'activité | pg_cron, `push.ts`, `diagnostics.ts` | non | CRON_SECRET ou JWT | `0 6,7 * * *`, `0 6,7 * * 1`, `0 12,13 * * *`, `0 7,8 * * *` |
| `report-error` | Journal des crashs + push agence (anti-spam) | `errorReport.ts` | non | aucun (crash possible hors connexion) | |
| `monthly-backup` | Sauvegarde mensuelle envoyée par mail aux fondateurs : CSV, réglages (sans le coffre), PDF des media kits, archive dans le bucket privé `backups` (logique `_shared/backup.ts`, `backupStatus.ts`, `drive.ts`) | pg_cron, `Parametres.tsx` | non | CRON_SECRET ou fondateur | `0 6 1 * *` |
| `mediakit-publish` | « Publier maintenant » des media kits : relance le déploiement du site (`GITHUB_SITE_TOKEN`) | `publish-site-button.tsx` | non | rôle agence | |
| `fullenrich` | FullEnrich pour la page Contacts : personnes d'une marque, e-mail pro (et téléphone sur demande) ; la clé reste sur le serveur (appels `_shared/fullenrichApi.ts`) | `src/lib/fullenrich.ts` | oui (absente de `config.toml`, défaut) | rôle agence | |
| `rdv` | Page publique « Réserver une visio » (`app.ttpcreators.pro/rdv/`) : créneaux libres de Marc, rendez-vous Meet, contact et tâche, push, Telegram et mail (logique `_shared/rdv.ts`) | `public/rdv/rdv.js` | non | public : piège à robots, plafonds (`rdv_journal`) | |
| `site-lead` | Formulaire « Recevoir le roster » du site : contact « Lead site », tâche de tri pour Gianni, push générique (logique `_shared/siteLead.ts`) | site ttpcreators.pro | non | public : CORS du site, piège à robots, 30 demandes par heure | |
| `widget` | Données du widget iPhone, en lecture seule : tâches, planning de 7 jours, mails non lus ; `?script=1` sert le dessin (logique `_shared/widget.ts`, `widgetRenderer.ts`) | Scriptable (`src/lib/widgetScript.ts`) | non | clé du widget (empreinte en base) | |
| `alfred-pont` | Pont entre l'iMac d'Alfred et l'app : pouls, nouvelles de l'app, demandes « Demander à Alfred », réglages, skills privées, pièces jointes et photos (logique `_shared/alfredPont.ts`) | iMac (`agents/alfred/telegram.mjs`) | non | secret `ALFRED_PONT_SECRET` | |
| `agent-watchdog` | Alerte « Alfred ne répond plus » : pas de point du matin dans `agent.journal`, ou iMac muet depuis 15 minutes entre 7 h et 23 h → push aux fondateurs (logique `_shared/watchdog.ts`) | pg_cron | non | CRON_SECRET | `*/5 * * * *` |
| `dispos-du-mois` | Liste « Dispos de <mois> » pour les agences (Base créateurs › Listes, lien public), logique `_shared/disposDuMois.ts` et `disposDuMoisDb.ts` | pg_cron | non | CRON_SECRET | `45 6 1 * *` |
| `ttp-mcp` | Connecteur Claude : serveur MCP (`index.ts`), OAuth (`oauth.ts`), outils (`tools.ts`, accès fondateurs `admin.ts`, prospection autonome `autonomie.ts`, file d'envoi `envois.ts`, séquences `prospection.ts`), Gmail (`gmail.ts`), garde des media kits (`kitGarde.ts`), verrou des agents autonomes (`verrou.ts`, règles `_shared/verrouAgent.ts`) ; route `file-envoi` : la file des mails de prospection (`_shared/fileEnvoi.ts`) | Claude, ChatGPT, Alfred, `connecteur/`, `Parametres.tsx` ; pg_cron pour `file-envoi` | non | jetons propres hachés, rôle agence, outils fondateurs filtrés, adresses de retour `_shared/oauthRetour.ts`, connexion « agent » : envois et actions irréversibles validés dans la page Agents ; `file-envoi` : CRON_SECRET | `* * * * *` (`envoi-file-minute` → `ttp-mcp/file-envoi`) |

Les crons doublés (`6,7`, `12,13`, `7,8`) servent à tomber à la bonne heure de Paris été comme
hiver : la fonction ne garde que le bon passage. Hors fonction : `ttp-app-state-backup`
(sauvegarde quotidienne du blob, SQL seul) et `events-purge-tombstones` (évènements supprimés
déjà synchronisés, SQL seul).

### Tâches planifiées (`pg_cron`)

Relevé en base le 27 novembre 2026 (`select jobname, schedule from cron.job`). Heures UTC. Les
commandes en base contiennent le secret des crons : ne jamais les recopier dans un fichier
(marqueur `<CRON_SECRET>`).

| Tâche | Horaire | Appelle |
|---|---|---|
| `gmail-poll-5min` | `*/5 * * * *` | `gmail-poll` |
| `gmail-reconcile-1h` | `12 * * * *` | `gmail-reconcile` |
| `google-sync-hourly` | `17 * * * *` | `google-sync` |
| `google-watch-renew` | `0 1 * * *` | `google-watch-renew` |
| `ttp-daily-digest`, `ttp-weekly-digest`, `ttp-afternoon-digest`, `ttp-stats-reminder` | `0 6,7 * * *`, `0 6,7 * * 1`, `0 12,13 * * *`, `0 7,8 * * *` | `daily-digest` |
| `ig-sync-quotidien`, `ig-sync-soir` | `20 5 * * *`, `30 14 * * *` | `ig-sync` |
| `tt-sync-quotidien`, `tt-sync-soir` | `0 6 * * *`, `45 14 * * *` | `tt-sync` |
| `yt-sync-quotidien`, `yt-sync-soir` | `15 6 * * *`, `50 14 * * *` | `yt-sync` |
| `ig-sourcing-2h` | `40 */2 * * *` | `ig-sourcing` (radar, plafond de quota 60 %) |
| `tt-radar-quotidien` | `0 7 * * *` | `tt-radar` |
| `yt-radar-quotidien` | `30 7 * * *` | `yt-radar` |
| `ig-inbox-horaire` | `25 */5 * * *` (toutes les 5 h, malgré son nom) | `ig-inbox` |
| `ig-historique-import` | `*/3 * * * *` | `ig-inbox` (`backfill`), seulement tant que l'import n'est pas fini : sans effet depuis le 25/11 ; arrêt proposé dans le tableau d'état |
| `ig-publish-minute` | `* * * * *` | `ig-publish` |
| `envoi-file-minute` | `* * * * *` | `ttp-mcp/file-envoi` (file d'envoi de la prospection) |
| `agent-watchdog` | `*/5 * * * *` | `agent-watchdog` |
| `monthly-backup` | `0 6 1 * *` | `monthly-backup` |
| `dispos-du-mois` | `45 6 1 * *` | `dispos-du-mois` |
| `ttp-app-state-backup` | `0 2 * * *` | SQL : `backup_app_state()` |
| `events-purge-tombstones` | `0 2 * * *` | SQL : ménage des évènements supprimés |

### Code partagé (`supabase/functions/_shared/`)

| Fichier | Fournit | Utilisé par |
|---|---|---|
| `google.ts` | Client service, CORS, jetons Google, synchro Agenda, `CRON_SECRET`, comparaison à temps constant | presque toutes les fonctions |
| `synchroAgenda.ts` | La synchro Google Agenda sans réseau ni base (testée avec une base et un Google simulés) : quoi envoyer, quoi marquer synchronisé (`sync_source` à `'google'`, sous condition que `updated_at` n'ait pas bougé depuis la lecture), que faire d'une réponse de Google (412 : rendez-vous relu, le plus récent gagne ; 404 ou 410 sur une modification : id effacé, recréé une fois au passage suivant), le passage lui-même (`envoyerVersGoogle`, `appliquerLecture`, avec la base et Google en paramètres), ligne de journal par passage | `google.ts` (`runSyncCycle`, qui fournit la vraie base et le vrai Google), `google-webhook`, `google-sync`, `google-watch-renew`, `google-oauth-callback` |
| `texteSur.ts` | Textes que Postgres accepte toujours : `texteSur` retire le caractère nul et les moitiés d'emoji seules, `couper` coupe à une longueur sans casser d'emoji, `str` lit un texte reçu par un outil du connecteur (une seule définition) | fonctions qui écrivent des textes venus de l'extérieur (radars, DM, mails, journal des bugs, pont d'Alfred, rendez-vous, leads, `ttp-mcp`), app (réponse en DM, PDF de contrat, import CSV, Scouting, ids de la cloche) |
| `ecritureLot.ts` | Écriture par paquets : un paquet refusé pour ses données est réécrit ligne par ligne, seule la mauvaise ligne est perdue (et comptée) ; si les 10 premières lignes réessayées sont toutes refusées, le reste du paquet est compté refusé sans autre requête | `ig-sourcing`, `yt-sourcing`, `yt-radar`, `tt-radar`, `ig-inbox`, `igHistoriqueDb.ts`, app (import CSV des contacts) |
| `gmailBox.ts` | Les deux boîtes : partnerships@ (OAuth de l'app) et talent@ (compte de service) | fonctions `gmail-*`, `creator-mail`, `ttp-mcp` |
| `gfetch.ts` | Appels Gmail avec délai et nouvelles tentatives | mêmes fonctions |
| `push.ts` | Envoi Web Push (VAPID), cibles, purge des abonnements morts | `daily-digest`, `gmail-poll`, `report-error`, `team-notify` |
| `pushPayload.ts` | Format unique des notifications, miroir de `src/lib/deepLink.ts` | `push.ts`, `mailNotif.ts`, `daily-digest` |
| `mailNotif.ts` | Une notification par fil, résumé au-delà de 3 | `gmail-poll` |
| `activityText.ts` | Phrase lisible du journal de l'équipe (aussi importé par l'app) | `team-notify`, `useNotifications.ts`, `Activite.tsx` |
| `state.ts` | `state` OAuth signé (anti-CSRF, 10 min), qui porte son usage (`via`) : un retour refuse un jeton émis pour un autre usage | fonctions `*-connect`, `*-callback`, `google-*` |
| `instagram.ts`, `instagram-login.ts` | API de Meta (lecture des comptes pro, quota) ; connexion d'un créateur : connexion unifiée de Meta si `IG_CONFIG_ID` et `META_APP_SECRET` sont posés (`unifiee`, jeton « EAA… » appelé sur graph.facebook.com), sinon l'ancienne connexion Instagram | fonctions `ig-*` et radars |
| `tiktok.ts` | TikTok Login Kit | `tt-*` |
| `youtube.ts`, `youtube-login.ts` | YouTube Data API (quota) et connexion d'un créateur | `yt-*` |
| `mentions.ts` | Comptes cités dans un post (Meta retire les @) | `ig-sync`, `ig-sourcing` |
| `conformite.ts` | Conformité des posts : mention « Collaboration commerciale » manquante, marque concurrente pendant une exclusivité, ou pendant une exclusivité encore « à vérifier » (pas comptée au tableau du lundi) | `ig-sync`, `tableauLundi.ts` |
| `igFeed.ts` | Feed Instagram d'un créateur (posts, chiffres, chemins d'images) | `ig-sync`, `ig-connect`, `igSuppression.ts` |
| `metaSignedRequest.ts` | Vérifie le `signed_request` de Meta (HMAC-SHA256, base64url, `signature.payload`), lit `user_id` | `ig-deauth`, `ig-data-deletion` |
| `igSuppression.ts` | Ce qu'on efface à l'annulation et à la suppression des données Instagram, code de confirmation, page de statut | `ig-deauth`, `ig-data-deletion` |
| `controle.ts` | Contrôle qualité des données : brouillons échus, collab publiée sans facture, étapes en retard sur l'argent, créateur hors roster, prospect resté ouvert, cachet illisible, brief cassé, tâche cochée pas « Fait », fiche incomplète, étiquettes de contacts ; corrections sûres, problèmes masqués (blob `controleIgnores`) | app (`src/lib/controle.ts`, section « À corriger » d'Aujourd'hui), `ttp-mcp` (`controle_donnees`, Alfred au point de 9 h) |
| `exclusivites.ts` | Exclusivités des créateurs : deux niveaux (« bloque », « à vérifier ») par marque, catégorie lue dans le nom de la marque (mot entier pour un terme court), créateur retrouvé par son prénom (`memeCreateur`), lecture d'un contrat (règles fixes, négation seulement collée au mot), lignes d'un même fil de mails fusionnées (jamais celle d'un autre créateur, registre relu avant d'écrire) | app (`useExclusivites.ts`, page Exclusivités, choix d'un créateur, Mails), `ttp-mcp`, `gmail-poll`, `conformite.ts`, `disposDuMois.ts` |
| `disposDuMois.ts`, `disposDuMoisDb.ts` | Dispos du mois pour les agences : créateurs actifs, chiffres par réseau, prix agence indicatif (méthode TARIF), catégories prises en exclusivité sans la marque ; enregistrement dans `creator_lists.dispos` | app (`BaseCreateurs.tsx`, bouton « Générer les dispos du mois »), `ttp-mcp` (outil `dispos_du_mois`), `dispos-du-mois` |
| `collabAuto.ts`, `collabAutoDb.ts` | Étapes automatiques (logique pure, puis écritures idempotentes qui ne bloquent jamais) : facture payée → collab à l'étape 9, versement qui solde sa facture (ou collab désignée) → étape 10, collab créée ou gagnée → prospect ouvert de la marque « Signé » | app (`Facturation.tsx`, `Reversements.tsx`, `Collabs.tsx` via `src/lib/collabAutoDb.ts`), `ttp-mcp` (`preparer_facture`, `modifier_element`, `creer_element`, `noter_reversement`) |
| `mailTasks.ts` | Demandes d'un mail reçu → tâches (règles fixes FR/EN, échéances, sans IA) | `gmail-poll` (`gmail-poll/tasks.ts`) |
| `signals.ts` | Partenariat payé, emails, « déjà en agence » | `ig-inbox`, `ig-sourcing`, `yt-*` |
| `brandmatch.ts` | Une publication cite-t-elle la marque ? | `tt-sync`, `yt-sync` |
| `autoStats.ts` | Stats du mois relevées toutes seules | `ig-sync`, `tt-sync` |
| `inbox.ts` | Touches de prospection tirées des DM | `ig-inbox` |
| `meetEvent.ts` | Rendez-vous Meet (logique pure, testée) | `meet-invite` |
| `igHistorique.ts`, `igHistoriqueDb.ts` | Import de tout l'historique des DM Instagram, par tranches reprenables (curseur Meta dans `ig_sync_state.inbox_historique`, pause à 75 % du quota, `_shared/quotaMeta.ts`, conversations de plus de 3 ans laissées de côté) | `ig-inbox` (`action: "backfill"`), `ttp-mcp` (`importer_historique_instagram`) |
| `agenceDetection.ts` | Un créateur est-il en agence : « oui », « non » ou « a_verifier » + nom (agences connues, email ou @ d'agence, « représentée par ») | `profilInstagram.ts` |
| `profilInstagram.ts`, `profilInstagramDb.ts` | Profil lu par Business Discovery (email de la bio, engagement, dernier post, agence) et mise à jour de la Base créateurs (`ig_profiles`) ; scan par lots | `ttp-mcp` (`lire_profil_instagram`, `lire_profils_instagram`, `scanner_base_createurs`) |
| `hunter.ts` | Hunter : e-mails pro d'une marque (domain-search, email-finder, vérification). Mis de côté le 24/11 (FullEnrich seulement, ne pas créer de compte) : sans clé `HUNTER_API_KEY`, rien n'est appelé | `ttp-mcp` (`trouver_emails_marque`, `trouver_email_personne` : en sommeil sans clé ; `domaineDe` sert aussi aux outils FullEnrich) |
| `fullenrich.ts`, `fullenrichApi.ts` | FullEnrich : règles pures (classement des personnes par poste), puis appels réseau partagés. Crédits mensuels limités : coût annoncé à chaque appel | `fullenrich`, `ttp-mcp` (`trouver_emails_marque`, `trouver_email_personne`) |
| `mediakitControle.ts` | Chiffres d'un media kit comparés aux chiffres réels (relevés automatiques, mesures du calculateur) : « ok », « à corriger » (abonnés à plus de 25 %, engagement ou vues à plus de 50 %), « à vérifier » (pas de chiffre réel de moins de 62 jours) ; reconnaissance du créateur proposé dans un mail (logique pure, testée) | app (`kit-check.tsx` sur la page Media kit et la fiche roster, `mediakitControleDb.ts` pour « Mettre à jour »), `ttp-mcp` (`kitGarde.ts` : refus des mails de prospection avec un kit faux, section « Media kit » de `fiche_createur`) |
| `appState.ts` | Lecture du blob agence côté serveur : ligne commune et ligne argent (`__finance_state__`, fondateurs), la seconde l'emportant | `ttp-mcp`, `daily-digest`, `creator-report`, `ig-sync`, `ig-data-deletion`, `monthly-backup`, `rdv`, `widget`, `disposDuMoisDb.ts` |
| `mcpAdmin.ts` | Accès complet des fondateurs dans le connecteur : tables lisibles et modifiables, colonnes interdites, suppression vers la Corbeille, calculs des factures ; un texte envoyé dans une colonne JSON est relu en objet | `ttp-mcp` (`admin.ts`, `tools.ts`), `creator-box-mail` |
| `mcpJournal.ts` | La ligne écrite dans `mcp_log` à chaque appel d'outil, avec la raison d'un échec (`error`) | `ttp-mcp` (`callTool`) |
| `verrouAgent.ts` | Verrou des agents autonomes : ce qu'un appel d'agent doit faire valider dans la page Agents (`besoinValidation`, `OUTILS_A_VALIDER`) | `ttp-mcp` (`verrou.ts`, `tools.ts`, `envois.ts`) |
| `oauthRetour.ts` | Adresses de retour autorisées du connecteur (Claude, ChatGPT, agents en local) et destination montrée sur la page d'accord | `ttp-mcp` (`oauth.ts`), `src/connecteur/main.tsx` |
| `equipeClaude.ts` | Ce que les autres membres de l'équipe ont fait par leur propre Claude (lu dans `mcp_log`), et l'anti-doublon d'équipe des brouillons (15 jours pour un nouveau mail, 2 jours dans un fil) | `ttp-mcp` (`tools.ts`) |
| `alfredOutils.ts` | Logique des outils `objectifs`, `modeles_mails` et `ajouter_modele` | `ttp-mcp` |
| `alfredPont.ts` | Logique du pont entre l'iMac d'Alfred et l'app | `alfred-pont`, `agent-watchdog` |
| `alfredSuivi.ts` | Droits d'utilisation vendus aux marques (registre `usageRights`) et posts des créateurs qui cartonnent | `ttp-mcp` (`droits_usage`, `posts_createur`), `controle.ts` |
| `watchdog.ts` | Alfred a-t-il travaillé ce matin ? | `agent-watchdog` |
| `idCourt.ts` | Retrouver un élément par le début de son id (boutons Telegram d'Alfred) | `ttp-mcp` |
| `texteDestinataire.ts` | Ce qui part chez un destinataire ne contient que le message (pas de note pour Marc, pas de « [prénom] »), mêmes règles que `agents/alfred/texte.mjs` | `ttp-mcp` |
| `todoDoublon.ts`, `planningDoublon.ts` | Pas de tâche en double (`creer_tache`) ; doublon ou chevauchement avant d'ajouter un rendez-vous (`creer_evenement`, `creer_meet`) | `ttp-mcp` |
| `taskEvent.ts` | Le rendez-vous « Tâche : … » d'une tâche, retiré de l'agenda quand la tâche est faite | app (`src/lib/todoStatus.ts`), `ttp-mcp` (`cocher_tache`) |
| `strategie.ts` | La stratégie commerciale de l'agence, lue par l'outil `strategie` et rappelée par `methode_tarif` et `preparer_devis` | `ttp-mcp`, `tableauLundi.ts`, app (`monday-board.tsx`) |
| `igDraft.ts` | Brouillon de post Instagram de l'agence déposé par Claude dans Planning › Posts Instagram (toujours en brouillon) | `ttp-mcp` (`brouillon_post_instagram`) |
| `mediakitChiffres.ts` | Mise à jour des seuls chiffres d'une plateforme dans un media kit | `ttp-mcp` (`maj_chiffres_mediakit`), `mediakitControle.ts` |
| `contractDraft.ts`, `contractLecture.ts`, `representation.ts` | Brouillons de contrat préparés par Claude (blob `contractDrafts`, ouverts dans la page Contrats) ; texte complet d'un contrat de représentation tel que l'app l'imprime ; moteur du contrat de représentation | `ttp-mcp` (`preparer_contrat`, `lire_contrat`), app (Contrats, `src/lib/representationContract.ts`, `contractRender.ts`) |
| `versement.ts` | Noter un versement fait à un créateur (blob `creatorPayouts`, même format que l'app) | `ttp-mcp` (`noter_reversement`) |
| `devisRelances.ts` | Relances des devis envoyés (J+2, J+5, J+10) | `ttp-mcp` (`devis_a_relancer`) |
| `birthdays.ts` | Anniversaires des créateurs (veille et jour J) | app (`useNotifications.ts`), `ttp-mcp` (`notifications`) |
| `audience.ts` | Abonnés d'un créateur, tous réseaux (même règle que le Roster) | `ttp-mcp` |
| `baseCreateurs.ts`, `niche.ts` | Tri et texte de la Base créateurs ; catégories du Scouting et niche devinée dans la bio | app (Base créateurs, Scouting, Sourcing), `ttp-mcp` (`base_createurs`) |
| `recrutement.ts`, `recrutementSuivi.ts` | Un compte de la Base est-il un bon créateur à recruter (option `pour_recruter`) ; suivi du recrutement d'une fiche du Scouting (premier contact, relances J+5 et J+12, dans `poolTracking`) | `ttp-mcp` (`base_createurs`, `createurs_a_contacter`, `noter_contact_createur`) |
| `contactAjout.ts`, `contactTags.ts` | Ajout de contacts sans doublon (e-mail, LinkedIn ou @), par lots ; liste fermée des catégories d'un contact | `ttp-mcp` (`ajouter_contact`, `ajouter_contacts`), app (Contacts) |
| `dejaEchange.ts` | Avant un brouillon : les derniers échanges avec ce destinataire, dans toutes les boîtes | `ttp-mcp` (`creer_brouillon_mail`) |
| `piecesJointes.ts` | Joindre des fichiers à un brouillon Gmail | `ttp-mcp`, `alfred-pont` |
| `fileEnvoi.ts` | File d'envoi des mails de prospection : heures de bureau, écart entre deux mails, plafond par jour et par boîte, règle des 30 jours par société, coupe-circuit sur les rebonds | `ttp-mcp` (`envois.ts` : `programmer_envoi`, `file_envoi`, `annuler_envoi`, `ne_plus_contacter`, route `file-envoi`) |
| `mxCheck.ts` | Le domaine d'une adresse peut-il recevoir des mails ? (DNS public) | `ttp-mcp` (`prospection.ts`) |
| `sequence.ts` | Séquence de prospection d'une fiche contact (J0, J+5, J+12, tout par mail) | `ttp-mcp`, `gmail-poll` (`sequences.ts`), `rdv`, app (Contacts) |
| `reponseProspect.ts` | Classe la réponse d'un prospect (intéressé, plus tard, refus, à lire) et la tâche à créer | `gmail-poll` (`sequences.ts`) |
| `marquesChaudes.ts` | Mise en forme des « marques chaudes » du radar (fonction SQL `radar_marques_chaudes`) | `ttp-mcp` (`sourcing`) |
| `dmSansReponse.ts` | Conversations Instagram restées sans réponse, avec ce qu'on sait déjà du compte | `ttp-mcp` (`dm_sans_reponse`) |
| `siteMarque.ts` | Lire le site d'une marque pour trouver son adresse de contact (gratuit) | `ttp-mcp` (`lire_site_marque`), `ig-sourcing` |
| `siteLead.ts` | Demande de roster venue du site : contact « Lead site » et tâche de tri pour Gianni | `site-lead`, `rdv` |
| `rdv.ts` | Page publique de rendez-vous : créneaux libres de Marc (heure de Paris), messages Telegram et mail | `rdv`, `fileEnvoi.ts`, `ttp-mcp` (`envois.ts`), app (Paramètres) |
| `auteurEnvoi.ts` | « Envoyé par » : qui de l'équipe a envoyé un mail (`email_activity.envoye_par`) | `gmail-send`, `ttp-mcp` |
| `mailFil.ts` | Lire un long fil sans perdre la fin (citations retirées, messages récents d'abord) | `ttp-mcp` (`gmail.ts`) |
| `mailIgnore.ts` | Expéditeurs « Pas à traiter » (blob `mailIgnoredSenders`) | `gmail-poll`, `widget`, app (`mailIgnored.ts`, Mails) |
| `mailKind.ts` | Fil qui n'attend pas de réponse (absence, notification, newsletter, transfert) | `gmail-history`, `creator-mail` |
| `mailLu.ts` | Un mail ouvert dans Gmail ou Spark devient « lu » dans l'app | `gmail-poll` |
| `mailModels.ts` | Modèles de mails fournis par l'app, copie de `src/lib/mailModels.ts` (test `mailModelsSync.test.ts`) | `ttp-mcp` (`reglages_app`) |
| `gmailDrafts.ts` | Brouillons Gmail du dossier « Brouillons » (ceux de Claude repérés) | `gmail-history`, `gmail-thread` |
| `emailReaction.ts` | Réactions emoji au format Gmail | `gmail-send`, `gmail-thread`, `creator-mail` |
| `sendAs.ts` | Adresses « Envoyer en tant que » d'une boîte Gmail (alias déjà réglés seulement) | `gmail-send`, `ttp-mcp`, app (`useSendAs.ts`, composeur) |
| `creatorReply.ts` | Réponse d'un créateur à une marque depuis son espace (boîte talent@, alias en copie) | `creator-mail` |
| `creatorBox.ts` | Boîtes Gmail des créateurs reliées à TTP Suite (lien signé, jetons dans `creator_mail_boxes`) | `creator-box-callback`, `creator-box-mail`, `ttp-mcp` |
| `peoplePhotos.ts` | Photos de profil Google des correspondants (API People) | `mail-photos` |
| `igConnexion.ts` | Connexion Instagram des créateurs : raison d'un échec, messages, état de la connexion, lien de 7 jours signé | `ig-callback`, `ig-connect`, `instagram-login.ts`, `ttp-mcp`, app (`src/lib/instagram.ts`) |
| `quotaMeta.ts` | Plafonds par tâche sur le quota Meta partagé (`PLAFONDS` : profils 85 %, import 75 %, radar 60 %) et attente si le dernier relevé est trop haut | `instagram.ts`, `igHistoriqueDb.ts`, `profilInstagramDb.ts` |
| `igMedia.ts` | Photos, vidéos, vocaux et partages des DM, recopiés dans le bucket privé `ig-media` | `ig-inbox` |
| `igSend.ts` | Envoi d'un DM depuis l'app (1 000 caractères au plus) | `ig-send`, `ttp-mcp` (`envoyer_dm`) |
| `creatorCollabs.ts` | Les collabs d'un créateur, post par post (mode `collabs`) | `ig-sourcing` |
| `collabPosts.ts` | Un post du créateur cite-t-il la marque de la collab ? (Meta retire les @) | `ig-sync`, `conformite.ts` |
| `engagementRate.ts` | Le calcul unique du taux d'engagement (sur les abonnés ou sur les vues) | `ig-sync`, `yt-sourcing`, `instagram.ts`, `tiktok.ts`, `youtube-login.ts`, `creatorCollabs.ts`, app (`igFeed.ts`) |
| `reversements.ts` | Le calcul unique des reversements (la page Reversements l'importe), et les fins de contrat | app (Reversements), `ttp-mcp`, `daily-digest`, `creator-report`, `compta.ts`, `tableauLundi.ts` |
| `compta.ts` | Règles de la page Compta côté serveur, copie de `src/lib/compta.ts` et `comptaRates.ts` | `ttp-mcp` (`compta`) |
| `tarif.ts` | Méthode TARIF (barème `pricingRates.ttp`, plancher par créateur) ; `docs/methode-tarif.md` en est tiré (test) | app (`pricingTTP.ts`), `ttp-mcp` (`methode_tarif`), `disposDuMois.ts` |
| `cachet.ts` | Une seule façon d'écrire le cachet d'une collab | app (`cachet-field.tsx`, Collabs, Tarifs, Prospection), `ttp-mcp` |
| `backup.ts`, `backupStatus.ts`, `drive.ts` | Sauvegarde mensuelle : CSV, mail avec pièce jointe, PDF des kits ; état du dernier passage (blob `backupStatus`) ; Google Drive limité aux fichiers créés par l'app | `monthly-backup` (et `backup.ts` : `rdv`, `creatorReply.ts`), app (Paramètres) |
| `eventKind.ts` | Type d'un évènement deviné d'après son titre, copie de `src/lib/eventKind.ts` | `google.ts`, `ttp-mcp` |
| `widget.ts`, `widgetRenderer.ts` | Widget iPhone : règles (tâches, planning, clé) et dessin servi par `widget` | `widget`, app (`widgetScript.ts`, Paramètres) |

## 7. Base de données (`supabase/`)

| Fichier | Rôle |
|---|---|
| `SETUP.sql` | Schéma complet et sécurité : source de vérité, relançable. |
| `sql/*.sql` | Une migration par changement (fichiers récents nommés `AAAA-MM-JJ-sujet.sql`), appliquée dans le SQL Editor par Marc, ou par une session après le « oui » de Marc ou de Gianni (`../CLAUDE.md`, « Règle prod »). |
| `sql/README.md` | Tableau d'état : ce qui est appliqué en prod (✅) et ce qui reste à faire (⏳). À lire en premier. |
| `config.toml` | `verify_jwt` de chaque fonction. |
| `PUSH_SETUP.sql` | Ancienne mise en place des notifications : sa table est dans `SETUP.sql`, son cron est remplacé par `sql/06-…`. Ne pas relancer le cron. |
| `migrations/20260702_google_calendar.sql` | Ancienne migration Google Agenda (historique). |

## 8. Fichiers publics (`public/`)

| Chemin | Rôle |
|---|---|
| `CNAME` | Domaine `app.ttpcreators.pro`. |
| `.well-known/` | Découverte OAuth du connecteur Claude (dossier caché : voir `deploy.yml`). |
| `sw.js` | Service worker. |
| `manifest.webmanifest`, icônes, `splash/` | PWA et écrans de lancement iOS. |
| `fonts/` | Polices Instrument Serif et Sans des PDF. |
| `agents/` | Figurines des agents IA (`src/lib/agentAvatars.ts`). |
| `yt-callback/index.html` | Page relais du retour Google pour YouTube. |
| `rdv/` | Page publique « Réserver une visio » (`rdv.js` appelle la fonction `rdv`). |
| `document/` | Lecteur des documents HTML du stockage (contrats) : `/document/#<lien signé>`, scripts du fichier bloqués. |
| `boite-reliee/` | Page de fin de la liaison d'une boîte Gmail de créateur (`creator-box-callback`). |
| `instagram-relie/` | Page de fin de la connexion Instagram par lien (`ig-callback`). |
| `instagram-donnees/` | Page de statut d'une suppression des données Instagram (code de confirmation, `ig-data-deletion`). |
| `tiktok*.txt` | Fichier de vérification du domaine pour TikTok. |

## 9. Tests

- Vitest, lancé par `npm test` et par `npm run build`.
- Côté app : `src/lib/*.test.ts`, un fichier par module de logique pure.
- Côté serveur : la logique pure des fonctions est testée depuis `src/lib/` en important le
  fichier avec son extension `.ts` (ex. `pushPayload.test.ts` importe
  `../../supabase/functions/_shared/pushPayload.ts` ; `creatorMail.test.ts` importe
  `creator-mail/logic.ts`), ou à côté du fichier (`_shared/meetEvent.test.ts`).
- `src/lib/i18n.test.ts` vérifie que chaque traduction garde les mêmes variables `{…}`.
- Alfred : `agents/alfred/tests/*.test.ts`, lancés aussi par `npm run build` (jamais installés sur l'iMac).
  `consignes.test.ts` : tronc sous 40 000 caractères, index des fiches, renvois « voir « … » »,
  pas de tiret long. `outils.test.ts` : chaque outil du connecteur est classé dans une seule
  liste de `alfred.sh`, et aucune liste ne vise un outil disparu.
- Edge Functions : le contrôle « fonctions » de chaque PR (`verif-pr.yml`) lance `deno check` sur
  toutes les fonctions (pas encore exigé pour fusionner).
- `tsc` ne vérifie que `src/` : un fichier serveur importé par un test de `src/` est donc
  aussi typé.
