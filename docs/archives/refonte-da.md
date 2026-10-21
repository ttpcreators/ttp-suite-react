# Refonte visuelle « Calme, aéré, précis » (branche `refonte-da`)

> **Décision de Marc (2026-10-14, après les 3 premières étapes)** : on garde la **typo** et les
> **couleurs** de l'app actuelle (police d'origine partout, chiffres compris ; bleu pour l'action
> et les graphes ; vert et rouge vifs pour les variations ; couleurs de statut d'avant ; sombre
> Minuit et Classique d'avant). La refonte ne garde que les **formes** : boutons et onglets en
> pilule, boutons icône ronds, rayons 10 / 14 / 20, cartes blanches sans bordure posées sur le
> fond, plus d'air, titres de page en 32. Seule entorse : `--faint` passe de `#a1a1aa` à
> `#71717a` (métadonnées lisibles, 4,8:1 sur blanc, exigence d'accessibilité du brief).
> Les sections 3 à 5 ci-dessous décrivent la première version (palette noire et pastels), écartée.

Uniquement le visuel : ni la logique métier, ni Supabase, ni les routes ne changent.
✅ **En ligne depuis le 2026-10-14** (branche `refonte-da` fusionnée dans `main`, commit `bf7b98a`).

## 1. Inventaire du système actuel (avant refonte)

**Jetons** (`src/index.css`) : variables shadcn (`--background`, `--card`, `--primary`…) plus des
jetons maison (`--panel`, `--surface`, `--faint`, `--rowhover`, `--signal*`, `--indigo/amber/cyan`
devenus des niveaux de gris). Tailwind v4, `@theme inline` relie les variables aux classes.

**Thèmes** :
- clair ;
- sombre « Minuit » (par défaut) ;
- sombre « Classique » (bleu) ;
- couleur d'accent personnalisable par appareil (Paramètres → Couleur d'accent, `src/lib/accent.ts`,
  posée en ligne sur la racine) ;
- mode iPhone (classe `ios-ui`).

**Composants partagés** (`src/components/ui/`) :
- `button` (shadcn) ;
- `animated-tabs` (filtres en pilules segmentées, Cartes / Liste, 7 / 30 / 90 j) ;
- `be-ui-animated-badge` (chips de statut) ;
- `page-header` (titre + phrase + actions) ;
- `dash` (panneaux, titres de section, variation, jauge radiale, jauge en bâtons) ;
- `stat-card`, `stats-bento`, `mini-chart`, `glass-stat-chart` ;
- `filter-bar`, `filter-panel`, `period-filter`, `date-range-picker` ;
- `dashboard-sidebar` (groupes repliables, rail, sélecteur d'espace) ;
- `notifications` ;
- `creator-avatar` ;
- `input`, `select`, `checkbox`, `popover`, `toast`, `welcome-modal`.

**Pages** : une cinquantaine de vues dans `src/views/` (Aperçu, Roster, Collabs, Facturation,
Contrats, Mails, Planning, Sourcing, Scouting, Contacts, Pricing, Engagement…), plus l'espace
créateur (`CreatorSpace.tsx`).

## 2. Incohérences relevées

| Sujet | Constat |
|---|---|
| Action principale | Bleu `#0069fe` (`--primary`) sur 109 boutons, noir (`bg-foreground`) sur 12 autres : deux couleurs d'action. |
| Couleurs de statut | Écrites en dur avec la palette Tailwind : emerald ×140, rose ×109, red ×46, amber / orange / yellow ×36, sky / blue ×13, violet / indigo / purple ×18. Le même sens (« en retard ») est tantôt rose, tantôt rouge. |
| Chips de statut | « warning » (en attente) en GRIS, « info » en neutre : l'attente ne se distingue pas du clôturé. |
| Variations des KPI | Pastille pleine verte ou rouge avec texte vert ou rouge vif (contraste < 4,5:1 sur blanc). |
| Métadonnées | `--faint #a1a1aa` : contraste 2,6:1 sur blanc, sous le minimum de 4,5:1. |
| Rayons | rounded-md ×98, lg ×607, xl ×234, 2xl ×271, full ×342, plus 39 valeurs arbitraires (`rounded-[8px]`, `[10px]`, `[22px]`…). Les boutons sont tantôt carrés-arrondis, tantôt pilules. |
| Cartes | Bordure grise + panneau gris intermédiaire + cartes blanches : trois niveaux au lieu de « blanc sur gris ». |
| Typo | « Inter » déclarée mais jamais chargée : la police système s'affiche. Les chiffres ne sont pas en mono. |
| Couleurs en dur | 156 codes hex dans les `.tsx` (surtout PDF, e-mails et media kits, qui ont leur propre identité : hors périmètre). |
| Barre d'état | Couleur `theme-color` figée sur l'ancien gris (`#f4f4f5`) et sur le noir. |

## 3. Fait sur la branche (un commit par étape)

1. **Jetons** (`593545a`) :
   - palette claire et sombre ;
   - 6 statuts (fond / texte / point / aplat), avec un sens par couleur ;
   - rayons 10 / 14 / 20 / 24 ;
   - Geist et Geist Mono chargées (paquets `@fontsource-variable`) ;
   - tout ce qui est en chiffres tabulaires passe en mono ;
   - les anciennes couleurs Tailwind (emerald, rose, amber, sky, violet…) pointent désormais sur
     les jetons de statut, donc tous les écrans existants changent d'un coup, en clair ET en sombre ;
   - « Classique » n'est plus bleu.
2. **Composants partagés** (`30d6267`) :
   - boutons en pilule : noir pour l'action, contour ou gris doux sinon ; 153 boutons de page
     convertis, plus 26 boutons icône ronds ;
   - onglets segmentés : fond gris doux, onglet actif en pilule blanche ;
   - chips de statut alignées sur les pastels ;
   - en-tête de page en 32 / 600 ;
   - élément actif de la barre latérale en pilule blanche ;
   - recherche en pilule ;
   - cartes sans bordure ;
   - variations des KPI en chip pastel mono.
3. **Aperçu** (`36e87ff`) :
   - titres de carte en 20 / 600 ;
   - plus d'air ;
   - heures des rendez-vous en grand mono ;
   - barre « Facturé au total » aux couleurs de statut ;
   - lignes de liste plus aérées ;
   - avatars à initiales sur pastel (stable par nom, jamais le rouge réservé à l'urgent) ;
   - noms de créatrices en mono.

Porte de qualité : lint, 173 tests, types et build OK à chaque étape.

## 4. Plan de la suite (page par page, un commit chacune)

1. **Champs** : rayon 10, bordure `--input`, hauteur 40, focus noir ; **tableaux** : lignes plus
   hautes, en-têtes en gris ; **fenêtres et menus** : rayon 20.
2. **Facturation** : carte « Montant en retard » en pastel urgent (comme la maquette), KPI collés
   avec mini-bâtons noirs et gris.
3. **Collabs** : progression en 11 segments noirs, badge « X j à cette étape » en pastel attente
   au-delà de 7 jours.
4. **Roster** : cartes créatrices (photo ou initiales pastel), noms en mono.
5. **Contrats, Mails, Planning** (événements en pastel par type : tournage, call, publication, interne).
6. **Sourcing, Scouting, Contacts, Prospection** (barre « TOI » des concurrents, actions rapides).
7. Pages restantes (Pricing, Engagement, Gifting, Idées, To-do, Paramètres…).
8. **Thème sombre** : déjà actif partout grâce aux jetons. Il reste à le valider page par page.

À décider : la **couleur d'accent personnalisable** (Paramètres) remplace le noir de l'action sur
l'appareil où elle est réglée. Je propose de la retirer pour respecter la DA (ou de ne garder que
« Par défaut »).

## 5. Espace créateur : proposition mobile (pas encore codée)

- **Barre de navigation en bas** (5 onglets, icône + libellé, cibles de 44 px) :
  - Accueil ;
  - Collabs (briefs et tâches) ;
  - Stats ;
  - Factures ;
  - Profil (media kit, comptes connectés, réglages).
- **Accueil** :
  - salutation en 32 / 600 ;
  - une carte « à faire maintenant » en noir (la seule zone noire, comme « Megan · ce qui brûle »
    de la maquette) ;
  - puis ses chiffres du mois (une carte par ligne, chiffre en grand mono) ;
  - prochain tournage ;
  - dernière facture.
- **Cartes pleine largeur** (marges 16 px), rayon 24, espacement 12 entre cartes, texte 15 /
  métadonnées 13.
- **Collabs** : carte par collab avec la progression en 11 segments et un bouton pilule pleine
  largeur « Passer à : … ».
- **Actions** :
  - un bouton flottant noir « + » seulement là où il y a une création (envoyer des stats, une
    facture) ;
  - fenêtres en feuilles du bas ;
  - champs à 16 px (pas de zoom iOS).
- **Statuts** : mêmes pastels que l'agence. « Connecter mon Instagram / TikTok / YouTube » regroupés
  dans Profil, avec l'état en chip.
