# Validation Google : « Connecter mon YouTube » pour toutes les créatrices

> ⏸️ En pause (Marc, 2026-10-14). Reprendre à : déploiement des fonctions, essai réel, puis étape 4.

Pourquoi : l'app Google « TTP Suite » (ex « TTP Creators ») est **en test**. Seules les adresses de la liste
« Utilisateurs tests » peuvent se connecter (100 au maximum), et l'accès saute tous les
7 jours. Pour ouvrir « Connecter mon YouTube » à toutes les créatrices, sans liste et sans
coupure, il faut **publier l'app** puis la faire **valider par Google**.

Projet Google Cloud : **`ttp-creators`** (organisation ttpcreators.pro), compte propriétaire
partnerships@ttpcreators.pro. Client Web « TTP Suite YouTube », retour
`https://app.ttpcreators.pro/yt-callback/`.

Ce que Google vérifie :
- **la marque** : nom de l'app, page d'accueil, domaine à nous (2 à 3 jours ouvrés) ;
- **les accès sensibles** : `youtube.readonly` est « sensible » ; `yt-analytics.readonly`
  est classée « non sensible » par Google. Il faut une justification et une vidéo
  (quelques jours à quelques semaines).

Pas d'audit de sécurité payant : il n'est exigé que pour les accès « restreints » (Gmail,
Drive…), et nous n'en demandons aucun.

## Étapes, dans l'ordre

| # | Étape | Qui | État |
|---|-------|-----|------|
| 1 | Code conforme aux règles YouTube : effacement de TOUTES les données de la chaîne à la déconnexion ou quand l'accès est retiré chez Google (`ytForget`) ; vidéos du radar non relues depuis 30 jours effacées (`yt-radar`) ; cache des chaînes purgé à 30 jours (`yt-sourcing`). Déployer : `supabase functions deploy yt-connect yt-sync yt-radar yt-sourcing --project-ref zizvggziggswhrbuyhuo` | assistant (code) + Marc (déploiement) | ✅ code (2026-10-14), ⏳ déploiement |
| 2 | Pages publiques sur ttpcreators.pro : **`/suite/`** (page d'accueil de l'app, FR + EN), `/confidentialite/` (connexions des comptes, effacement, usage limité Google), `/conditions/` (phrase « vous acceptez les conditions de YouTube ») | assistant | ✅ en ligne (2026-10-14) |
| 3 | Google Auth Platform → Branding : **nom de l'app « TTP Suite »** (même nom que la page d'accueil, sinon Google refuse pour « nom différent ») ; page d'accueil **`https://ttpcreators.pro/suite/`** | assistant, avec l'accord de Marc | ✅ fait (2026-10-14) |
| 4 | **Propriété du domaine** : Google Search Console (search.google.com/search-console), connecté avec **partnerships@ttpcreators.pro** → Ajouter une propriété → **Domaine** → `ttpcreators.pro`. Un enregistrement `google-site-verification` existe déjà chez OVH : s'il appartient à ce compte, c'est validé tout de suite. Sinon, Google donne un nouvel enregistrement TXT : OVH → Web Cloud → Noms de domaine → ttpcreators.pro → Zone DNS → Ajouter une entrée → TXT (sous-domaine vide), coller la valeur, puis « Valider » dans Search Console (quelques minutes à quelques heures) | Marc | ⏳ |
| 5 | Compte de démonstration pour Google (il peut le demander) : un accès créatrice « ZZZ Démo Google » créé depuis l'app (Réglages → Accès → Comptes app) ; identifiants transmis à Google seulement s'il les demande, par le formulaire de validation | Marc | ⏳ si demandé |
| 6 | **Vidéo de démonstration** (scénario ci-dessous), mise sur YouTube en « Non répertoriée » | Marc + assistant | ⏳ |
| 7 | Google Auth Platform → Audience → **« Publier l'application »** → Confirmer. Effet immédiat : plus de coupure à 7 jours et plus de liste de testeurs ; tant que la validation n'est pas finie, la page Google affiche « Google n'a pas validé cette application » (la créatrice clique « Paramètres avancés » → « Accéder à TTP Suite »), 100 personnes maximum | Marc | ⏳ |
| 8 | Google Auth Platform → **Centre de validation** → « Préparer la validation » : coller les textes ci-dessous et le lien de la vidéo, puis envoyer | Marc (assistant à côté) | ⏳ |
| 9 | Répondre aux e-mails de Google (expéditeur « Google Trust and Safety » ou « API OAuth Dev Verification », sur partnerships@ttpcreators.pro) : ils demandent souvent une précision ou une nouvelle vidéo. Me transférer le message, je prépare la réponse | Marc + assistant | ⏳ |

⚠️ Ne plus changer les autorisations (portées) ni l'adresse de retour pendant la validation :
cela relance l'examen depuis le début.

## Réglages Google Auth Platform (référence)

- Nom de l'app : **TTP Suite** (étape 3) ; e-mail d'assistance : partnerships@ttpcreators.pro
- Page d'accueil : `https://ttpcreators.pro/suite/`
- Règles de confidentialité : `https://ttpcreators.pro/confidentialite/`
- Conditions d'utilisation : `https://ttpcreators.pro/conditions/`
- Domaine autorisé : `ttpcreators.pro`
- Coordonnées du développeur : partnerships@ttpcreators.pro
- Audience : Externe
- Accès aux données : `https://www.googleapis.com/auth/youtube.readonly` (sensible),
  `https://www.googleapis.com/auth/yt-analytics.readonly` (non sensible)
- Client Web « TTP Suite YouTube » : URI de redirection `https://app.ttpcreators.pro/yt-callback/`
- Pas de logo : un logo déclenche une vérification de marque en plus, sans rien apporter ici.

## Textes à coller dans le formulaire (anglais)

**App purpose / description**

> TTP Suite is the internal, invitation-only web app of TTP Creators, a sport and lifestyle
> talent management agency. The creators represented by the agency can optionally connect
> their own YouTube channel, read-only. We use their channel statistics to keep their media
> kit up to date, set fair rates for brand partnerships based on their real average views,
> find the videos they published for a partnership managed by the agency, and prepare the
> campaign reports sent to brands. The data is only visible to the agency team and to the
> creator, is never sold, shared or used for advertising, and is deleted when the creator
> disconnects or removes access from their Google Account.

**Why do you need `youtube.readonly`?**

> We call `channels.list` with `mine=true` to identify the creator's own channel (title,
> subscriber count, uploads playlist), then `playlistItems.list` on that uploads playlist and
> `videos.list` (snippet, statistics, contentDetails, paidProductPlacementDetails) to read the
> view, like and comment counts of their recent videos. These figures are shown on the
> creator's profile in TTP Suite, used to compute their average views per video and per
> Short for pricing, and used to detect the videos they published for a brand partnership
> managed by the agency (the brand is mentioned in the title or description). The app never
> uploads, edits, comments on or deletes anything.

**Why is a narrower scope not enough?**

> `youtube.readonly` is the narrowest scope that lets an app read the authenticated user's
> own channel (`channels.list?mine=true`) and its uploads. The other YouTube Data API scopes
> (`youtube`, `youtube.force-ssl`, `youtube.upload`) all grant write access, which we do not
> need. Public data via an API key cannot identify which channel belongs to the signed-in
> creator.

**`yt-analytics.readonly`** (non sensitive, only if asked)

> Used with the YouTube Analytics API (`reports.query`, `ids=channel==MINE`) to read the
> creator's own aggregated channel analytics: views, estimated minutes watched, average view
> duration, subscribers gained and lost over the last 30 days, and the aggregated audience
> breakdown by age group, gender and country (percentages only, no individual viewer data).
> These figures fill the creator's media kit and campaign reports.

**Data handling** (if asked)

> Tokens are stored server-side only (Supabase, not readable by any client). Analytics are
> refreshed once a day and only stored for connected creators. When a creator clicks
> “Disconnect”, we revoke the token with Google and delete all data obtained from their
> channel. If access is removed from the Google Account, the next daily sync detects it and
> deletes the data the same way. Use of data received from Google APIs complies with the
> Google API Services User Data Policy, including the Limited Use requirements.

## Scénario de la vidéo (étape 6)

2 à 4 minutes, enregistrées à l'écran (QuickTime → Fichier → Nouvel enregistrement de
l'écran), puis mises sur YouTube en **Non répertoriée**. L'app est en français : ajouter une
courte légende en anglais à chaque étape (montage, ou texte dit à voix haute en anglais).
Compte utilisé : un compte Google de la liste des testeurs, avec une petite chaîne YouTube.

1. Ouvrir `https://ttpcreators.pro/suite/` : montrer la page, puis le lien « Privacy policy ».
   *Caption : “TTP Suite homepage and privacy policy.”*
2. Se connecter à `https://app.ttpcreators.pro` avec un compte créatrice (ou « ZZZ Démo
   Google »), ouvrir « Envoyer mes stats », cliquer **« Connecter mon YouTube »**.
   *Caption : “A creator chooses to connect her YouTube channel.”*
3. Page Google : **passer la page en anglais** (menu de langue en bas à gauche → English
   (United States)), choisir le compte, puis la chaîne.
4. Écran d'accord : **cliquer dans la barre d'adresse** pour montrer l'adresse complète avec
   `client_id=1484…` (Google l'exige), montrer le nom de l'app et les deux autorisations,
   cocher, « Continue ». *Caption : “OAuth consent screen, client ID visible in the URL.”*
5. Retour dans l'app : message « YouTube connecté ✓ ».
6. Côté agence : fiche de la créatrice → carte **« YouTube du jour »** : abonnés, vues
   moyennes des vidéos et des Shorts, vignettes des vidéos.
   *Caption : “youtube.readonly: channel and recent videos statistics.”*
   Puis les chiffres YouTube Studio (vues 30 j, heures regardées, abonnés gagnés) et
   l'audience. *Caption : “yt-analytics.readonly: aggregated 30-day analytics and audience.”*
7. Media kit de la créatrice → ligne YouTube remplie (vues 30 j, vues moyennes, heures).
   *Caption : “Used to keep the creator's media kit up to date.”*
8. Calculateur de prix : choisir la créatrice, plateforme YouTube, format « Intégration » → vues réelles
   reprises. *Caption : “Used to set rates based on real views.”*
9. (Si une collab existe) Collabs → « Publications repérées » : la vidéo YouTube de la collab.
10. Retour dans l'espace créatrice → **« Déconnecter »** → message « données effacées » ;
    côté agence, la carte est vide. *Caption : “Disconnect revokes access and deletes all
    YouTube data.”*

## Après la validation

- Retirer les adresses de test devenues inutiles (Audience).
- Mettre à jour le tableau d'état du runbook (`supabase/sql/README.md`, ligne « Connecter mon
  YouTube »).
- Quotas : le projet `ttp-creators` a 10 000 unités par jour pour la YouTube Data API ;
  `yt-sync` en utilise environ 3 par créatrice et par jour. YouTube Analytics a son propre
  quota, largement suffisant.
