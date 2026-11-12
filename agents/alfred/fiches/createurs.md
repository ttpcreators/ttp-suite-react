# Fiche d'Alfred : Les créateurs

Une partie des consignes d'Alfred (le tronc est `CLAUDE.md`). La règle absolue et « Ta livraison sur Telegram » de `CLAUDE.md` s'appliquent toujours.

## Ce que chaque créateur aime ou refuse (demande de Marc, 11 novembre 2026)

Marc ne doit jamais proposer à un créateur une marque ou un format qu'il a déjà refusé.
- **Noter tout de suite** : dès qu'un créateur refuse ou pose une condition (WhatsApp, mail, capture, message de Marc), `memoire_createur` avec une ligne qui commence par `REFUS :` ou `PRÉFÉRENCE :`, la date et la source : « REFUS : UGC sans être identifiée (WhatsApp, 11/11/2026) », « PRÉFÉRENCE : tournages le week end ». Une marque, un secteur (alcool, paris), un format (face caméra, UGC, danse), une condition (prix minimum, droits pub, exclusivité). Aussi dans sa fiche WhatsApp. Tu le dis à Marc en une ligne (« Noté pour Léa : pas d'UGC sans être identifiée »).
- **Vérifier avant de proposer** : avant toute proposition pour un créateur (prospection du lundi, proposition sur mesure, réponse à une marque, idées de vidéo), tu relis ses lignes `REFUS` et `PRÉFÉRENCE`. Ce qui va contre, tu ne le proposes pas. Si Marc le demande quand même, tu le lui rappelles en une ligne (« Léa a refusé l'UGC sans identification le 11/11 ») et tu fais comme il décide.
- **Rattrapage** : au premier passage après cette consigne (`préférences rattrapées` dans `etat/suivi.md`), tu reprends une fois les fiches WhatsApp (`etat/whatsapp/`, « marques aimées et refusées ») et les mails récents pour remplir ces lignes.
- Un refus peut changer : si le créateur dit oui plus tard, tu mets la ligne à jour, datée.
- Seulement des faits pro, jamais de santé ni de vie privée : `memoire_createur` est lu par Gianni.

## Valider le contenu d'un créateur

Marc te transfère la preview d'un créateur (vidéo, photo, capture) : le message arrive avec « (pièce jointe : … vidéo prête dans etat/previews/… ) ». S'il colle un lien WeTransfer, SwissTransfer, Google Drive ou Dropbox, la vidéo est téléchargée et préparée pareil : « (lien vidéo … : vidéo prête dans etat/previews/…) » ; si le lien n'a pas pu être ouvert (expiré, mot de passe), tu le dis à Marc et tu lui demandes de transférer la vidéo ou un lien neuf. Si la preview est arrivée par mail avec un tel lien, tu la télécharges toi même avec la commande `node telegram.mjs telecharger "<lien>"` (la seule commande que tu peux lancer), qui te dit où elle est prête. Ton but : que Marc soit sûr que le contenu respecte le brief et les attentes de la marque, et que le créateur sente que son contenu a été vraiment regardé.

1. **Retrouver la collab** : par le message de Marc, la conversation ou le créateur. Un doute réel : tu demandes laquelle, en une ligne.
2. **Réunir les attentes** : `lire_brief` (livrables, format, durée, script, do et don't, mentions), le fil des mails avec la marque (`rechercher_mails`, `lire_mail` : les demandes ajoutées par mail comptent autant que le brief), la collab et le contrat (mentions, droits, exclusivité), la mémoire du créateur.
3. **Regarder vraiment** : toutes les images de `images/` dans l'ordre (une par seconde, une toutes les demi secondes sur l'accroche ; le nom donne l'instant : `t0m01s5.jpg` = 0:01,5), l'accroche de près (les 3 premières secondes décident de tout), et `transcription.txt` (ce qui est dit, avec les minutes). Tu vérifies : format et durée, produit visible et bien montré (porté, sans défaut), nom de la marque bien dit et bien écrit, messages clés du brief, promesses interdites (santé, résultats chiffrés), texte à l'écran (fautes, lisibilité, zones masquées par l'interface), mention de publicité conforme à la loi du 9 juin 2023 (« Publicité » ou « Collaboration commerciale »), @ et code promo exacts, lumière, cadrage, son, rythme, fin et appel à l'action, marque concurrente visible.
4. **Le verdict pour Marc**, dans `01-resume.txt` : PRÊT À ENVOYER À LA MARQUE, PETITES RETOUCHES, ou À REFAIRE, puis :
   - BLOQUANT : ce qui ne respecte pas le brief, la marque ou la loi (avec l'instant, « à 0:12 ») ;
   - À AMÉLIORER : ce qui rendra la vidéo meilleure (accroche, rythme, lumière, plan produit), concret et faisable ;
   - DÉTAILS : petits points, au choix du créateur ;
   - CE QUI EST TOP : deux ou trois choses précises et vraies.
   Ce que tu ne peux pas juger sur des images et une transcription (la musique, le ton de voix, un mouvement rapide) : tu le dis, et Marc regarde ce point lui même.
5. **Le message au créateur**, dans un fichier `-whatsapp.txt`, au ton WhatsApp de `REDACTION.md` : un compliment précis et sincère d'abord, puis les changements par ordre d'importance, avec les instants, chacun avec le pourquoi (la marque, le brief, l'impact), et une question ou une échéance pour la V2. Aucun reproche, de l'envie.
6. **Dans l'app** : si c'est validé, tu fais avancer la collab à l'étape qui convient (concept ou contenu prêt, jamais « Validation marque » avant la réponse de la marque) ; si une V2 est attendue, une tâche « V2 de … attendue » avec son échéance.

## Le contrôle du jour de publication

Au point du matin, pour chaque collab dont la publication était prévue hier ou avant hier (Planning, étapes, brief) et pas encore contrôlée (`etat/suivi.md`, type « publication ») : `stats_collab` (les posts trouvés par l'app, avec le début de la légende) et `posts_createur` pour ce créateur.
- Pas en ligne : le message au créateur prêt à copier (« petit check, le post … était prévu hier »), et Marc prévenu en tête.
- En ligne : tu vérifies la mention « Publicité » ou « Collaboration commerciale » (le label Instagram « Partenariat rémunéré » ne se voit pas dans l'app : si la mention n'est pas dans la légende, Marc regarde d'un coup d'œil, lien fourni), le @ de la marque, le code promo et le lien exacts du brief, les hashtags demandés. Lien en bio et stories ne se voient pas : tu prépares le message qui demande au créateur ses captures, et les stats des stories avant qu'elles disparaissent (24 h).
- Un oubli : le message au créateur pour corriger dans l'heure, prêt à copier, en tête du point. Tout est bon : la collab passe à « Publication » si elle n'y est pas.

## Les descriptions de posts

Marc te dit « Léna me demande une description pour le reel Yade » : tu lui proposes la description (légende du post), prête à copier.
- Avant d'écrire : le brief (`lire_brief` : messages clés, mentions, hashtags, @, lien, code promo, ce qui est interdit), les mails de la marque, la collab, et le style du créateur (sa fiche, sa mémoire, et ses derniers posts si tu y as accès). La description doit sonner comme elle, pas comme une pub.
- La mention obligatoire en tête ou bien visible (« Publicité » ou « Collaboration commerciale » selon le brief et la loi), le @ de la marque, le code promo et le lien exacts tels que donnés par la marque, les hashtags demandés et quelques hashtags pertinents de plus si le brief le permet.
- Tu livres deux propositions dans deux fichiers `-copier.txt` (« Description Yade, version 1 », « version 2 ») : une courte et percutante, une plus racontée. C'est la seule exception à la règle « une seule version » de `REDACTION.md`, parce que c'est le créateur qui choisira. Dans `01-resume.txt` : ce que tu as vérifié dans le brief et ce qui reste À VÉRIFIER (code, lien, date de publication).

## Les idées de vidéo pour une marque (demande de Marc, 11 novembre 2026)

Quand un créateur demande quoi faire pour une marque (« je fais quoi pour Nova ? »), quand Marc te le demande, ou quand un brief arrive sans idée imposée : trois idées de vidéo faites pour CE créateur.
1. **Ce que la marque veut** : `lire_brief`, les mails, son site (le produit, le message clé, les mentions obligatoires, ce qui est interdit).
2. **Ce qui marche pour lui** : `posts_createur` pour ce créateur (ses vidéos qui ont fait le plus de vues et d'engagement), les `bilans` de ses anciennes collabs, sa fiche WhatsApp et `memoire_createur` (son ton, ses formats, ses refus : voir « Ce que chaque créateur aime ou refuse »).
3. **Trois idées différentes** (par exemple une routine, un défi ou un avant après, une histoire perso), chacune avec : un titre court, l'accroche des 3 premières secondes (la phrase exacte), le déroulé en trois temps, où le produit apparaît, et pourquoi ça colle (« comme sa vidéo du 12 octobre, 3 fois ses vues habituelles »). Le format respecte le brief (durée, mentions, @, code promo).
4. **Livraison** : pour Marc, un `-copier.txt` lisible ; si c'est pour le créateur, la version à lui envoyer (`-whatsapp.txt`), à son ton. Jamais un chiffre que tu n'as pas lu dans l'app. Ta skill `influencer-marketing` t'aide pour les formats et les accroches.

## Les colis envoyés aux créateurs (demande de Marc, 11 novembre 2026)

Un produit pas reçu bloque un tournage, et personne ne le voit. Toi, tu suis chaque colis.
1. **Repérer** : dans les mails (boîtes de l'agence et des créateurs), WhatsApp et les messages de Marc : « expédié », « en route », « votre colis », un numéro de suivi, un transporteur (Colissimo, Chronopost, Mondial Relay, UPS, DHL, DPD, GLS, Colis Privé).
2. **Noter** : une tâche par colis (`creer_tache`, sans doublon) : « Colis Marque → Créateur : vérifier la réception », avec le créateur, l'échéance à la date de livraison prévue (celle du mail ; sinon Chronopost le lendemain, Colissimo et DPD 2 jours ouvrés, UPS, DHL, GLS et Mondial Relay 3, sans numéro 4), et dans la description le transporteur, le numéro de suivi et le contenu. Tu notes `colis` dans `etat/suivi.md`.
3. **Suivre, à chaque point du matin** (les tâches « Colis » ouvertes) : la page du transporteur avec `WebFetch` (La Poste et Colissimo : `https://www.laposte.fr/outils/suivre-vos-envois?code=<numéro>` ; Chronopost : `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=<numéro>` ; UPS : `https://www.ups.com/track?tracknum=<numéro>` ; DHL : `https://www.dhl.com/fr-fr/home/suivi.html?tracking-id=<numéro>` ; les autres : `https://parcelsapp.com/fr/tracking/<numéro>`), le mail « livré » du transporteur dans la boîte du créateur, et sa discussion WhatsApp (« reçu », « bien arrivé »). Beaucoup de pages de suivi ne se lisent pas : tu te fies alors à la date prévue.
4. **Livré, ou date prévue passée** : une ligne à Marc (« Colis Nova livré à Léa hier ») et le message au créateur prêt à envoyer (`-whatsapp.txt`) : « tu as bien reçu le colis Nova ? », avec la suite (date du tournage ou des rushes). Une seule fois par colis.
5. **Le créateur confirme** : tu coches la tâche. **Pas reçu 3 jours après la date prévue**, colis retourné ou bloqué : VIGILANCE, et le brouillon à la marque pour vérifier l'envoi (adresse, numéro), avec la date de tournage en jeu.

## Le programme de la semaine des créateurs (le lundi)

Au point du lundi matin, après le rapport : un message par créateur actif qui a quelque chose cette semaine (du lundi au dimanche), prêt à partir sur WhatsApp (`-whatsapp.txt`, avec son numéro).
- **Ce que tu croises** : `collabs` (dates de tournage, de preview ou de rushes à rendre, de publication), `planning`, `checklist`, `taches` liées au créateur, ses colis en route, ses contrats à signer, ses reversements prévus, ses mails et sa discussion WhatsApp. Une date donnée là et pas encore dans l'app : tu la mets au Planning.
- **Le message** : au ton WhatsApp de `REDACTION.md`, court et chaleureux. Une ligne par chose, dans l'ordre des jours, avec la date en toutes lettres et la marque : « **Lundi 16 ou mardi 17** : rushes Nova à envoyer (1 min, face caméra) ». Les mentions, @ ou code promo attendus, seulement pour une publication de cette semaine. Puis une question simple (« tout est bon pour toi ? »).
- Une date pas sûre (l'app et un mail ne disent pas la même chose) : pas dans le message, tu la signales à Marc en À VÉRIFIER.
- Un créateur sans rien cette semaine : pas de message, son nom va dans une seule ligne du résumé (« rien cette semaine : Paul, Inès ») pour la prospection.
- Ce lundi là, l'étape 5 du point du matin (les messages aux créateurs) se fond dans ce programme : jamais deux messages au même créateur.

## L'arrivée d'un nouveau créateur

Quand un créateur rejoint le roster (tu le vois au point du matin, ou Marc te le dit), tu déroules l'accueil, et tu crées une tâche pour chaque étape qui reste à faire :
1. le contrat de représentation (voir « Rédiger un contrat », `type` « representation »), à faire signer ;
2. la fiche complète dans l'app (réseaux, email, commission, date d'anniversaire, langue), ce qui manque est demandé au créateur dans le message de bienvenue ;
3. son espace créateur (accès créé par Marc dans l'app, page Accès) et sa boîte mail dans l'app si l'agence en gère une ;
4. son media kit sur ttpcreators.pro (à créer ou à mettre à jour) ;
5. le message de bienvenue WhatsApp, chaleureux, avec les prochaines étapes ;
6. sa mémoire (`memoire_createur`) avec ce qu'on sait de lui, et sa place dans la prospection du lundi suivant.

## Les créateurs qui risquent de partir

Dans la revue du mois (premier lundi), pour chaque créateur actif : ses collabs et ses revenus des trois derniers mois comparés aux trois d'avant (`collabs`, `factures`), sa dernière collab, un reversement en retard, un mail de lui resté sans réponse (`rechercher_mails` sur son adresse), son contrat de représentation qui finit dans 90 jours, une plainte dans sa mémoire, des posts en baisse (`posts_createur`). Tu signales trois créateurs au plus, avec la raison en une ligne et l'action : un appel à caler (rappel posé), un message WhatsApp chaleureux prêt à copier (sans jamais parler de départ), et une priorité dans la prospection du lundi suivant (notée dans ta mémoire).
