# Validation Meta (App Review) : lire les DM Instagram de TTP

Pourquoi : sans « accès avancé » à `instagram_manage_messages`, Meta refuse de lister les
conversations du compte @ttpcreators (erreur code -2 « Timeout », sous-code 2534084 : trop de
conversations avec des comptes sans rôle sur l'app). Constaté le 2026-10-14.
L'accès avancé demande : **1) la vérification de l'entreprise**, **2) la validation de l'app**.

App Meta : « TTP Suite Scouting », ID `1085983370893343`, type Entreprise, portefeuille
« TTP Creators » (ex « The Insider's Private Society », ID `1226405722196594`), entreprise vérifiée,
**mode Live depuis le 2026-10-15**.

## Étapes, dans l'ordre

| # | Étape | Qui | État |
|---|-------|-----|------|
| 1 | Vérification de l'entreprise (Business Manager → Centre de sécurité → « Démarrer la vérification ») : documents officiels au nom de l'entreprise. Avant : renommer le portefeuille « The Insider's Private Society » en « TTP Creators » et corriger « Informations sur l'entreprise » (raison sociale actuelle « TIPS CONCIERGE », site instagram.com/tipsconcierge, pas de téléphone) avec les données de l'avis SIRENE / extrait RNE de l'EI de Marc ; code de confirmation par email sur partnerships@ttpcreators.pro | Marc + assistant | ✅ **Vérifiée** (Meta, première vérification le 14 oct. 2026 ; « Vérification pour BOURAOUI MARC MAHER : Vérifiée », vu le 15 oct.) |
| 2 | Pages publiques `ttpcreators.pro/confidentialite/` et `/conditions/` (site vitrine) | assistant | ✅ en ligne (2026-10-14) |
| 3 | Fiche de l'app (Paramètres de l'app → Général) : voir « Champs » ci-dessous | assistant + Marc | ✅ (2026-10-14) : domaines, confidentialité, conditions, suppression des données, catégorie « Entreprises et Pages », e-mail de contact partnerships@ttpcreators.pro ✅ enregistrés ; app rattachée au portefeuille « TTP Creators » ✅ ; ✅ icône (logo TTP) |
| 4 | Réception en direct : déployer `ig-webhook` + secrets + Webhooks Meta (voir plus bas) | Marc + assistant | ✅ (2026-10-14) : `ig-webhook` + `ig-inbox` déployées, secrets `META_APP_SECRET` et `IG_WEBHOOK_VERIFY` posés, produit Webhooks ajouté, objet Instagram → URL de rappel vérifiée, champ **messages** abonné (v26.0), envoi test Meta = succès (donc signature et clé secrète OK). ⚠️ Meta : en mode Développement, seuls les envois test du tableau de bord arrivent ; pour recevoir de vrais DM (même des comptes ayant un rôle) et filmer la démo, l'app doit passer en mode **Live** |
| 5 | Vidéo de démonstration (scénario ci-dessous) | Marc + assistant | ✅ (2026-10-15) : 58 s, fichier « Enregistrement de l'écran 2026-10-15 à 01.42.10.mov » sur le Bureau de Marc ; relue image par image, minutage repris dans « Notes for the reviewer » |
| 6 | Contrôle app → Autorisations et fonctionnalités → `instagram_manage_messages` → « Demander un accès Avancé » (+ les autorisations liées que Meta propose) | Marc + assistant | ✅ **Envoyée le 2026-10-15** (soumission `1087087250782955`), statut « Examen en cours », délai annoncé : 20 jours environ. Réponses données : voir « Formulaire envoyé » ci-dessous |

## Formulaire envoyé (2026-10-15), pour une prochaine demande

- **Usage autorisé** : `instagram_manage_messages` = texte anglais ci-dessous + vidéo + case « usage
  autorisé » cochée. Meta exige `instagram_basic` dans le même envoi (ajouté depuis Autorisations et
  fonctionnalités ; questions « intégration pour plusieurs clients professionnels ? » = Non,
  « au nom d'un client individuel ? » = Non).
- **Traitement des données** : sous-traitant = « Supabase, Inc. (database hosting and servers) »,
  catégorie hébergement / stockage, pays Royaume-Uni (base `eu-west-2`, Londres), États-Unis,
  Allemagne, Suisse (fonctions) ; responsable = « BOURAOUI MARC MAHER (entreprise individuelle),
  trading as TTP Creators », France ; données données à une autorité publique = Non ; politiques
  cochées : examen de légalité, minimisation, documentation des demandes.
- **Instructions pour l'examen** : plateforme « Site web » ajoutée à l'app (Paramètres → Général,
  URL `https://app.ttpcreators.pro/`) ; texte « Notes for the reviewer » ci-dessous ; pas
  d'identifiants (outil interne) ; « Facebook Login intégré ? » = Non (accès par l'utilisateur
  système « scoutingapi » du portefeuille) ; vidéo jointe aussi en document d'aide.

## Champs de la fiche de l'app (étape 3)

- Domaines de l'app : `ttpcreators.pro`, `app.ttpcreators.pro`
- URL de la Politique de confidentialité : `https://ttpcreators.pro/confidentialite/`
- URL des conditions de service : `https://ttpcreators.pro/conditions/`
- Suppression des données → « URL d'instructions » : `https://ttpcreators.pro/confidentialite/#suppression`
- Catégorie : « Entreprise et pages » (Business and Pages)
- Icône : `websitettpcreators/public/assets/favicon-512.png`
- Adresse e-mail de contact : `partnerships@ttpcreators.pro`

## Réception en direct (étape 4)

Sert à la démo (Meta envoie les messages des comptes qui ont un rôle sur l'app, même avant la
validation) puis, après validation, à recevoir les DM en temps réel.

1. `supabase functions deploy ig-webhook ig-inbox --project-ref zizvggziggswhrbuyhuo`
2. Secrets (Terminal, rien ne s'affiche) :
   - clé secrète de l'app Meta (Paramètres de l'app → Général → Clé secrète → Afficher) :
     `read -s S && supabase secrets set META_APP_SECRET="$S" --project-ref zizvggziggswhrbuyhuo && unset S`
   - jeton de vérification (généré, copié dans le presse-papier pour l'étape 3) :
     `T=$(openssl rand -hex 16) && supabase secrets set IG_WEBHOOK_VERIFY="$T" --project-ref zizvggziggswhrbuyhuo && printf %s "$T" | pbcopy && unset T`
3. Meta → app → Instagram → « Configuration de l'API avec la connexion Facebook » → Webhooks
   (ou Produits → Webhooks → objet « Instagram ») : URL de rappel
   `https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-webhook`, jeton de vérification =
   presse-papier, puis s'abonner au champ **messages**.
4. La Page s'abonne toute seule à l'app au prochain « Actualiser » de la page DM Instagram
   (`subscribed_apps`, état dans `ig_sync_state` clé `webhook`).

## Scénario de la vidéo (étape 5)

Compte de démonstration : un compte Instagram relié au compte Facebook d'une personne qui a un
rôle sur l'app (Marc, ou Gianni ajouté comme testeur de l'app).

✅ Essai réel réussi le 2026-10-15 : DM « Test 4 » envoyé depuis **@tipsconcierge** (relié au Facebook
de Marc) → reçu par `ig-webhook` → affiché dans DM Instagram. Prérequis corrigé : la Page installe
l'app avec le champ « name » (`ig_sync_state.webhook = {subscribed: true, fields: "name"}`) ; le champ
« messages » demandait l'autorisation Messenger `pages_messaging`.

1. Se connecter à `https://app.ttpcreators.pro` (compte agence).
2. Menu Relations → **DM Instagram** (montrer la page vide ou existante).
3. Depuis le compte de démonstration, envoyer à @ttpcreators : « Hello TTP, we'd love to work
   with your creators. Contact: demo-brand@example.com ».
4. Revenir sur la page DM Instagram → la conversation apparaît (ou « Actualiser »).
5. Chercher « creators » dans la barre de recherche → la conversation ressort.
6. Ouvrir la conversation → l'email est repéré → « Créer la fiche contact ».
7. Ouvrir **Contacts** → la fiche a l'email et, dans son suivi, la touche « Instagram ».
8. Répondre depuis l'app Instagram (bouton « Répondre sur Instagram ») : l'app n'envoie rien
   elle-même.

L'interface est en français : ajouter des sous-titres anglais courts, ou décrire chaque étape
dans le champ « notes » de la demande.

## Textes à coller (anglais)

**instagram_manage_messages — How will your app use this permission?**

> TTP Creators is a talent management agency. TTP Suite (app.ttpcreators.pro) is our internal
> web app, used only by our own team. We use instagram_manage_messages to read the direct
> messages of our own Instagram professional account (@ttpcreators), linked to our Facebook Page
> "TTP Creators". Brands and creators contact our agency by DM. TTP Suite lists these
> conversations so our team can search them, link each conversation to the matching business
> contact in our CRM (including the business email address a brand gives us in the
> conversation) and log each exchange in our prospecting follow-up. Messages are displayed to
> our agency team only. The app does not send automated messages: replies are written by our
> team in the Instagram app. We never sell or share this data. Messages are deleted at the
> latest 3 years after the last exchange, or on request (ttpcreators.pro/confidentialite).

**pages_manage_metadata — How will your app use this permission?**

> We use pages_manage_metadata only to install our app on our own Facebook Page "TTP Creators"
> (subscribed_apps), which is required to receive the Instagram "messages" webhook of our linked
> Instagram professional account @ttpcreators, so that new direct messages appear in TTP Suite
> in real time. We do not modify any other Page settings.

**instagram_basic — How will your app use this permission?**

> We use instagram_basic to read the profile of our own Instagram professional account
> (@ttpcreators: username, profile picture, follower count) and the username of the people who
> message it, to display conversations in TTP Suite.

**Notes for the reviewer**

> TTP Suite (https://app.ttpcreators.pro) is an internal business tool of our agency, not a
> public app: there is no public sign-up, accounts are created by us for our team members only,
> and the workspace holds confidential data about the creators we represent, so we cannot open
> an account to outside parties. The screencast shows the complete flow, end to end, with a
> real message sent to our account @ttpcreators by a test account (@tipsconcierge).
> There is no Facebook Login in TTP Suite: the app only accesses our own Facebook Page and
> Instagram account, through a system user of our business portfolio "TTP Creators".
> The interface is in French. Walkthrough of the screencast:
> 0:00 Our agency workspace, page "DM Instagram" (menu "Au quotidien"): conversations of
> @ttpcreators (French labels: "conversations", "avec fiche" = with a contact card,
> "emails trouvés" = emails found).
> 0:12 Our team clicks "Actualiser" (Refresh).
> 0:24 The new direct message "Hello TTP, we'd love to work with your creators. Contact:
> demo-brand@example.com" appears in the list (received via the Instagram messages webhook).
> 0:28 The conversation is opened: messages are displayed and the email address is detected.
> 0:32 "Créer la fiche contact" (Create contact card): the sender becomes a business contact in
> our CRM ("Fiche contact créée" = contact card created; the exchanges are logged on it).
> 0:40 "Répondre sur Instagram" (Reply on Instagram) opens the conversation in Instagram: our team
> writes the reply manually there. TTP Suite never sends messages.
> 0:48 Back in TTP Suite, "Pipeline" adds the contact to our prospecting follow-up
> ("Ajoutée au Pipeline" = added to the pipeline).

---

# « Connecter mon Instagram » (créatrices) : même validation Meta

Produit Meta « API Instagram avec connexion Instagram » (ID de l'app Instagram
`1794104085073381`, redirection `https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-callback`).
Code en place : `ig-connect`, `ig-callback`, `ig-sync` (couverture, vues, interactions 28 j,
audience âge / genre / villes / pays, vues et couverture moyennes des derniers reels, stats
des posts de collab ; reporté dans la fiche, le media kit et le calculateur de prix).

**En attendant la validation** : chaque créatrice peut se connecter si elle est ajoutée comme
**« Testeur(se) Instagram »** (Meta → app → Rôles dans l'application → Ajouter des personnes),
puis accepte l'invitation sur https://www.instagram.com/accounts/manage_access/ (onglet
« Invitations de testeur »). Elle clique ensuite « Connecter mon Instagram » dans son espace.

**Pour toutes les créatrices** : vérification de l'entreprise (étape 1 plus haut), puis App
Review de `instagram_business_basic` et `instagram_business_manage_insights` (accès avancé).
On peut l'envoyer dans la même demande que `instagram_manage_messages`.

## Scénario de la vidéo

1. Espace créatrice TTP (compte de démonstration de créatrice) → « Envoyer mes stats ».
2. « Connecter mon Instagram » → page d'accord Instagram (montrer les autorisations) → Autoriser.
3. Retour dans l'espace : « Instagram connecté ».
4. Côté agence : fiche de la créatrice → carte « Instagram du jour » → couverture, vues 28 j,
   vues par reel, audience ; puis Media kit (lignes Instagram et audience remplies).
5. Montrer « Déconnecter » (la créatrice garde la main).

## Textes à coller (anglais)

**instagram_business_basic**

> TTP Creators is a talent management agency. The creators we represent log in to their own
> space in TTP Suite (app.ttpcreators.pro) and click "Connect my Instagram". We use
> instagram_business_basic to identify the connected professional account (username, profile
> picture, follower count) and to list her recent media, so her stats and sponsored posts are
> attached to the right creator record. Read-only: we never post or modify anything.

**instagram_business_manage_insights**

> We use instagram_business_manage_insights to read the creator's own account and media
> insights (reach, views, interactions, saves, shares, aggregated audience demographics by age,
> gender, city and country). They fill her media kit and the campaign reports we send to brands
> she works with, replacing the screenshots creators used to send us by hand. Data is visible
> only to the creator and our agency team, never sold or shared with third parties. The creator
> can disconnect at any time from her space or from Instagram (Apps and websites).

## Diagnostic du 25 novembre 2026 : « Error validating verification code »

**Constat.** Aucune créatrice n'avait réussi à se connecter (`ig_accounts` vide). Le 25/11,
6 essais (Chloé ×4, Léna, et Marc depuis une fiche ; Chrome Mac, Safari Mac, Safari iPhone) :
Instagram renvoie bien un `code`, mais l'échange `api.instagram.com/oauth/access_token`
répond chaque fois « Error validating verification code. Please make sure your redirect_uri
is identical to the one you used in the OAuth dialog request ».

**Vérifié sans rien changer.**
- `IG_APP_ID` = `1794104085073381` (empreinte du secret) ; `IG_REDIRECT_URI` =
  `https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-callback`, la même valeur au départ
  et à l'échange (code identique en ligne et dans `main`).
- Réponses de Meta à des essais sans effet : faux `client_id` → « Invalid platform app » ;
  code inventé → « Invalid authorization code » ; code déjà essayé → « This authorization code
  has been used ». Donc ni l'ID de l'app, ni un code abîmé (`#_`), ni un code utilisé deux
  fois : le code est reconnu, c'est la vérification adresse de retour / app qui échoue. Et un
  code raté est perdu (il faut recommencer depuis le début).
- La page d'accord d'Instagram NE vérifie PAS l'adresse de retour avant la connexion (une
  adresse au hasard passe aussi) : « la page s'ouvre » ne prouve pas que l'adresse est
  enregistrée. La doc de Meta prévient que le tableau de bord peut ajouter un « / » final.
- `…/ig-callback` et `…/ig-callback/` arrivent tous les deux à la fonction.

**Causes, de la plus probable à la moins probable.**
1. L'adresse enregistrée dans « Paramètres de connexion professionnelle » n'est pas
   EXACTEMENT celle du secret (« / » final ajouté, adresse absente, ou enregistrée seulement
   dans « Facebook Login »).
2. `IG_APP_SECRET` n'est pas la clé secrète actuelle de l'app **Instagram** (clé
   réinitialisée depuis le 14/10, ou clé de l'app Facebook). Impossible à tester sans un
   vrai code : Meta vérifie le code avant la clé.
3. Comptes sans rôle sur l'app pendant que les deux autorisations sont en accès standard :
   n'explique pas l'échec de Marc, mais bloquera toutes les créatrices tant que l'App
   Review n'est pas passée.

**À faire dans Meta (Marc), dans l'ordre.**
1. developers.facebook.com › Mes apps › l'app de TTP › menu **Instagram** › **Configuration
   de l'API avec connexion Instagram**.
2. Étape « 3. Configurer la connexion professionnelle Instagram » › **Paramètres de connexion
   professionnelle** › **URI de redirection OAuth** : une ligne exactement
   `https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-callback` → Enregistrer. Rouvrir
   la page : si Meta a remis un « / » à la fin, garder sa version et poser la même dans le
   secret (`supabase secrets set IG_REDIRECT_URI=https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-callback/ --project-ref zizvggziggswhrbuyhuo`).
   L'« URL d'intégration » affichée à cette étape doit contenir la même adresse.
3. Même page, **ID de l'app Instagram** = `1794104085073381` ; **Clé secrète de l'app
   Instagram** › Afficher › la reposer : `read -s S; supabase secrets set IG_APP_SECRET="$S" --project-ref zizvggziggswhrbuyhuo; unset S`
   (pas la clé de Paramètres › De base, qui est celle de l'app Facebook).
4. **Rôles dans l'application** › Rôles › Ajouter des personnes › **Testeur Instagram** : le @
   de chaque créatrice qui essaie avant la validation (chloe.dyr, lenaa.psl…). Elle accepte
   dans Instagram › Paramètres › Sites web et apps › Invitations de testeur (ou
   instagram.com/accounts/manage_access).
5. **Mode de l'app** : En ligne (déjà le cas depuis le 15/10), ne pas repasser en développement.
6. **Examen de l'app** › Autorisations et fonctionnalités : `instagram_business_basic` et
   `instagram_business_manage_insights` › **Demander l'accès avancé** (vidéo : scénario plus
   haut). Sans elle, seuls les testeurs peuvent se connecter.
7. Essai avec un compte testeur : la fiche de la créatrice (vue agence) montre le résultat et
   le message brut de Meta (table `ig_connexions`), et un push arrive aux fondateurs.

---

# Envoi de l'examen, novembre 2026 (connexion Instagram des créatrices)

Demande : **accès avancé** à `instagram_business_basic` et `instagram_business_manage_insights`
pour l'app Instagram `1794104085073381` (« API Instagram avec connexion Instagram »). Tout ce
qu'il faut coller est ci-dessous, dans l'ordre où Meta le demande.

## 0. Avant d'ouvrir le formulaire (sinon l'examen sera refusé)

1. **Mettre en ligne les deux rappels** : fusionner la PR « Meta : rappels d'annulation et de
   suppression des données Instagram » (contrôle vert), puis « Déploiement des fonctions » avec
   `ig-deauth ig-data-deletion` (ou `supabase functions deploy ig-deauth ig-data-deletion --no-verify-jwt --project-ref zizvggziggswhrbuyhuo`).
   Vérifier : `https://app.ttpcreators.pro/instagram-donnees/?code=IG-ABCDEFGHJK` affiche
   « Tes données Instagram ont été supprimées » et le code.
2. **Une connexion réelle doit réussir** : tant que l'échange du code échoue (« Error
   validating verification code », voir « Diagnostic du 25 novembre 2026 » plus haut), la vidéo
   est impossible. Faire d'abord les étapes 1 à 4 de ce diagnostic, puis un essai avec un
   compte testeur.
3. **Montrer le bouton dans l'espace créatrice** : « Connecter mon Instagram » est caché tant
   que `FEATURES.connect.instagram` vaut `false` (`src/lib/features.ts`). Le passer à `true`
   dans une PR avant de filmer (les créatrices pas encore testeuses verront alors « Ton compte
   n'est pas encore autorisé par Meta », message déjà prévu). Les examinateurs de Meta doivent
   voir ce bouton.
4. **Compte de démonstration** (voir § 5) et **compte Instagram de test** : un compte
   Instagram **professionnel** (Créateur ou Entreprise) qui n'est pas celui d'une vraie
   créatrice, ajouté comme « Testeur Instagram » (Rôles dans l'application) et qui a accepté
   l'invitation.

## 1. Les deux adresses à coller (Paramètres de connexion professionnelle)

Meta › Mes apps › l'app de TTP › **Instagram** › **Configuration de l'API avec connexion
Instagram** › étape « 3. Configurer la connexion professionnelle Instagram » › **Paramètres de
connexion professionnelle** :

| Champ Meta | Adresse à coller |
|---|---|
| URL de rappel pour les annulations d'autorisation (Deauthorize callback URL) | `https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-deauth` |
| URL de la demande de suppression des données (Data deletion request URL) | `https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-data-deletion` |

Ne rien changer à « URI de redirection OAuth » (déjà réglé :
`https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-callback`). Enregistrer.

Ce que font ces adresses : Meta les appelle en POST avec un `signed_request` signé avec la
clé secrète de l'app Instagram (`IG_APP_SECRET`). Signature fausse → 400, rien n'est fait.
- `ig-deauth` : la créatrice a retiré TTP Creators dans Instagram (Paramètres › Sites web et
  apps) → jeton supprimé, « Instagram connecté » retiré de sa fiche, ligne « annulation » dans
  `ig_connexions`.
- `ig-data-deletion` : demande d'effacement → jeton, lien et statistiques privées effacés
  (couverture, vues, interactions, audience, chiffres privés des posts et des posts de collabs,
  mesures d'engagement automatiques) ; la fiche et les chiffres publics restent. Répond à Meta
  `{ "url": "https://app.ttpcreators.pro/instagram-donnees/?code=IG-…", "confirmation_code": "IG-…" }`
  et note la demande (avec le code) dans `ig_connexions`.

## 2. Fiche de l'app (Paramètres de l'app › Général) : déjà en place, à vérifier

- Politique de confidentialité : `https://ttpcreators.pro/confidentialite/`
- Conditions de service : `https://ttpcreators.pro/conditions/`
- Suppression des données, « URL d'instructions » : `https://ttpcreators.pro/confidentialite/#suppression`
  (si Meta propose plutôt « URL de rappel de suppression des données », mettre l'adresse
  `ig-data-deletion` du § 1).
- Domaines : `ttpcreators.pro`, `app.ttpcreators.pro` ; e-mail : `partnerships@ttpcreators.pro`.

## 3. « Comment votre app utilise cette autorisation » (à coller en anglais)

**instagram_business_basic**

> TTP Creators is a talent management agency based in France. TTP Suite
> (https://app.ttpcreators.pro) is the web app we give to the content creators we represent:
> each creator has a private space, created by our agency. In that space, the creator can click
> "Connect my Instagram" and log in with her own Instagram professional account. We use
> instagram_business_basic only to identify the account she connected (account ID, username,
> account type, profile picture and follower count) and to list her own recent media (ID,
> permalink, date, type, like and comment counts), so that her statistics and her sponsored
> posts are attached to the right creator record in our app. This is read-only: the app never
> publishes, comments, sends messages or changes anything on her account. The data is visible
> only to the creator herself and to our agency team. She can disconnect at any time from her
> space or from Instagram (Settings > Apps and websites); her access token is then deleted.

Traduction pour Marc : TTP Creators est une agence de talents en France. TTP Suite est l'app
que nous donnons aux créatrices que nous représentons : chacune a un espace privé, créé par
l'agence. Elle y clique « Connecter mon Instagram » et se connecte avec son propre compte pro.
Nous utilisons instagram_business_basic seulement pour reconnaître le compte connecté (id, @,
type de compte, photo, abonnés) et lister ses publications récentes (id, lien, date, type,
likes, commentaires), afin de rattacher ses statistiques et ses posts sponsorisés à la bonne
fiche. Lecture seule : l'app ne publie rien, ne commente pas, n'envoie pas de message et ne
modifie rien. Seules la créatrice et l'équipe de l'agence voient ces données. Elle peut se
déconnecter à tout moment ; son jeton est alors supprimé.

**instagram_business_manage_insights**

> We use instagram_business_manage_insights to read the insights of the creator's own
> account and of her own media: reach, views, interactions, saves and shares over the last
> 28 days and per post, and the aggregated audience breakdown (age, gender, top cities and
> countries, as percentages only, with no data about individual followers). These figures are
> shown to the creator in her space ("My stats") and to our agency team on her creator record.
> They fill in her media kit and the campaign reports we send to the brands she works with,
> replacing the screenshots creators used to send us by hand every month. We never sell this
> data or share it with third parties other than the brand reports the creator works on. When
> she disconnects, removes the app in Instagram, or requests data deletion, the access token
> and the private insights are deleted (deauthorize and data deletion callbacks are
> implemented).

Traduction pour Marc : nous utilisons instagram_business_manage_insights pour lire les
statistiques de son propre compte et de ses propres publications : couverture, vues,
interactions, enregistrements et partages sur 28 jours et par post, et la répartition de son
audience (âge, genre, villes et pays principaux, en pourcentages seulement, aucune donnée sur
un abonné en particulier). Elles s'affichent pour elle dans son espace (« Mes stats ») et pour
l'agence sur sa fiche. Elles remplissent son media kit et les bilans de campagne envoyés aux
marques avec qui elle travaille, à la place des captures d'écran qu'elle envoyait chaque mois.
Nous ne vendons pas ces données et ne les partageons avec personne d'autre que les marques des
campagnes concernées. Si elle se déconnecte, retire l'app dans Instagram ou demande la
suppression, le jeton et les statistiques privées sont effacés (rappels d'annulation et de
suppression en place).

Pour chaque autorisation : cocher la case de l'usage autorisé, joindre la vidéo (§ 4), et aux
questions « intégration pour plusieurs clients professionnels ? » / « au nom d'un client
individuel ? » répondre comme pour la demande d'octobre (Non / Non), sauf si Meta les pose
autrement pour l'API avec connexion Instagram (alors : les comptes connectés sont ceux des
créatrices, qui les relient elles-mêmes).

## 4. Vidéo d'écran (1 à 2 minutes)

Préparer : espace du compte de démonstration en **anglais** (Profil › Langue de l'espace ›
English), compte Instagram de test déconnecté au départ, navigateur sans autre onglet, aucune
vraie créatrice à l'écran (la fiche agence montrée est celle de la créatrice de démonstration).
La fiche agence est en français : ajouter des sous-titres anglais courts, ou s'appuyer sur les
« Notes for the reviewer » ci-dessous.

| Temps | À l'écran | Sous-titre (anglais) |
|---|---|---|
| 0:00 | `https://app.ttpcreators.pro`, connexion avec le compte de démonstration de créatrice | "A creator represented by our agency logs in to her TTP Suite space." |
| 0:10 | Espace créatrice › « Send my stats » (ou « My stats ») : carte « Even simpler: connect your Instagram » | "She chooses to connect her Instagram professional account." |
| 0:18 | Clic sur **Connect my Instagram** | |
| 0:20 | Page de connexion Instagram (se connecter au compte de test si besoin) | "Instagram login with her own account." |
| 0:30 | Page d'accord : montrer les deux autorisations demandées, puis **Allow / Autoriser** | "She grants instagram_business_basic and instagram_business_manage_insights." |
| 0:40 | Retour dans l'espace : « Instagram connected ✓ Your stats now come in automatically » | "Back in TTP Suite, the account is connected." |
| 0:50 | « My stats » : posts récents avec vues, portée (« reach »), enregistrements, partages | "Her own insights: views, reach, saves, shares per post." |
| 1:05 | Se déconnecter, se connecter avec le compte agence › Roster › fiche de la créatrice de démonstration › carte « Instagram du jour » : connectée (@ du compte de test), couverture 28 j, vues 28 j, vues des reels, audience âge / genre / villes / pays | "Our agency team sees the connection status and the insights on her creator record." |
| 1:25 | Media kit de la créatrice : lignes Instagram et audience remplies | "They fill in her media kit for brands." |
| 1:35 | Retour dans l'espace créatrice › **Déconnecter / Disconnect** | "She can disconnect at any time: the token is deleted." |
| 1:45 | Fin | |

Si l'audience est vide (compte de test avec trop peu d'abonnés : Meta ne donne l'audience qu'à
partir de 100 abonnés), le dire dans les notes plutôt que de couper.

## 5. Identifiants de test (« instructions pour l'examen »)

Meta demande de pouvoir se connecter à l'app. Ce que Marc crée lui-même (aucun mot de passe
n'est écrit ici ni dans Git) :

1. **Une fiche créatrice fictive** dans le Roster, par exemple « Demo Meta Review » (aucune
   vraie personne, aucune vraie marque), statut actif.
2. **Un compte créateur** relié à cette fiche : page **Accès** › nouveau compte, rôle
   « créateur », fiche « Demo Meta Review », avec une adresse de l'agence réservée à ça (par
   exemple un alias de `partnerships@ttpcreators.pro`). Le mot de passe est choisi par Marc et
   montré une seule fois par l'app : le copier directement dans le formulaire de Meta. Le
   changer (« Nouveau mot de passe ») après la décision de Meta.
3. Passer l'espace de ce compte en anglais (§ 4).
4. Dans le formulaire : URL `https://app.ttpcreators.pro`, l'adresse et le mot de passe de ce
   compte, et le texte ci-dessous. Ce compte ne voit que la fiche fictive : aucune donnée de
   créatrice réelle n'est exposée.
5. Pour l'étape Instagram, les examinateurs utilisent leur propre compte professionnel de
   test. Si Meta demande aussi un compte Instagram, donner le compte de test du § 0.4 (jamais
   celui d'une créatrice).

**Notes for the reviewer** (à adapter avec les temps réels de la vidéo) :

> TTP Suite (https://app.ttpcreators.pro) is the private web app of TTP Creators, a talent
> management agency. Creators we represent get a personal space created by our agency (there is
> no public sign-up). Test login (creator space, demo data only): see the credentials above.
> Steps: 1) log in; the space can be switched to English in Profile > Space language.
> 2) Open "Send my stats" and click "Connect my Instagram". 3) Log in with an Instagram
> professional (Creator or Business) account and allow the requested permissions. 4) You are
> redirected back to TTP Suite: "Instagram connected". Insights appear in "My stats" after
> the first sync (a few seconds; refresh the page). 5) "Disconnect" deletes the access token.
> The agency view of the creator record (shown in the screencast, in French) displays the
> connection status, reach and views over 28 days, and the aggregated audience.
> The app is read-only: it never publishes or sends anything on the creator's account.
> Deauthorize callback: https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-deauth.
> Data deletion callback: https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-data-deletion
> (returns a status URL and confirmation code).

## 6. Les menus Meta, dans l'ordre

1. developers.facebook.com › **Mes apps** › l'app de TTP.
2. **Instagram** › Configuration de l'API avec connexion Instagram › Paramètres de connexion
   professionnelle : les deux adresses du § 1 › Enregistrer.
3. **Paramètres de l'app › Général** : vérifier le § 2.
4. **Examen de l'app** › **Autorisations et fonctionnalités** › `instagram_business_basic` ›
   **Demander l'accès avancé** ; idem pour `instagram_business_manage_insights`.
5. **Examen de l'app** › **Demandes** (la demande en cours) : pour chaque autorisation, le
   texte du § 3 et la vidéo du § 4 ; « Traitement des données » : mêmes réponses qu'en octobre
   (voir « Formulaire envoyé » plus haut) ; « Instructions pour l'examen » : § 5 › **Envoyer**.
6. Après l'accord : `FEATURES.connect.instagram` reste à `true`, et les créatrices n'ont plus
   besoin d'être testeuses.
