# Alfred, le bras droit et talent manager

Alfred est l'assistant de Marc sur Telegram, avec **son propre bot** (séparé de Megan). Il tourne sur le Mac de Marc avec l'abonnement Claude de Marc, sans clé API.

| Ce qu'il fait | Comment |
|---|---|
| Répond tout de suite quand Marc lui écrit | Écoute Telegram en continu, lance Claude dès qu'un message arrive |
| Comprend les vocaux de Marc | Transcrits sur le Mac (whisper.cpp et ffmpeg, gratuit, sans internet), puis traités comme un message écrit |
| Le point à 9 h et 17 h en semaine | Mails des marques et DM, devis, factures en retard, créateurs, argent à aller chercher |
| Réponses aux mails, relances | Brouillons Gmail montrés sur Telegram ; envoyés seulement sur « oui Marque » de Marc |
| Devis | Brouillon dans Facturation › Devis ; Marc l'envoie depuis l'app |
| Messages aux créateurs, DM, réponse à un fil collé | Texte prêt à copier d'un toucher sur Telegram |
| To-do | Crée les tâches tirées des mails, coche ce qui est fait |
| Contacts | Chaque personne intéressante qui écrit entre dans la page Contacts (signature lue : rôle, email, téléphone pro, Instagram), sans doublon, avec l'échange noté ; rattrapage d'une période sur demande |
| Collabs | Pipeline, création de la collab quand c'est confirmé, brief, contact, échange, rendez vous, étapes ; il le fait puis le dit |
| Toute l'app sur demande | Quand Marc écrit, il a tous les outils de TTP Suite (factures, réglages, suppressions vers la Corbeille…) et fait ce qui est demandé ; ses points automatiques gardent les règles prudentes |
| Contrats | Rédigés sur demande à partir des modèles de l'app et du protocole CONTRATS, envoyés en document sur Telegram |
| Réflexion | Vérifie ses sources (app, mails, mémoire, web), croise, recalcule, cite d'où vient chaque info |
| Valider un contenu | Marc transfère la preview d'un créateur : images de la vidéo (accroche de près) et transcription horodatée préparées sur le Mac, comparées au brief et aux mails ; verdict, points bloquants, améliorations, détails, et le message au créateur prêt à copier. Vidéos de 20 Mo au plus (limite des bots Telegram) |
| Descriptions de posts | « Léna me demande une description pour le reel Yade » : deux propositions prêtes à copier, à partir du brief, des mails et du style du créateur |
| Roster à jour | Relit les créateurs actifs dans l'app à chaque fois, ne propose jamais quelqu'un qui est parti, annonce les arrivées et départs |
| Rappels | « Rappelle moi jeudi 15 h… », et ses propres rappels de ce que Marc risque d'oublier |
| Délégation | « Gère les relances jusqu'à vendredi, tu peux envoyer » : il agit dans ce périmètre et rend compte |
| Questions | Contrats, briefs, collabs, factures : il cherche dans TTP Suite et répond avec la source |

**Rien ne part vers l'extérieur sans un « oui » de Marc**, sauf dans une délégation où Marc a écrit qu'Alfred pouvait envoyer. WhatsApp : toujours copié par Marc.

## Les fichiers

Dans le dépôt (`agents/alfred/`, public, aucun secret) : `CLAUDE.md` (ses consignes), `alfred.sh` (un passage), `ecoute.sh` et `telegram.mjs` (Telegram), deux réglages launchd, `installer.sh`.

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

## Si Alfred ne répond plus

- Le Mac doit être allumé et pas en veille. Messages et points ratés sont traités au réveil.
- La connexion de Claude a pu expirer : Terminal, `claude`, puis `/login`. Alfred prévient sur Telegram quand un passage échoue.
- Journaux : `~/Code/TTPAlfred/etat/passages.log` et `etat/ecoute.log`.
- Un point à la main : `zsh ~/Code/TTPAlfred/alfred.sh --point`.
- Tout arrêter : `launchctl bootout gui/$(id -u)/com.ttp.alfred.ecoute` puis `launchctl bootout gui/$(id -u)/com.ttp.alfred`.
