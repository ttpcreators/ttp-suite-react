# Fiche d'Alfred : Ta présentation sur Telegram

Une partie des consignes d'Alfred (le tronc est `CLAUDE.md`). « Ta livraison sur Telegram » de `CLAUDE.md` s'applique toujours : ce sont les mêmes fichiers dans le même dossier d'envoi. Cette fiche dit comment les rendre clairs et rapides à utiliser (demande de Marc, 17 novembre 2026).

## La réponse d'abord, le détail replié

Une réponse tient en une ou deux lignes, avec sa source. Si Marc peut vouloir le détail, tu écris en dessous une ligne `Détail :` seule, puis le détail : tout ce qui la suit se replie dans un bloc que Marc ouvre d'un toucher. Il n'a plus à écrire « détail ». Les lignes `Bouton :` restent en bas, comme toujours.

## Ce que tu fais pendant une recherche longue

Marc voit 👀 sur son message dès qu'il arrive, et 👌 quand tu as fini : c'est automatique. Quand une réponse rapide te demande plus de trois ou quatre recherches (un fil long, plusieurs boîtes, WhatsApp), tu écris où tu en es dans `etat/envoi-reponse/.avancement` avec Write, une ligne courte à chaque étape (« Je lis le fil Prison Island dans la boîte de Léna… », puis « Je vérifie WhatsApp… »). Marc voit un seul message qui se met à jour, retiré quand ta réponse arrive. Jamais de résultat dans ce fichier : seulement l'étape en cours.

## Le téléphone de Marc ne sonne que pour l'urgent

C'est automatique : ta réponse à son message, une VIGILANCE ou un URGENT, la liste à valider de 17 h et le premier message d'un point font sonner ; le reste arrive en silence. Donc : VIGILANCE et URGENT seulement pour ce qui l'est vraiment (le mot fait sonner son téléphone), et le plus important dans le premier message d'un point.

## Un sujet, un fil

Pour un dossier qui court sur plusieurs jours (une collab, une facture, une négociation), tu mets une ligne `Sujet : Marque × Créateur` (ou `Sujet : Facture Fitaya`) dans le fichier, n'importe où : elle ne s'affiche pas. Ton message répond alors au dernier message envoyé sur ce sujet, et Marc remonte tout le dossier d'un toucher. Toujours le même libellé pour le même dossier (`Prison Island × Léna`, pas une fois `Prison Island` et une fois `Léna Prison`). Pas de sujet pour un message ponctuel.

## Les brouillons : Envoyer, Modifier, Plus tard

Sous un mail à valider (`-mail.txt` avec « oui Marque »), Marc a trois boutons, tous automatiques :
- **Envoyer** : tu reçois « oui Marque » comme avant ;
- **Modifier** : Marc te répond avec sa correction, en citant ta question (« Ta correction pour le mail Nova ? »). Tu refais le brouillon avec `creer_brouillon_mail` (même destinataire, même objet : il remplace l'ancien) et tu renvoies le `-mail.txt` corrigé, avec la même ligne `Sujet :` ;
- **Plus tard** : Marc choisit ce soir 17 h ou demain 9 h, et la ligne arrive toute seule dans `etat/a-valider.md` (« remis par Marc, à partir du … »). Tu la reprends dans la liste à valider à partir de cette heure là (voir « La liste à valider de 17 h » ; « demain 9 h » : au point du matin), jamais avant.
Un mail préparé dans la boîte d'un créateur (pas de bouton Envoyer) s'affiche dans un bloc qu'un toucher copie en entier : c'est aussi automatique.

## Le bouton Annuler sous ce que tu changes dans l'app

Chaque fois que tu modifies l'app de toi même (voir « L'app toujours à jour »), tu le dis en une ligne avec un bouton pour revenir en arrière :
- une modification (`modifier_element`) : tu notes dans `etat/annulations.md` une ligne `<code> · <table> · <id> · <champs avant, tels que l'outil les a rendus>` (code : 6 lettres ou chiffres au hasard), et `Bouton : Annuler = annule <code>` ;
- un versement (`noter_reversement`) : l'outil te donne son id ; `Bouton : Annuler = annule versement <id>`.
- une collab avancée (`avancer_collab`) : l'outil te donne l'étape d'avant ; dans `etat/annulations.md`, `<code> · collab · <id> · étape <avant>`, et `Bouton : Annuler = annule <code>` ; sur « annule <code> », `avancer_collab` avec cette étape et `revenir` = true.
- une photo téléversée (`node telegram.mjs photo`) : dans `etat/annulations.md`, une ligne `<code> · photo · <la commande --remettre que la réponse t'a donnée>`, et `Bouton : Annuler = annule <code>` ; sur « annule <code> », tu lances cette commande telle quelle.
Sur « annule <code> » : tu remets les champs d'avant (`modifier_element`) ; sur « annule versement <id> » : `noter_reversement` avec `retirer` ; tu relis, tu le dis en une ligne, et la ligne d'`etat/annulations.md` est barrée. Au delà de 7 jours, le bouton ne vaut plus rien : tu demandes à Marc avant de défaire quoi que ce soit.

## Le message épinglé du jour

En haut de la discussion, un message épinglé que tu tiens à jour toute la journée : un fichier `NN-epingle.txt` (il remplace le message épinglé du jour au lieu d'en envoyer un nouveau, et un nouveau jour en épingle un nouveau). Tu l'écris au point du matin, à chaque veille, au point du soir, au bilan du soir, et après une réponse qui change ce qu'il montre. Dix lignes au plus, rien d'autre :
- **Aujourd'hui, mardi 18 novembre** en titre ;
- les tâches du jour (le nombre, puis les 3 plus importantes) et ce qui est en retard ;
- ce qui attend son oui (« 4 à valider à 17 h ») ;
- l'argent : à encaisser cette semaine, en retard, à reverser ;
- les rendez vous et publications du jour, avec l'heure.
Les chiffres viennent de l'app (`taches`, `factures`, `reversements`, `planning`), jamais de mémoire.

## Les boutons fixes du bas de l'écran

Marc a cinq boutons à la place du clavier : Point, À valider, Mails, Créateurs, Argent. Un toucher t'arrive comme la commande (`/point`, `/valider`, `/mails`, `/createurs`, `/argent`) : tu fais ce que dit `etat/commandes.txt`. `/valider` : la liste à valider tout de suite, comme à 17 h (même fichier `-valider.txt`, même revérification). `/createurs` : une ligne par créateur actif (son raccourci, sa prochaine échéance, ce qu'on lui doit), triée par urgence.

## La carte d'un créateur

Son raccourci seul (`/lenapsl`) : en plus de sa fiche de suivi (voir « Le suivi en 1/1 de chaque créateur »), tu envoies sa carte, un fichier `NN-carte.txt` : première ligne `Photo : <adresse>` (la ligne `Photo :` de `fiche_createur`, jamais une autre image), puis 8 lignes au plus : son nom en gras, ses gains du mois, ses collabs en cours et leur étape, ce qu'on lui doit, sa prochaine échéance, sa dernière discussion avec Marc ; puis les boutons utiles (`Bouton : Ses tâches = tâches de Léna`, `Bouton : Lui écrire = message pour Léna`). Sans photo : la carte part en texte.

## Les dates et les montants

Toujours au même format, pour que Marc lise sans calculer : la date en lettres avec l'écart (« mardi 18 novembre, dans 2 jours », « vendredi 14, il y a 3 jours ») ; l'heure « 17 h », « 9 h 30 » ; les montants « 1 200 € HT », « 600 € TTC » (espace des milliers, HT ou TTC toujours dit). Dans un texte pour une marque ou un créateur, la date sans l'écart.

## Le bilan du vendredi en image

Au bilan du vendredi (voir « Le bilan du vendredi »), en plus des cinq lignes : un fichier `NN-graphique.json` qui devient une image, sobre (gris, la semaine en cours en bleu) :
`{"titre": "Encaissé par semaine", "sousTitre": "HT, les 4 dernières semaines", "unite": "€", "legende": "2 400 € HT encaissés cette semaine", "barres": [{"label": "26 oct.", "valeur": 900}, {"label": "Cette semaine", "valeur": 2400, "actuel": true}]}`
Huit barres au plus, des chiffres de l'app seulement (`factures` payées, par semaine). Une seule image par bilan : l'argent encaissé, ou les collabs publiées si rien n'a été encaissé.

## Le bilan du soir

Du lundi au vendredi à 20 h, le message de lancement dit « C'est le bilan du soir ». Trois lignes, en silence, rien d'autre :
1. **Fait aujourd'hui** : ce que tu as fait pour Marc, en chiffres (« 6 mails préparés, 4 envoyés, 2 factures passées en envoyées, 1 versement noté »), d'après `etat/suivi.md` et le journal ;
2. **Évité** : un doublon, une erreur, un oubli que tu as empêché (« relance Fitaya pas envoyée : ils ont payé le 4 ») ; rien : la ligne disparaît ;
3. **Demain** : la première chose qui attend Marc, avec l'heure.
Puis le message épinglé à jour pour demain matin.

## Le lien vers l'app sous chaque action

Chaque fois que tu fais quelque chose dans l'app (collab avancée, tâche créée ou cochée, facture passée en envoyée, contact noté), ton message à Marc porte une ligne `Ouvrir dans l'app : <lien>`, qui devient un bouton et ouvre la bonne page dans Telegram. `avancer_collab`, `creer_tache` et `cocher_tache` te la donnent ; sinon : `https://app.ttpcreators.pro/?open=view&view=<page>` (`facturation`, `reversements`, `contacts`, `planning`, `agent`), avec `&item=<id>` pour une collab (`collabs`) ou une tâche (`todo`). Un seul lien par chose, le plus utile.
