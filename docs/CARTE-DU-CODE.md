# Carte du code

Où vit chaque chose dans TTP Suite. Établie à partir de l'arborescence réelle (21 octobre
2026) : chaque ligne a été vérifiée dans l'en-tête ou le code du fichier. Quand un fichier
est ajouté, déplacé ou retiré, mettre cette carte à jour dans le même commit.

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
| `vite.config.ts` | `base: "./"`, deux entrées (app + connecteur), alias `@` = `src`, découpage `react` / `motion`, écrit `dist/version.json` à chaque build (numéro de mise en ligne), tests sans `.claude/**`. |
| `src/index.css` | Seul endroit des jetons de design (couleurs, statuts `--st-*`, thèmes `data-theme`, rayons, police). |
| `public/sw.js` | Service worker : notifications push, pastille de l'icône, cache (`ttp-shell-v2` réseau d'abord, `ttp-assets-v2` cache d'abord). |
| `.github/workflows/deploy.yml` | Push sur `main` : `npm ci`, `npm run build`, publication GitHub Pages (avec `include-hidden-files` pour `.well-known/`). |

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
| `RosterTabs.tsx` | `roster` | Conteneur du roster : onglet Liste (`Roster.tsx`) et Accompagnement (`RosterTracking` de `CreatorTracking.tsx`). |
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
| `Gifting.tsx` | `gifting` | Produits offerts et contenus attendus. |
| `Debrief.tsx` | `debrief` | Bilans de campagne pour les marques (PDF, mail) ; calculateur dans `DebriefCalculator.tsx`. |
| `Idees.tsx` | `ideas` | Idées de contenus et de collabs. |
| `Facturation.tsx` | `facturation` (F) | Factures : éditeur, statuts, PDF. |
| `Relances.tsx` | `relances` (F) | Factures en retard et mail de relance. |
| `Reversements.tsx` | `reversements` (F) | Ce que l'agence doit reverser à chaque créateur. |
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
| `IgPlanner.tsx` | Planning → Posts Instagram. |

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
| Mise en page et navigation | `page-header` (`PageFrame`, `PageHeaderRow`), `dashboard-sidebar` (primitives de menu, agence et créateur), `dash`, `welcome-modal`, `scaled-preview` |
| Onglets et filtres | `animated-tabs` (`Tabs`), `motion-tabs`, `morphing-tabs`, `folder-tabs` (onglets « dossier » de la page Agents, avec code couleur, pour fiche créateur, Roster, Scouting, Media kit, Sourcing, Contrats, Planning, Accès, Paramètres ; onglets simples avec pastille sur téléphone), `filter-bar`, `filter-panel`, `period-filter`, `date-range-picker`, `pill-search` |
| Formulaires | `form` (`AddButton`, `InlineForm`, champs), `select`, `checkbox`, `popover`, `status-select`, `creator-multi-picker`, `recipient-picker`, `image-field`, `avatar-upload`, `signature-picker`, `mediakit-theme-picker`, `subtask-checklist` |
| Retours et statuts | `toast`, `alert`, `notifications`, `notification-panel`, `undo-send`, `loader`, `status-pill`, `be-ui-animated-badge`, `help-tip`, `tooltips`, `kbd`, `progress` |
| Données et graphiques | `chart` (recharts), `glass-stat-chart`, `stat-card`, `stats-bento`, `event-calendar`, `agent-plan`, `file-card-collections`, `cobe-globe-stickers` |
| Avatars et icônes | `agency-avatar`, `creator-avatar`, `platform-icon`, `icon-tile` |
| Divers | `action-menu` (`ActionMenu`, `ConfirmDialog`), `expandable-action-bar`, `google-connect` (carte Google Agenda), `push-card` (notifications côté créateur) |

## 5. Logique (`src/lib/`) par domaine

Règle : la logique pure (sans React ni Supabase) vit dans `src/lib/<nom>.ts`, avec son test
`src/lib/<nom>.test.ts` à côté. Les accès base sont dans des fichiers séparés (`*Db.ts`,
`use*.ts`).

| Domaine | Fichiers |
|---|---|
| Socle données | `supabase.ts` (client, clé anon), `db.ts` (insert / update / delete), `appState.ts` (blob agence `__app_state__`), `useLive.ts` (resynchronisation), `viewCache.ts`, `trash.ts` (corbeille), `useCreators.ts`, `money.ts`, `utils.ts`, `dates.ts`, `dateRange.ts`, `timeSeries.ts` |
| Navigation et interface | `nav.tsx`, `navSub.ts`, `navAction.ts`, `navSeen.ts`, `useNavBadges.ts`, `hiddenPages.ts`, `restrictedViews.ts`, `pageAliases.ts`, `viewHints.ts`, `tabs.ts`, `openIntent.ts`, `deepLink.ts`, `commandPalette.ts`, `search.ts`, `searchKinds.ts`, `useGlobalSearch.ts`, `settingsSearch.ts`, `folderTabs.ts`, `useFolderTones.ts`, `useVisitedTabs.ts`, `useStickyState.ts`, `iosUi.ts`, `touch.ts`, `ease.ts`, `hooks/` (gestes) |
| Apparence | `accent.ts` (accent et thèmes Clair, Verre, Noir, Auto), `theme.ts` (contexte React), `statusTone.ts` (un sens par couleur) |
| Mise à jour et santé | `appUpdate.ts` (`version.json`, `lazyImport`), `errorReport.ts`, `diagnostics.ts`, `features.ts` (fonctions en attente d'accord Meta, TikTok, Google) |
| Aujourd'hui et anticipation | `aujourdhui.ts`, `anticipation.ts`, `relance.ts`, `useRelanceInvoices.ts` |
| To-do | `todoCreators.ts` + `todoCreatorsDb.ts` (plusieurs créateurs), `todoQuickAdd.ts`, `todoProgress.ts`, `todoStatus.ts`, `routines.ts` |
| Mails | `mailSend.ts` (envoi, « Annuler l'envoi », brouillons), `mailSignature.ts`, `useMailSignatures.ts`, `useMailSettings.ts`, `mailTemplates.ts`, `mailThreadContext.ts` (contexte donné à Claude), `mailCollab.ts`, `mailAvatar.ts`, `useMailUnread.ts`, `useAttachments.ts`, `mailAddresses.ts` |
| Espace créateur | `creatorTabs.ts`, `creatorMissions.ts`, `creatorNextStep.ts`, `creatorGains.ts`, `creatorMail.ts`, `creatorMailCounts.ts`, `creatorTracking.ts`, `monthlyReport.ts` |
| Traduction | `i18n.tsx`, `i18n/en.ts`, `i18n/en-shared.ts`, `i18n/en-creatorSpace.ts`, `i18n/en-creatorPages.ts` |
| Facturation et argent | `invoice.ts` (calcul unique HT, TVA, commission, reversement, au centime ; `invoiceTotals` pour une facture enregistrée), `reversements.ts` (dû, versé, reste par créateur, même calcul que les gains du créateur), `commission.ts` (`rateFor` : taux de la fiche sans tenir compte des majuscules), `useFounder.ts` (montants visibles des fondateurs seulement), `pricing.ts` (ancien moteur : UGC, calcul du media kit), `pricingTTP.ts` + `_shared/tarif.ts` (méthode TARIF, aussi lue par l'outil Claude `methode_tarif`) |
| Contrats | `contractRegistry.ts` + `contractRegistryDb.ts`, `contractDuration.ts`, `representationContract.ts`, `agencySignature.ts` |
| PDF | `pdfDoc.ts` (identité commune des documents), `printPdf.ts` (`printHtml`) |
| Briefs, collabs, bilans | `briefResume.ts`, `collabs.ts` (11 étapes), `campaignRecap.ts`, `engagement.ts`, `objectivesTrend.ts`, `platform.ts` |
| Contacts et prospection | `touches.ts` + `touchesDb.ts`, `contactRelance.ts` |
| Scouting et sourcing | `scouting.ts`, `niche.ts`, `sourcingScore.ts`, `igRivals.ts`, `ttRadar.ts` |
| Réseaux sociaux | `instagram.ts`, `igFeed.ts`, `igPlanner.ts`, `tiktok.ts`, `youtube.ts` |
| Media kits | `mediakitSlug.ts` (même calcul que le site), `mediakitThemes.ts` (mêmes ids que le site), `mediakitBiosEn.ts` |
| Équipe, agents, notifications | `team.ts`, `useMyName.ts`, `agentAvatars.ts`, `push.ts`, `appBadge.ts`, `useNotifications.ts`, `notifLocal.ts`, `notifTexts.ts` |
| Agenda et divers | `googleCalendar.ts`, `gifting.ts`, `openLater.ts` (ouvrir un onglet après un `await` sur iPhone) |

## 6. Edge Functions (`supabase/functions/`)

Déployées à la main par Marc (jamais par la CI) :
`supabase functions deploy <nom> --project-ref zizvggziggswhrbuyhuo`.
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
| `gmail-poll` | Nouveaux mails reçus → `email_activity` + push | pg_cron | non | CRON_SECRET ou agence | `*/5 * * * *` |
| `gmail-reconcile` | Mails envoyés → `contacts.last_contacted` et touches | pg_cron | non | CRON_SECRET ou agence | `12 * * * *` |
| `creator-mail` | Boîte mail de l'espace créateur, filtrée côté serveur (logique pure dans `logic.ts`) | `creatorMail.ts` | oui | créateur = ses fils ; agence peut viser un créateur | |
| `meet-invite` | Rendez-vous Google Agenda avec lien Meet et invitations | `components/meet-invite.tsx` | oui (absente de `config.toml`, défaut) | rôle agence | |
| `send-email` | Envoi via Resend | `Contacts.tsx`, `Mediakit.tsx`, `Vivier.tsx`, `Debrief.tsx` | oui | rôle agence | |

### Google Agenda

| Fonction | Rôle | Appelée par | JWT | Contrôle | Cron |
|---|---|---|---|---|---|
| `google-connect-url` | URL d'autorisation Google (state signé) | `googleCalendar.ts` | oui | rôle agence, origine autorisée | |
| `google-oauth-callback` | Retour de Google, jetons, premier cycle | navigateur (Google) | non | state signé | |
| `google-status` | Statut de connexion (sans jeton) | `googleCalendar.ts` | oui | rôle agence | |
| `google-disconnect` | Déconnexion propre | `googleCalendar.ts` | oui | rôle agence | |
| `google-sync` | Synchro dans les deux sens `events` ↔ Agenda | pg_cron, `googleCalendar.ts`, appels internes | non | CRON_SECRET ou agence | `17 * * * *` |
| `google-watch-renew` | Renouvelle l'abonnement aux changements | pg_cron | non | CRON_SECRET | `0 1 * * *` |
| `google-webhook` | Reçoit les changements de Google | Google | non | jeton du canal | |

### Instagram, TikTok, YouTube

| Fonction | Rôle | Appelée par | JWT | Contrôle | Cron |
|---|---|---|---|---|---|
| `ig-avatar` | Profils Instagram du Scouting | `Vivier.tsx` | oui | rôle agence | |
| `ig-hashtag` | Posts par hashtag | `HashtagSearch.tsx` | oui | rôle agence | |
| `ig-sync` | Chiffres Instagram du roster (+ feed des 12 derniers posts, images copiées dans `avatars/feed/`), des collabs, des marques | pg_cron, `instagram.ts`, `ig-callback` | non | CRON_SECRET ou agence | `20 5 * * *` |
| `ig-connect` / `ig-callback` | Un créateur connecte son Instagram | `instagram.ts` / navigateur | oui / non | créateur ou agence / state signé | |
| `ig-sourcing` | Sourcing, radar à marques, concurrents | pg_cron, `Sourcing.tsx`, `RivalWatch.tsx` | non | CRON_SECRET ou agence | `40 */2 * * *` |
| `ig-inbox` | DM du compte de l'agence | pg_cron, `Messages.tsx`, `ig-webhook` | non | CRON_SECRET ou agence | `25 * * * *` |
| `ig-webhook` | Réception des DM en direct (Meta) | Meta | non | signature `X-Hub-Signature-256` | |
| `ig-publish` | Publie les posts programmés | pg_cron, `IgPlanner.tsx` | non | CRON_SECRET ou agence | `* * * * *` |
| `tt-connect` / `tt-callback` | Un créateur connecte son TikTok | `tiktok.ts` / navigateur | oui / non | créateur ou agence / state signé | |
| `tt-sync` | Chiffres TikTok des créateurs connectés | pg_cron, `tiktok.ts`, `tt-callback` | non | CRON_SECRET ou agence | `0 6 * * *` |
| `tt-radar` | Radar à collabs TikTok | pg_cron, `TikTokRadar.tsx` | non | CRON_SECRET ou agence | `0 7 * * *` |
| `yt-connect` / `yt-callback` | Un créateur connecte sa chaîne (retour via `public/yt-callback/`) | `youtube.ts` / navigateur | oui / non | créateur ou agence / state signé | |
| `yt-sync` | Chiffres YouTube des créateurs connectés | pg_cron, `youtube.ts`, `yt-callback` | non | CRON_SECRET ou agence | `15 6 * * *` |
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
| `ttp-mcp` | Connecteur Claude : serveur MCP (`index.ts`), OAuth (`oauth.ts`), outils (`tools.ts`), Gmail (`gmail.ts`) | Claude, `connecteur/`, `Parametres.tsx` | non | jetons propres hachés, rôle agence, outils fondateurs filtrés | |

Les crons doublés (`6,7`, `12,13`, `7,8`) servent à tomber à la bonne heure de Paris été comme
hiver : la fonction ne garde que le bon passage. Hors fonction : `ttp-app-state-backup`
(sauvegarde quotidienne du blob, SQL seul).

### Code partagé (`supabase/functions/_shared/`)

| Fichier | Fournit | Utilisé par |
|---|---|---|
| `google.ts` | Client service, CORS, jetons Google, synchro Agenda, `CRON_SECRET`, comparaison à temps constant | presque toutes les fonctions |
| `gmailBox.ts` | Les deux boîtes : partnerships@ (OAuth de l'app) et talent@ (compte de service) | fonctions `gmail-*`, `creator-mail`, `ttp-mcp` |
| `gfetch.ts` | Appels Gmail avec délai et nouvelles tentatives | mêmes fonctions |
| `push.ts` | Envoi Web Push (VAPID), cibles, purge des abonnements morts | `daily-digest`, `gmail-poll`, `report-error`, `team-notify` |
| `pushPayload.ts` | Format unique des notifications, miroir de `src/lib/deepLink.ts` | `push.ts`, `mailNotif.ts`, `daily-digest` |
| `mailNotif.ts` | Une notification par fil, résumé au-delà de 3 | `gmail-poll` |
| `activityText.ts` | Phrase lisible du journal de l'équipe (aussi importé par l'app) | `team-notify`, `useNotifications.ts`, `Activite.tsx` |
| `state.ts` | `state` OAuth signé (anti-CSRF, 10 min) | fonctions `*-connect`, `*-callback`, `google-*` |
| `instagram.ts`, `instagram-login.ts` | API de Meta (lecture des comptes pro, connexion d'un créateur, quota) | fonctions `ig-*` et radars |
| `tiktok.ts` | TikTok Login Kit | `tt-*` |
| `youtube.ts`, `youtube-login.ts` | YouTube Data API (quota) et connexion d'un créateur | `yt-*` |
| `mentions.ts` | Comptes cités dans un post (Meta retire les @) | `ig-sync`, `ig-sourcing` |
| `igFeed.ts` | Feed Instagram d'un créateur (posts, chiffres, chemins d'images) | `ig-sync`, `ig-connect` |
| `signals.ts` | Partenariat payé, emails, « déjà en agence » | `ig-inbox`, `ig-sourcing`, `yt-*` |
| `brandmatch.ts` | Une publication cite-t-elle la marque ? | `tt-sync`, `yt-sync` |
| `autoStats.ts` | Stats du mois relevées toutes seules | `ig-sync`, `tt-sync` |
| `inbox.ts` | Touches de prospection tirées des DM | `ig-inbox` |
| `meetEvent.ts` | Rendez-vous Meet (logique pure, testée) | `meet-invite` |

## 7. Base de données (`supabase/`)

| Fichier | Rôle |
|---|---|
| `SETUP.sql` | Schéma complet et sécurité : source de vérité, relançable. |
| `sql/*.sql` | Une migration par changement (fichiers récents nommés `AAAA-MM-JJ-sujet.sql`), lancée à la main dans le SQL Editor. |
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
| `tiktok*.txt` | Fichier de vérification du domaine pour TikTok. |

## 9. Tests

- Vitest, lancé par `npm test` et par `npm run build`.
- Côté app : `src/lib/*.test.ts`, un fichier par module de logique pure.
- Côté serveur : la logique pure des fonctions est testée depuis `src/lib/` en important le
  fichier avec son extension `.ts` (ex. `pushPayload.test.ts` importe
  `../../supabase/functions/_shared/pushPayload.ts` ; `creatorMail.test.ts` importe
  `creator-mail/logic.ts`), ou à côté du fichier (`_shared/meetEvent.test.ts`).
- `src/lib/i18n.test.ts` vérifie que chaque traduction garde les mêmes variables `{…}`.
- `tsc` ne vérifie que `src/` : un fichier serveur importé par un test de `src/` est donc
  aussi typé.
