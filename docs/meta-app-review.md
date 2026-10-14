# Validation Meta (App Review) : lire les DM Instagram de TTP

Pourquoi : sans « accès avancé » à `instagram_manage_messages`, Meta refuse de lister les
conversations du compte @ttpcreators (erreur code -2 « Timeout », sous-code 2534084 : trop de
conversations avec des comptes sans rôle sur l'app). Constaté le 2026-10-14.
L'accès avancé demande : **1) la vérification de l'entreprise**, **2) la validation de l'app**.

App Meta : « TTP Suite Scouting », ID `1085983370893343`, type Entreprise, portefeuille
« The Insider's Private Society » (ID `1226405722196594`), mode Développement.

## Étapes, dans l'ordre

| # | Étape | Qui | État |
|---|-------|-----|------|
| 1 | Vérification de l'entreprise (Business Manager → Centre de sécurité → « Démarrer la vérification ») : documents officiels au nom de l'entreprise. Avant : renommer le portefeuille « The Insider's Private Society » en « TTP Creators » et corriger « Informations sur l'entreprise » (raison sociale actuelle « TIPS CONCIERGE », site instagram.com/tipsconcierge, pas de téléphone) avec les données de l'avis SIRENE / extrait RNE de l'EI de Marc ; code de confirmation par email sur partnerships@ttpcreators.pro | Marc + assistant | ✅ **Vérifiée** (Meta, première vérification le 14 oct. 2026 ; « Vérification pour BOURAOUI MARC MAHER : Vérifiée », vu le 15 oct.) |
| 2 | Pages publiques `ttpcreators.pro/confidentialite/` et `/conditions/` (site vitrine) | assistant | ✅ en ligne (2026-10-14) |
| 3 | Fiche de l'app (Paramètres de l'app → Général) : voir « Champs » ci-dessous | assistant + Marc | ✅ (2026-10-14) : domaines, confidentialité, conditions, suppression des données, catégorie « Entreprises et Pages », e-mail de contact partnerships@ttpcreators.pro ✅ enregistrés ; app rattachée au portefeuille « TTP Creators » ✅ ; ✅ icône (logo TTP) |
| 4 | Réception en direct : déployer `ig-webhook` + secrets + Webhooks Meta (voir plus bas) | Marc + assistant | ✅ (2026-10-14) : `ig-webhook` + `ig-inbox` déployées, secrets `META_APP_SECRET` et `IG_WEBHOOK_VERIFY` posés, produit Webhooks ajouté, objet Instagram → URL de rappel vérifiée, champ **messages** abonné (v26.0), envoi test Meta = succès (donc signature et clé secrète OK). ⚠️ Meta : en mode Développement, seuls les envois test du tableau de bord arrivent ; pour recevoir de vrais DM (même des comptes ayant un rôle) et filmer la démo, l'app doit passer en mode **Live** |
| 5 | Vidéo de démonstration (scénario ci-dessous) | Marc + assistant | ⏳ |
| 6 | Contrôle app → Autorisations et fonctionnalités → `instagram_manage_messages` → « Demander un accès Avancé » (+ les autorisations liées que Meta propose) | Marc | ⏳ |

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

> We use pages_manage_metadata only to subscribe our app to the webhooks of our own Facebook
> Page "TTP Creators" (field: messages), so that new direct messages received on our linked
> Instagram professional account appear in TTP Suite in real time. We do not modify any other
> Page settings.

**instagram_basic — How will your app use this permission?**

> We use instagram_basic to read the profile of our own Instagram professional account
> (@ttpcreators: username, profile picture, follower count) and the username of the people who
> message it, to display conversations in TTP Suite.

**Notes for the reviewer**

> TTP Suite is an internal tool: access is limited to our agency team (accounts are created by
> us, no public sign-up). Test credentials for the reviewer are provided below. The interface is
> in French; the screencast has English captions. Path: Relations → DM Instagram.

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
