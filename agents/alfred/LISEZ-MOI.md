# Alfred, le bras droit et talent manager

Alfred est l'assistant de Marc sur Telegram, avec **son propre bot** (séparé de Megan). Il tourne sur le Mac de Marc avec l'abonnement Claude de Marc, sans clé API.

| Ce qu'il fait | Comment |
|---|---|
| Répond tout de suite quand Marc lui écrit | Écoute Telegram en continu, lance Claude dès qu'un message arrive ; sa réponse cite le message de Marc (comme « Répondre ») |
| Va à l'essentiel | Messages à Marc très courts (une ligne par point, 6 lignes pour une réponse, 12 pour un point), le détail sur demande ; les textes à copier et documents restent complets |
| Comprend les vocaux de Marc | Transcrits sur le Mac (whisper.cpp et ffmpeg, gratuit, sans internet), puis traités comme un message écrit |
| Le point à 9 h et 17 h en semaine | Mails des marques et DM, devis, factures en retard, créateurs, argent à aller chercher |
| Bilans et renouvellements | 7 jours après une publication : stats relevées par l'app, bilan pour la marque et mail « on refait ça ? » avec une offre plus grosse |
| Prospection du lundi | Lundi 11 h : deux ou trois marques par créateur actif (radar à marques de l'app, agences concurrentes, bilans, pipeline, web), avec Megan, premier mail prêt ; « oui tout » pour tout envoyer |
| Tarifs du mois | Premier lundi du mois, 14 h : qui mérite une hausse, quels précédents sont trop bas |
| Facture prête | Collab publiée sans facture : facture préparée et montrée, créée dans Facturation sur « oui facture Marque » |
| Reversements | Marque payée, créateur pas encore payé : rappel, tâche et message au créateur |
| Contrats | Contrats pas signés relancés à J+3, signalés à J+7 ; collab avancée quand c'est signé |
| Relances automatiques | Sur « active les relances automatiques » : relances de factures (J+1, J+8) et de marques (J+4, J+10) envoyées seules, avec compte rendu ; jamais la mise en demeure |
| Fiche avant rendez vous | Une heure avant chaque rendez vous du jour : qui, historique, en cours, objectif, points à obtenir |
| Rapport du lundi | Argent, deals, créateurs, ce qu'Alfred a fait, priorités ; envoyé à Marc et noté au journal pour Gianni |
| Recrutement du mercredi | Mercredi 11 h : les trois meilleurs profils du scouting et leur premier DM |
| Media kits | Dans la revue du mois : media kits dépassés signalés avec les nouveaux chiffres |
| Nouveau créateur | Contrat de représentation, fiche, accès, media kit, bienvenue, mémoire, chacun en tâche |
| Droits d'utilisation | Registre des droits vendus aux marques (`droits_usage`) : prolongation proposée 21 jours avant la fin ; droits expirés vérifiés dans la bibliothèque publicitaire de Meta, et facture de prolongation si la vidéo tourne encore |
| Vidéos qui cartonnent | Chaque matin, les posts qui font au moins deux fois les chiffres habituels du créateur (`posts_createur`) : relances des marques qui hésitaient, avec le nouveau chiffre |
| Temps forts | Noël, Black Friday, Saint Valentin, rentrée, grands événements sportifs : la prospection s'y prépare 6 à 10 semaines avant |
| Proposition sur mesure | « Fais une proposition pour Marque » : trois créateurs adaptés, leurs chiffres, des idées et des formules chiffrées, en PDF |
| Relecture des contrats | Contrat d'une marque envoyé en PDF ou Word : pièges repérés (droits, exclusivité, paiement, annulation, loi influence), clauses de remplacement et mail à la marque |
| Contrôle de publication | Le lendemain d'une publication prévue : post en ligne, mention « Collaboration commerciale », @, code promo ; sinon le message au créateur |
| Créateurs à risque | Revue du mois : le créateur qui a moins de deals, attend un paiement ou une réponse, et l'action pour le garder |
| Compte rendu de rendez vous | Un vocal après le call : compte rendu, tâches, dates, et mail récapitulatif à la marque |
| Mode vacances | « Je pars jusqu'au 20 » : seulement l'urgent, réponses d'attente aux marques (sur délégation), résumé au retour |
| Trésorerie | Chaque lundi et sur demande : sur le compte, à encaisser, à reverser, à mettre de côté, fin de mois prévue |
| Skills | Sept savoir faire chargés au bon moment (`skills/`) : influencer-marketing, cold-email, prospecting, sales-enablement, offers, comptable, copy-editing |
| Documents en PDF | Contrats, bilans et propositions partent en PDF quand Chrome est installé sur le Mac (sinon en HTML) |
| Alerte si Alfred tombe | Chaque jour de semaine, l'app vérifie qu'Alfred a fait son point du matin ; sinon notification à Marc et Gianni |
| Réponses aux mails, relances | Brouillons Gmail montrés sur Telegram, avec un lien qui les ouvre dans Spark (Marc peut les envoyer lui même) ; envoyés par Alfred seulement sur « oui Marque » de Marc |
| Brouillons en double | Quand Marc a répondu lui même dans un fil, Alfred supprime son brouillon devenu inutile (jamais un brouillon écrit par Marc) |
| Spams | Fouille les spams à chaque point pour repêcher les vraies demandes de marques |
| Captures d'écran | Marc envoie des captures d'une discussion (WhatsApp, Instagram, LinkedIn) : Alfred les lit, retrouve le contexte et prépare la réponse à copier |
| Devis | Brouillon dans Facturation › Devis ; Marc l'envoie depuis l'app |
| Messages aux créateurs, DM, réponse à un fil collé | Texte prêt à copier d'un toucher sur Telegram |
| To-do | Crée les tâches tirées des mails, coche ce qui est fait |
| Contacts | Chaque personne intéressante qui écrit entre dans la page Contacts (signature lue : rôle, email, téléphone pro, Instagram), sans doublon, avec l'échange noté ; rattrapage d'une période sur demande |
| Collabs | Pipeline, création de la collab quand c'est confirmé, brief, contact, échange, rendez vous, étapes ; il le fait puis le dit |
| Toute l'app sur demande | Quand Marc écrit, il a tous les outils de TTP Suite (factures, réglages, suppressions vers la Corbeille…) et fait ce qui est demandé ; ses points automatiques gardent les règles prudentes |
| Contrats | Rédigés sur demande à partir des modèles de l'app et du protocole CONTRATS, envoyés en document sur Telegram |
| Réflexion | Vérifie ses sources (app, mails, mémoire, web), croise, recalcule, cite d'où vient chaque info |
| Valider un contenu | Marc transfère la preview d'un créateur : images de la vidéo (accroche de près) et transcription horodatée préparées sur le Mac, comparées au brief et aux mails ; verdict, points bloquants, améliorations, détails, et le message au créateur prêt à copier. Une image par seconde (jusqu'à 90 s). Sur Telegram : 20 Mo au plus (limite des bots) ; au delà, un lien WeTransfer, SwissTransfer, Google Drive ou Dropbox (3 Go au plus) |
| Descriptions de posts | « Léna me demande une description pour le reel Yade » : deux propositions prêtes à copier, à partir du brief, des mails et du style du créateur |
| Planning et Meet | Dates des marques et rendez vous confirmés (mails, échanges, captures) ajoutés tout seuls au Planning, donc au Google Agenda de partnerships@, avec lien Google Meet pour une visio ; jamais de doublon (refusé par l'app même) ; invitation Google aux participants seulement quand Marc le demande |
| Roster à jour | Relit les créateurs actifs dans l'app à chaque fois, ne propose jamais quelqu'un qui est parti, annonce les arrivées et départs |
| Rappels | « Rappelle moi jeudi 15 h… », et ses propres rappels de ce que Marc risque d'oublier |
| Délégation | « Gère les relances jusqu'à vendredi, tu peux envoyer » : il agit dans ce périmètre et rend compte |
| Mémoire commune avec Gianni | Tout ce qui compte va dans l'app (collabs, contacts, planning, tâches, mémoire des créateurs) et dans le journal des agents (`noter_journal`), repris par `point_du_jour` et `journal_agents` : l'assistant de Gianni voit la même chose que Marc |
| Questions | Contrats, briefs, collabs, factures : il cherche dans TTP Suite et répond avec la source |

**Rien ne part vers l'extérieur sans un « oui » de Marc**, sauf dans une délégation où Marc a écrit qu'Alfred pouvait envoyer. WhatsApp : toujours copié par Marc.

## Les fichiers

Dans le dépôt (`agents/alfred/`, public, aucun secret) : `CLAUDE.md` (ses consignes), `skills/` (ses skills, sous licence libre, copiées dans `.claude/skills`), `alfred.sh` (un passage), `ecoute.sh` et `telegram.mjs` (Telegram), deux réglages launchd, `installer.sh`.

Sur le Mac seulement (`~/Code/TTPAlfred/`) :
- `config.env` : jeton du bot d'Alfred et identifiant Telegram de Marc ;
- `REDACTION.md` : les consignes de rédaction de Marc (son dossier « bras droit » sur Claude) ;
- `etat/` : sa mémoire (`memoire.md`, 150 lignes au plus), son suivi, ses rappels, ses délégations, le fil des échanges et les journaux. Les fichiers qui grossissent sont raccourcis à chaque passage.

Ses consignes de fond et les leçons apprises se règlent aussi dans l'app : Agents › Alfred (`lire_agent`).

## Installer

1. Créer le bot : dans Telegram, @BotFather, `/newbot`, nom « Alfred », puis `/setuserpic` pour sa photo.
2. `./agents/alfred/installer.sh --bot <chat_id_de_Marc>` (le jeton est demandé, caché).
3. Dans Telegram, ouvrir le bot d'Alfred et appuyer sur « Démarrer ».
4. `./agents/alfred/installer.sh` : copie et programme l'écoute et les passages. À relancer après chaque changement de ces fichiers.

## Mises à jour

Alfred se met à jour tout seul (`mise-a-jour.sh`, launchd `com.ttp.alfred.maj`, chaque nuit à 4 h et au démarrage du Mac) : il regarde sur GitHub la dernière version du dossier `agents/alfred` de `main`, la contrôle, l'installe (sans toucher à `config.env`, `REDACTION.md` ni `etat/`) et prévient Marc sur Telegram. Une nouveauté d'Alfred arrive donc sur le Mac la nuit qui suit sa mise en ligne. Journal : `etat/mises-a-jour.log`. Pour l'appliquer tout de suite : `zsh ~/Code/TTPAlfred/mise-a-jour.sh`.

## Si Alfred ne répond plus

- Le Mac doit être allumé et pas en veille. Messages et points ratés sont traités au réveil.
- La connexion de Claude a pu expirer : Terminal, `claude`, puis `/login`. Alfred prévient sur Telegram quand un passage échoue.
- Journaux : `~/Code/TTPAlfred/etat/passages.log` et `etat/ecoute.log`.
- Un point à la main : `zsh ~/Code/TTPAlfred/alfred.sh --point`.
- Tout arrêter : `launchctl bootout gui/$(id -u)/com.ttp.alfred.ecoute` puis `launchctl bootout gui/$(id -u)/com.ttp.alfred`.
