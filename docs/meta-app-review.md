# Validation Meta (App Review) : DM Instagram et Instagram des créateurs

Deux demandes à Meta, sur la même app :

1. **DM du compte de l'agence** (`instagram_manage_messages`) : envoyée le 2026-10-15,
   **accès avancé validé le 2026-10-28**. Voir la partie 1.
2. **Instagram des créateurs** (« Connecter mon Instagram ») : connexion unifiée de Meta
   depuis le 2026-11-25 (#248), **examen pas encore envoyé**. Voir la partie 2 et « Envoi de
   l'examen, novembre 2026 ».

App Meta : « TTP Suite Scouting », ID `1085983370893343`, type Entreprise, portefeuille
« TTP Creators » (ex « The Insider's Private Society », ID `1226405722196594`), entreprise vérifiée,
**mode Live depuis le 2026-10-15**.

## Où on en est (2026-11-27)

| Sujet | État |
|---|---|
| DM de l'agence (`instagram_manage_messages`) | ✅ Accès avancé validé le 28/10. Depuis, l'équipe répond aussi aux DM depuis l'app (`ig-send`). |
| Connexion unifiée des créateurs (#248) | ✅ Secret `IG_CONFIG_ID` posé par Marc (sa valeur ne s'écrit nulle part), fonctions déployées le 25/11. ✅ Deux comptes reliés le 26/11 (un par le lien WhatsApp, un depuis l'espace créateur), tous deux avec un jeton de la connexion unifiée. |
| Autorisations de la configuration | `instagram_basic` ✅ · `instagram_manage_insights` ⏳ à ajouter · `public_profile` : accès avancé déjà demandé. |
| Statistiques privées des deux comptes reliés | ⏳ Meta refuse encore leur lecture (`creators.ig.insightsWhy` = « insights » au 27/11). C'est cohérent avec `instagram_manage_insights` absent de la configuration : à revérifier après l'ajout. |
| Rappels `ig-deauth` et `ig-data-deletion` | ⏳ Version actuelle déployée le 25/11 (clé `IG_APP_SECRET`, recherche par `ig_user_id`) : à adapter à l'app Meta (`META_APP_SECRET`), à redéployer après un oui et à essayer, avant de les coller dans Meta (partie 2, « Ce qu'il reste à faire », étape 2). |
| Vidéo, textes anglais, envoi de l'examen | ⏳ À faire : voir « Envoi de l'examen, novembre 2026 ». |

---

# Partie 1. DM Instagram de l'agence (octobre 2026, validé)

Pourquoi : sans « accès avancé » à `instagram_manage_messages`, Meta refuse de lister les
conversations du compte @ttpcreators (erreur code -2 « Timeout », sous-code 2534084 : trop de
conversations avec des comptes sans rôle sur l'app). Constaté le 2026-10-14.
L'accès avancé demande : **1) la vérification de l'entreprise**, **2) la validation de l'app**.

## Étapes, dans l'ordre

| # | Étape | Qui | État |
|---|-------|-----|------|
| 1 | Vérification de l'entreprise (Business Manager → Centre de sécurité → « Démarrer la vérification ») : documents officiels au nom de l'entreprise. Avant : renommer le portefeuille « The Insider's Private Society » en « TTP Creators » et corriger « Informations sur l'entreprise » (raison sociale actuelle « TIPS CONCIERGE », son ancien compte Instagram en guise de site, pas de téléphone) avec les données de l'avis SIRENE / extrait RNE de l'EI de Marc ; code de confirmation par email sur partnerships@ttpcreators.pro | Marc + assistant | ✅ **Vérifiée** (Meta, première vérification le 14 oct. 2026 ; « Vérification pour BOURAOUI MARC MAHER : Vérifiée », vu le 15 oct.) |
| 2 | Pages publiques `ttpcreators.pro/confidentialite/` et `/conditions/` (site vitrine) | assistant | ✅ en ligne (2026-10-14) |
| 3 | Fiche de l'app (Paramètres de l'app → Général) : voir « Champs » ci-dessous | assistant + Marc | ✅ (2026-10-14) : domaines, confidentialité, conditions, suppression des données, catégorie « Entreprises et Pages », e-mail de contact partnerships@ttpcreators.pro ✅ enregistrés ; app rattachée au portefeuille « TTP Creators » ✅ ; ✅ icône (logo TTP) |
| 4 | Réception en direct : déployer `ig-webhook` + secrets + Webhooks Meta (voir plus bas) | Marc + assistant | ✅ (2026-10-14) : `ig-webhook` + `ig-inbox` déployées, secrets `META_APP_SECRET` et `IG_WEBHOOK_VERIFY` posés, produit Webhooks ajouté, objet Instagram → URL de rappel vérifiée, champ **messages** abonné (v26.0), envoi test Meta = succès (donc signature et clé secrète OK). ⚠️ Meta : en mode Développement, seuls les envois test du tableau de bord arrivent ; pour recevoir de vrais DM (même des comptes ayant un rôle) et filmer la démo, l'app doit passer en mode **Live** |
| 5 | Vidéo de démonstration (scénario ci-dessous) | Marc + assistant | ✅ (2026-10-15) : 58 s, fichier « Enregistrement de l'écran 2026-10-15 à 01.42.10.mov » sur le Bureau de Marc ; relue image par image, minutage repris dans « Notes for the reviewer » |
| 6 | Contrôle app → Autorisations et fonctionnalités → `instagram_manage_messages` → « Demander un accès Avancé » (+ les autorisations liées que Meta propose) | Marc + assistant | ✅ **Envoyée le 2026-10-15** (soumission `1087087250782955`) ; ✅ **accès avancé validé le 2026-10-28**. Réponses données : voir « Formulaire envoyé » ci-dessous |

## Formulaire envoyé (2026-10-15) : relevé

**Note du 2026-11-27.** Cette partie est le relevé de l'envoi d'octobre, gardé tel quel.
Ce qui n'est plus vrai depuis :

- « Facebook Login intégré ? » = Non, et « There is no Facebook Login in TTP Suite » (Notes for
  the reviewer) : depuis le 25/11, la connexion Instagram des créateurs passe par Facebook Login
  for Business (partie 2).
- « replies are written by our team in the Instagram app », « TTP Suite never sends messages » et
  l'étape 8 du scénario : depuis le 28/10, l'équipe répond aussi depuis l'app (`ig-send`, dans les
  24 h permises par Meta), et les fondateurs ont l'outil `envoyer_dm` du connecteur Claude.
- L'étape 6 n'est plus « Examen en cours » : elle a été validée le 28/10.

Pour une nouvelle demande, reprendre ces textes en corrigeant ces points.

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

✅ Essai réel réussi le 2026-10-15 : DM « Test 4 » envoyé depuis un compte de test (relié au Facebook
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
   elle-même (vrai en octobre, plus depuis le 28/10 : voir la note plus haut).

L'interface est en français : ajouter des sous-titres anglais courts, ou décrire chaque étape
dans le champ « notes » de la demande.

## Textes envoyés (anglais)

**instagram_manage_messages : How will your app use this permission?**

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

**pages_manage_metadata : How will your app use this permission?**

> We use pages_manage_metadata only to install our app on our own Facebook Page "TTP Creators"
> (subscribed_apps), which is required to receive the Instagram "messages" webhook of our linked
> Instagram professional account @ttpcreators, so that new direct messages appear in TTP Suite
> in real time. We do not modify any other Page settings.

**instagram_basic : How will your app use this permission?**

> We use instagram_basic to read the profile of our own Instagram professional account
> (@ttpcreators: username, profile picture, follower count) and the username of the people who
> message it, to display conversations in TTP Suite.

**Notes for the reviewer**

> TTP Suite (https://app.ttpcreators.pro) is an internal business tool of our agency, not a
> public app: there is no public sign-up, accounts are created by us for our team members only,
> and the workspace holds confidential data about the creators we represent, so we cannot open
> an account to outside parties. The screencast shows the complete flow, end to end, with a
> real message sent to our account @ttpcreators by a test account.
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

# Partie 2. « Connecter mon Instagram » (créateurs) : connexion unifiée

Ce que ça donne : couverture, vues, interactions 28 j, audience (âge, genre, villes, pays), vues
et couverture moyennes des derniers reels, stats des posts de collab ; reporté dans la fiche, le
media kit et le calculateur de prix. Code : `ig-connect`, `ig-callback`, `ig-sync`, et les règles
de connexion dans `supabase/functions/_shared/instagram-login.ts`.

## Comment ça marche depuis le 25/11 (#248)

- **Produit Meta** : Facebook Login for Business, sur l'app « TTP Suite Scouting »
  (`1085983370893343`). Plus d'app Instagram ni d'autorisations `instagram_business_*` :
  l'ancienne connexion Instagram (app Instagram `1794104085073381`) est abandonnée (voir le
  diagnostic plus bas). Ne plus la régler dans Meta.
- **Configuration** : une configuration Facebook Login for Business. Son ID est dans le secret
  Supabase `IG_CONFIG_ID`. Sa valeur ne s'écrit nulle part : ni dans Git, ni dans une doc, ni
  dans un message. Pour la reposer (Terminal, rien ne s'affiche) :
  `read -s S && supabase secrets set IG_CONFIG_ID="$S" --project-ref zizvggziggswhrbuyhuo && unset S`
- **Autorisations** de la configuration : `instagram_basic` et `instagram_manage_insights` (la
  seconde reste à ajouter). `public_profile` vient avec Facebook Login : son accès avancé est
  déjà demandé.
- **Parcours** : le créateur clique « Connecter mon Instagram » dans son espace, ou ouvre le lien
  WhatsApp préparé par l'agence. La page de Meta propose « Instagram » ou « Facebook » : il
  choisit **Instagram**, se connecte, partage son compte professionnel avec l'app et accepte.
  `ig-callback` échange le code sur `graph.facebook.com` avec l'ID et la clé de l'app Meta
  (`META_APP_ID`, `META_APP_SECRET`), lit le compte partagé (`/me/assigned_instagram_accounts`)
  et range le jeton dans `ig_accounts`.
- **Jeton** : un jeton Meta « EAA… ». Sa durée vient de la configuration (« Jamais » conseillé) :
  `ig-sync` ne le prolonge pas.
- **Secours** : sans `IG_CONFIG_ID` ou sans `META_APP_SECRET`, le code repasse à l'ancienne
  connexion (secrets `IG_APP_ID` et `IG_APP_SECRET`). Elle n'a jamais marché sur cette app.
- **Avant l'accord de Meta** : seuls les comptes qui ont un rôle sur l'app (ou sont testeurs
  Instagram) peuvent se connecter. Chaque essai est noté dans `ig_connexions` (visible sur la
  fiche du créateur, côté agence) et un push part aux fondateurs.

## Ce qu'il reste à faire, dans l'ordre

1. **Ajouter `instagram_manage_insights` à la configuration** (Marc) : Meta › Mes apps ›
   « TTP Suite Scouting » › Facebook Login for Business › Configurations › la configuration de
   TTP › autorisations › Enregistrer. Si Meta ne permet pas de la modifier : en créer une
   nouvelle avec les mêmes réglages et cette autorisation, puis reposer `IG_CONFIG_ID` (commande
   plus haut). Ensuite, reconnecter un compte de test et vérifier que ses statistiques arrivent
   (carte « Instagram du jour » de sa fiche). Une autorisation ajoutée demande un nouvel accord :
   les deux comptes déjà reliés devront sans doute se reconnecter (lien WhatsApp).
2. **Adapter les rappels `ig-deauth` et `ig-data-deletion`** (une PR, puis « Déploiement des
   fonctions » après un oui). Aujourd'hui, ils vérifient la signature avec la clé de l'app
   Instagram (`IG_APP_SECRET`) et cherchent le compte par `ig_accounts.ig_user_id`. Avec la
   connexion unifiée, c'est l'app Meta qui appellera : signature avec `META_APP_SECRET`, et un
   identifiant donné par l'app Meta, pas l'id du compte Instagram. La version actuelle est en
   ligne depuis le 25/11 (tableau d'état) : redéployer la version adaptée, puis mettre la ligne
   du tableau à jour. Ensuite, essayer les deux adresses, puis les coller dans Facebook Login
   for Business (§ 1 de l'envoi). Avant cet essai, ne pas écrire dans l'examen que ces rappels
   marchent.
3. **Montrer le bouton** : passer `FEATURES.connect.instagram` à `true` (`src/lib/features.ts`)
   dans une PR, avant de filmer.
4. **Vidéo** (§ 4 de l'envoi) et **textes anglais** (§ 3), puis **envoi** (§ 6).

## Diagnostic du 25 novembre 2026 : ancienne voie, abandonnée (#248)

**Ancienne voie abandonnée.** Ce diagnostic porte sur l'ancienne connexion Instagram (« Business
Login », app Instagram `1794104085073381`). Elle n'a jamais marché sur cette app. Meta : « You
can only add one setup per app », et l'app a déjà la configuration « connexion Facebook »
(webhooks et DM). #248 est passé à la connexion unifiée : deux comptes reliés le 26/11. Les
étapes ci-dessous ne sont plus à faire. Elles restent ici comme relevé.

**Constat.** Aucun créateur n'avait réussi à se connecter (`ig_accounts` vide). Le 25/11,
6 essais (deux créateurs, dont l'un quatre fois, et Marc depuis une fiche ; Chrome Mac, Safari
Mac, Safari iPhone) : Instagram renvoie bien un `code`, mais l'échange
`api.instagram.com/oauth/access_token` répond chaque fois « Error validating verification code.
Please make sure your redirect_uri is identical to the one you used in the OAuth dialog request ».

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

**Causes envisagées, de la plus probable à la moins probable.**
1. L'adresse enregistrée dans « Paramètres de connexion professionnelle » n'est pas
   EXACTEMENT celle du secret (« / » final ajouté, adresse absente, ou enregistrée seulement
   dans « Facebook Login »).
2. `IG_APP_SECRET` n'est pas la clé secrète actuelle de l'app **Instagram** (clé
   réinitialisée depuis le 14/10, ou clé de l'app Facebook). Impossible à tester sans un
   vrai code : Meta vérifie le code avant la clé.
3. Comptes sans rôle sur l'app pendant que les deux autorisations sont en accès standard :
   n'explique pas l'échec de Marc, mais aurait bloqué tous les créateurs tant que l'App
   Review n'était pas passée.

**Ce qui était prévu dans Meta (plus à faire).**
1. developers.facebook.com › Mes apps › l'app de TTP › menu **Instagram** › **Configuration
   de l'API avec connexion Instagram**.
2. Étape « 3. Configurer la connexion professionnelle Instagram » › **Paramètres de connexion
   professionnelle** › **URI de redirection OAuth** : une ligne exactement
   `https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-callback` → Enregistrer. Rouvrir
   la page : si Meta a remis un « / » à la fin, garder sa version et poser la même dans le
   secret `IG_REDIRECT_URI`. L'« URL d'intégration » affichée à cette étape devait contenir la
   même adresse.
3. Même page, **ID de l'app Instagram** = `1794104085073381` ; **Clé secrète de l'app
   Instagram** › Afficher › la reposer dans le secret `IG_APP_SECRET` (pas la clé de
   Paramètres › De base, qui est celle de l'app Facebook).
4. **Rôles dans l'application** › Rôles › Ajouter des personnes › **Testeur Instagram** : le @
   de chaque créateur qui essaie avant la validation. Il accepte dans Instagram › Paramètres ›
   Sites web et apps › Invitations de testeur (ou instagram.com/accounts/manage_access).
5. **Mode de l'app** : En ligne (déjà le cas depuis le 15/10), ne pas repasser en développement.
6. **Examen de l'app** › Autorisations et fonctionnalités : `instagram_business_basic` et
   `instagram_business_manage_insights` › **Demander l'accès avancé**.
7. Essai avec un compte testeur : la fiche du créateur (vue agence) montre le résultat et le
   message brut de Meta (table `ig_connexions`), et un push arrive aux fondateurs.

---

# Envoi de l'examen, novembre 2026 (connexion unifiée des créateurs)

Demande : **accès avancé** à `instagram_manage_insights` pour l'app Meta « TTP Suite Scouting »
(`1085983370893343`), produit Facebook Login for Business. Pour `instagram_basic` : vérifier
dans Examen de l'app › Autorisations et fonctionnalités s'il a déjà l'accès avancé (il était
dans la demande d'octobre) ; sinon, le demander aussi. `public_profile` : déjà demandé. Plus
d'`instagram_business_*` ni d'app Instagram. Tout ce qu'il faut coller est ci-dessous, dans
l'ordre où Meta le demande.

## 0. Avant d'ouvrir le formulaire (sinon l'examen sera refusé)

1. **Configuration complète** : `instagram_manage_insights` ajoutée, puis un essai réel avec un
   compte de test : « Instagram connecté » et des statistiques sur sa fiche. La connexion
   elle-même marche déjà (deux comptes reliés le 26/11).
2. **Rappels prêts** : `ig-deauth` et `ig-data-deletion` adaptés à l'app Meta, déployés et
   essayés (§ 1). Vérifier aussi que
   `https://app.ttpcreators.pro/instagram-donnees/?code=IG-ABCDEFGHJK` affiche « Tes données
   Instagram ont été supprimées » et le code.
3. **Montrer le bouton dans l'espace créateur** : « Connecter mon Instagram » est caché tant
   que `FEATURES.connect.instagram` vaut `false` (`src/lib/features.ts`). Le passer à `true`
   dans une PR avant de filmer. Les créateurs sans rôle sur l'app verront alors « Ton compte
   n'est pas encore autorisé par Meta » (message déjà prévu). Les examinateurs de Meta doivent
   voir ce bouton.
4. **Compte de démonstration** (voir § 5) et **compte Instagram de test** : un compte Instagram
   **professionnel** (Créateur ou Entreprise) qui n'est pas celui d'un vrai créateur, et qui
   peut se connecter avant l'accord (rôle sur l'app : Rôles dans l'application).

## 1. Les deux adresses de rappel (après l'étape 2 de la partie 2)

Où : Meta › Mes apps › « TTP Suite Scouting » › **Facebook Login for Business** ›
**Paramètres**. Plus dans « Paramètres de connexion professionnelle » de l'API Instagram :
c'était l'ancienne voie. Si Meta n'y propose pas la suppression des données : Paramètres de
l'app › Général (voir § 2).

| Champ Meta | Adresse à coller |
|---|---|
| URL de rappel pour les annulations d'autorisation (Deauthorize callback URL) | `https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-deauth` |
| URL de la demande de suppression des données (Data deletion request URL) | `https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-data-deletion` |

Ne rien changer aux « URI de redirection OAuth valides » : l'adresse de `ig-callback` y est déjà
(la connexion marche). Enregistrer.

Ce que feront ces adresses une fois adaptées : Meta les appelle en POST avec un
`signed_request` signé avec la clé secrète de l'app Meta (`META_APP_SECRET`). Signature fausse
→ 400, rien n'est fait.
- `ig-deauth` : le créateur a retiré l'app → jeton supprimé, « Instagram connecté » retiré de
  sa fiche, ligne « annulation » dans `ig_connexions`.
- `ig-data-deletion` : demande d'effacement → jeton, lien et statistiques privées effacés
  (couverture, vues, interactions, audience, chiffres privés des posts et des posts de collabs,
  mesures d'engagement automatiques) ; la fiche et les chiffres publics restent. Répond à Meta
  `{ "url": "https://app.ttpcreators.pro/instagram-donnees/?code=IG-…", "confirmation_code": "IG-…" }`
  et note la demande (avec le code) dans `ig_connexions`.

**État au 27/11** : le code vérifie encore la signature avec `IG_APP_SECRET` (clé de l'app
Instagram) et cherche le compte par `ig_accounts.ig_user_id`. Un appel de l'app Meta serait donc
refusé (400) ou ne trouverait pas le compte. D'où l'étape 2 de la partie 2.

## 2. Fiche de l'app (Paramètres de l'app › Général) : déjà en place, à vérifier

- Politique de confidentialité : `https://ttpcreators.pro/confidentialite/`
- Conditions de service : `https://ttpcreators.pro/conditions/`
- Suppression des données, « URL d'instructions » : `https://ttpcreators.pro/confidentialite/#suppression`
  (si Meta propose plutôt « URL de rappel de suppression des données », mettre l'adresse
  `ig-data-deletion` du § 1, une fois adaptée).
- Domaines : `ttpcreators.pro`, `app.ttpcreators.pro` ; e-mail : `partnerships@ttpcreators.pro`.

## 3. « Comment votre app utilise cette autorisation » (à coller en anglais)

**instagram_manage_insights**

> TTP Creators is a talent management agency based in France. TTP Suite
> (https://app.ttpcreators.pro) is the web app we give to the content creators we represent:
> each creator has a private space, created by our agency. In that space, the creator clicks
> "Connect my Instagram", chooses Instagram on the Facebook Login for Business page and shares
> their own Instagram professional account with our app. We use instagram_manage_insights to
> read the insights of that account and of its own media: reach, views, interactions, saves and
> shares over the last 28 days and per post, and the aggregated audience breakdown (age, gender,
> top cities and countries, as percentages only, with no data about individual followers).
> These figures are shown to the creator in their space ("My stats") and to our agency team on
> the creator record. They fill in the creator's media kit and the campaign reports we send to
> the brands the creator works with, replacing the screenshots creators used to send us by hand
> every month. We never sell this data or share it with third parties other than in these
> campaign reports. When the creator disconnects, the access token and the private insights are
> deleted.

Traduction pour Marc : le créateur relie son propre compte pro depuis son espace, en
choisissant Instagram sur la page de Meta. Nous lisons les statistiques de ce compte et de ses
publications (couverture, vues, interactions, enregistrements, partages sur 28 jours et par
post) et la répartition de son audience (âge, genre, villes et pays, en pourcentages, rien sur
un abonné en particulier). Il les voit dans « Mes stats », l'agence sur sa fiche. Elles
remplissent son media kit et les bilans envoyés aux marques de ses campagnes, à la place des
captures d'écran. Rien n'est vendu ni partagé en dehors de ces bilans. S'il se déconnecte, le
jeton et les statistiques privées sont effacés.

**instagram_basic** (seulement s'il n'a pas déjà l'accès avancé)

> TTP Creators is a talent management agency based in France. TTP Suite
> (https://app.ttpcreators.pro) is the web app we give to the content creators we represent:
> each creator has a private space, created by our agency. In that space, the creator clicks
> "Connect my Instagram", chooses Instagram on the Facebook Login for Business page and shares
> their own Instagram professional account with our app. We use instagram_basic only to
> identify the shared account (account ID, username, profile picture and follower count) and to
> list its own recent media (ID, permalink, date, type, like and comment counts), so that the
> creator's statistics and sponsored posts are attached to the right creator record in our app.
> This is read-only: the app never publishes, comments, sends messages or changes anything on
> the creator's account. The data is visible only to the creator and to our agency team. The
> creator can disconnect at any time from their space; the access token is then deleted.

Traduction pour Marc : nous utilisons instagram_basic seulement pour reconnaître le compte
partagé (id, @, photo, abonnés) et lister ses publications récentes (id, lien, date, type,
likes, commentaires), afin de rattacher ses statistiques et ses posts sponsorisés à la bonne
fiche. Lecture seule : rien n'est publié, commenté ni envoyé depuis son compte. Seuls le
créateur et l'agence voient ces données. Il peut se déconnecter à tout moment ; son jeton est
alors supprimé.

**public_profile** (déjà demandé ; texte de secours si Meta le redemande)

> Facebook Login for Business includes public_profile by default. Our app does not read, store
> or display any Facebook profile data: the login is only used so that the creator can share
> their own Instagram professional account with our app (see instagram_basic and
> instagram_manage_insights).

Phrase à ajouter à la fin des textes, **seulement après l'essai des rappels (§ 1)** :

> Deauthorize and data deletion callbacks are implemented: if the creator removes our app or
> asks Meta to delete their data, the access token and the private insights are deleted.

Pour chaque autorisation : cocher la case de l'usage autorisé, joindre la vidéo (§ 4), et aux
questions « intégration pour plusieurs clients professionnels ? » / « au nom d'un client
individuel ? » répondre comme pour la demande d'octobre (Non / Non), sauf si Meta les pose
autrement pour Facebook Login for Business (alors : les comptes connectés sont ceux des
créateurs, qui les relient eux-mêmes).

## 4. Vidéo d'écran (1 à 2 minutes)

Préparer : espace du compte de démonstration en **anglais** (Profil › Langue de l'espace ›
English), compte Instagram de test déconnecté au départ, navigateur sans autre onglet, aucun
vrai créateur à l'écran (la fiche agence montrée est celle du créateur de démonstration).
La fiche agence est en français : ajouter des sous-titres anglais courts, ou s'appuyer sur les
« Notes for the reviewer » ci-dessous.

| Temps | À l'écran | Sous-titre (anglais) |
|---|---|---|
| 0:00 | `https://app.ttpcreators.pro`, connexion avec le compte de démonstration de créateur | "A creator represented by our agency logs in to their TTP Suite space." |
| 0:10 | Espace créateur › « Send my stats » (ou « My stats ») : carte « Even simpler: connect your Instagram » | "The creator chooses to connect their Instagram professional account." |
| 0:18 | Clic sur **Connect my Instagram** | |
| 0:20 | Page de Meta (Facebook Login for Business) : choisir **Instagram** | "On Meta's login page, the creator chooses Instagram." |
| 0:28 | Connexion au compte Instagram de test | "Instagram login with the creator's own account." |
| 0:35 | Écran de Meta : le compte professionnel à partager et les autorisations demandées, puis accepter | "The creator shares their professional account and grants instagram_basic and instagram_manage_insights." |
| 0:45 | Retour dans l'espace : « Instagram connected ✓ Your stats now come in automatically » | "Back in TTP Suite, the account is connected." |
| 0:55 | « My stats » : posts récents avec vues, couverture (« reach »), enregistrements, partages | "The creator's own insights: views, reach, saves, shares per post." |
| 1:10 | Se déconnecter, se connecter avec le compte agence › Roster › fiche du créateur de démonstration › carte « Instagram du jour » : connecté (@ du compte de test), couverture 28 j, vues 28 j, vues des reels, audience âge / genre / villes / pays | "Our agency team sees the connection status and the insights on the creator record." |
| 1:30 | Media kit du créateur : lignes Instagram et audience remplies | "They fill in the creator's media kit for brands." |
| 1:40 | Retour dans l'espace créateur › **Déconnecter / Disconnect** | "The creator can disconnect at any time: the token is deleted." |
| 1:50 | Fin | |

Si l'audience est vide (compte de test avec trop peu d'abonnés : Meta ne donne l'audience qu'à
partir de 100 abonnés), le dire dans les notes plutôt que de couper.

## 5. Identifiants de test (« instructions pour l'examen »)

Meta demande de pouvoir se connecter à l'app. Ce que Marc crée lui-même (aucun mot de passe
n'est écrit ici ni dans Git) :

1. **Une fiche créateur fictive** dans le Roster, par exemple « Demo Meta Review » (aucune
   vraie personne, aucune vraie marque), statut actif.
2. **Un compte créateur** relié à cette fiche : page **Accès** › nouveau compte, rôle
   « créateur », fiche « Demo Meta Review », avec une adresse de l'agence réservée à ça (par
   exemple un alias de `partnerships@ttpcreators.pro`). Le mot de passe est choisi par Marc et
   montré une seule fois par l'app : le copier directement dans le formulaire de Meta. Le
   changer (« Nouveau mot de passe ») après la décision de Meta.
3. Passer l'espace de ce compte en anglais (§ 4).
4. Dans le formulaire : URL `https://app.ttpcreators.pro`, l'adresse et le mot de passe de ce
   compte, et le texte ci-dessous. Ce compte ne voit que la fiche fictive : aucune donnée de
   créateur réel n'est exposée.
5. Pour l'étape Instagram, les examinateurs utilisent leur propre compte professionnel de
   test. Si Meta demande aussi un compte Instagram, donner le compte de test du § 0.4 (jamais
   celui d'un créateur).
6. « Facebook Login intégré ? » : **Oui** (Facebook Login for Business, pour la connexion des
   créateurs). En octobre, la réponse était Non.

**Notes for the reviewer** (à adapter avec les temps réels de la vidéo) :

> TTP Suite (https://app.ttpcreators.pro) is the private web app of TTP Creators, a talent
> management agency. Creators we represent get a personal space created by our agency (there is
> no public sign-up). Test login (creator space, demo data only): see the credentials above.
> Steps: 1) Log in; the space can be switched to English in Profile > Space language.
> 2) Open "Send my stats" and click "Connect my Instagram". 3) On the Facebook Login for
> Business page, choose Instagram, log in with an Instagram professional (Creator or Business)
> account, share it with our app and allow the requested permissions. 4) You are redirected
> back to TTP Suite: "Instagram connected". Insights appear in "My stats" after the first sync
> (a few seconds; refresh the page). 5) "Disconnect" deletes the access token and the private
> insights. The agency view of the creator record (shown in the screencast, in French) displays
> the connection status, reach and views over 28 days, and the aggregated audience.
> On the creator's account, the app is read-only: it never publishes or sends anything there.

À ajouter seulement après l'essai des rappels (§ 1) :

> Deauthorize callback: https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-deauth.
> Data deletion callback: https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-data-deletion
> (returns a status URL and confirmation code).

## 6. Les menus Meta, dans l'ordre

1. developers.facebook.com › **Mes apps** › « TTP Suite Scouting ».
2. **Facebook Login for Business** › Configurations › la configuration de TTP (son ID est dans
   le secret `IG_CONFIG_ID`) : `instagram_manage_insights` ajoutée (partie 2, étape 1).
3. **Facebook Login for Business** › Paramètres : les deux adresses du § 1, une fois les rappels
   adaptés et essayés › Enregistrer.
4. **Paramètres de l'app › Général** : vérifier le § 2.
5. **Examen de l'app** › **Autorisations et fonctionnalités** › `instagram_manage_insights` ›
   **Demander l'accès avancé** ; idem pour `instagram_basic` s'il ne l'a pas encore.
6. **Examen de l'app** › **Demandes** (la demande en cours) : pour chaque autorisation, le texte
   du § 3 et la vidéo du § 4 ; « Traitement des données » : mêmes réponses qu'en octobre (voir
   « Formulaire envoyé » plus haut) ; « Instructions pour l'examen » : § 5 › **Envoyer**.
7. Après l'accord : `FEATURES.connect.instagram` reste à `true`, et les créateurs n'ont plus
   besoin d'un rôle sur l'app pour se connecter.
