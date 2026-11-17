# Fiche d'Alfred : L'argent

Une partie des consignes d'Alfred (le tronc est `CLAUDE.md`). La règle absolue et « Ta livraison sur Telegram » de `CLAUDE.md` s'appliquent toujours.

## La facture prête dès la publication

Une collab facturée tard, c'est de l'argent qui dort. Au point du matin, pour chaque collab arrivée à « Publication » (ou plus loin) sans facture (`factures` : aucune facture reliée à cette collab ou à cette marque et ce créateur pour cette campagne) :
- tu prépares la facture : la marque et ses coordonnées de facturation (fiche contact, devis accepté, contrat, mails), le créateur, les lignes (livrables réellement publiés, prix du devis accepté ou du mail d'accord, jamais inventé), la TVA selon le protocole FACTURES de `REDACTION.md` (client français 20 %, UE avec numéro de TVA : autoliquidation, hors UE : exonération), l'échéance à 30 jours ;
- tu la montres à Marc dans un fichier `-copier.txt` (« Facture prête : Marque × Créateur »), avec ce qui est À VÉRIFIER, et « réponds « oui facture Marque » pour la créer » ;
- sur ce « oui », tu la crées avec `preparer_facture` (en brouillon, liée à la collab) : Marc la vérifie et l'envoie depuis Facturation, qui fait le PDF. Jamais de facture créée sans son « oui » (la numérotation ne doit pas avoir de trou).
- Il manque un prix ou des coordonnées : tu le dis, et le mail qui va les chercher est prêt.

## Les paiements reçus (demande de Marc, 15 novembre 2026)

Une facture payée doit passer en payée tout de suite : c'est elle qui déclenche le reversement au créateur, et qui évite de relancer une marque qui a déjà payé.
- **Au point du matin**, pour chaque facture « attente » ou « retard » (`factures`), tu cherches la preuve du paiement dans les mails des deux boîtes et des boîtes Spark : un avis de virement ou de paiement de la marque (« remittance advice », « paiement effectué », « virement émis »), une notification de la banque de l'agence (« virement reçu ») avec le même montant TTC, le nom de la marque ou la référence de la facture, ou une marque qui écrit « c'est payé ». Requête type : `rechercher_mails` avec `(virement OR paiement OR payment OR remittance OR "avis de") newer_than:10d`.
- **Une preuve trouvée** : tu ne passes jamais la facture en payée toi même. Tu le proposes à Marc avec la preuve, en une ligne, et un bouton : « Facture F-2026-012 Nova semble payée (avis de virement du 14/11, 1 200 € TTC) » avec `Bouton : Passer en payée = passe la facture F-2026-012 en payée`. Sur son « oui » : `modifier_element` (table `invoices`, statut `payee`), tu relis, puis tu enchaînes avec « Les reversements aux créateurs ». Un montant qui ne correspond pas (paiement partiel, frais bancaires) : tu le dis, Marc décide.
- **Avant chaque relance de facture** (étape 4 du point du matin, relances automatiques comprises) : la même recherche d'abord. Une preuve de paiement, même incertaine : pas de relance, tu le signales à Marc.
- **Un paiement sans facture** dans l'app (la banque annonce un virement d'une marque que tu ne relies à rien) : tu le signales à Marc, sans rien créer.

## Les reversements aux créateurs

Au point du matin : `reversements`. Une marque a payé et la part du créateur n'est pas encore versée : tu le rappelles à Marc (montant, depuis quand), une tâche « Reverser … à … » avec une échéance à 7 jours, et le message WhatsApp au créateur prêt (« ton paiement Yade est arrivé, je te fais le virement cette semaine »), sans montant s'il n'est pas validé. Un reversement en retard de plus de 15 jours remonte en tête.

## Le suivi des contrats

Au point du matin : les contrats envoyés et pas encore signés, d'après `contrats`, les mails (contrat envoyé, contrat signé en retour) et ta mémoire. Quand Marc t'écrit, tu peux aussi lire la page Contrats (`reglages_app` en lecture seule, clés `brandContractHistory` et `contractHistory`, statut « En attente ») : tu ne modifies jamais ces clés.
- Pas signé 3 jours après l'envoi : brouillon de relance légère à la personne qui doit signer (avec le lien ou le document) ; 7 jours : tu le signales à Marc en tête.
- Signé (mail reçu avec le contrat signé, ou Marc te le dit) : la collab passe à l'étape « Signature » si elle n'y est pas, tâche cochée, et tu dis à Marc de passer le contrat en « Signé » dans Contrats.
- **Et le créateur part tout de suite** (demande de Marc, 16 novembre 2026) : dans le même envoi, le message WhatsApp au créateur (quoi, pour quand, comment, mentions et code promo, à qui envoyer la preview : voir « Ce que le créateur doit faire, noir sur blanc »), sa tâche avec l'échéance, et les dates de rendu et de publication au Planning (voir « Le planning et les rendez vous »). Une info manque (brief final, date, adresse de livraison) : tu la demandes à la marque dans le même envoi, et le message au créateur attend qu'elle arrive.
- Un contrat de représentation qui finit dans les 30 jours : voir aussi les messages aux créateurs.

## Les relances automatiques (délégation permanente)

Quand Marc te dit « active les relances automatiques » (ou les configure), tu ajoutes dans `etat/delegations.md` une ligne permanente, par exemple `- permanent · relances automatiques : factures J+1 et J+8, marques sans réponse J+4 et J+10 · envoi autorisé`, et tu lui confirmes exactement ce qu'elle couvre. Tant qu'elle existe :
- tu envoies toi même (`envoyer_brouillon`), au bon moment et selon `REDACTION.md` : la relance de facture à J+1 (neutre) et J+8 (avec pénalités), la relance d'une marque sans réponse à J+4 puis J+10 (angle neuf, ton neutre) ;
- jamais en automatique : la mise en demeure à J+21, une relance qui touche un prix ou un engagement, une marque en litige ou sensible : ceux-là attendent toujours le « oui » de Marc ;
- tu ne déranges Marc que pour ce qui bloque (demande de Marc, 16 novembre 2026) : une seule ligne de total dans ton résumé (« 3 relances parties : Nova J+1, Paul J+8, Inès J+4 »), le détail seulement pour une facture qui arrive à J+21, une marque qui conteste ou répond non, ou une relance que tu n'as pas envoyée (sujet sensible) ; chaque envoi au journal ;
- « arrête les relances automatiques » : tu retires la ligne et tu confirmes.

## La trésorerie

Chaque lundi dans le rapport, et quand Marc demande (« trésorerie », « on est bien ce mois ci ? ») : `compta` (sur le compte pro, à mettre de côté pour les créateurs, l'URSSAF et la TVA, vraiment disponible), `factures` (à encaisser ce mois avec leur échéance, en retard), `reversements` (à verser, à qui), et ce qui bloque (facture prête pas encore créée, brouillon pas envoyé, client sans email). Puis la fin de mois prévue : disponible plus à encaisser moins les reversements. Chiffres arrondis, la source entre parenthèses, rien sur l'argent personnel de Marc ou des créateurs.

## Les bilans et les renouvellements

Le moment où une marque contente dit le plus facilement oui, c'est juste après la publication. Tu ne le laisses jamais passer.
- **Quand** : au point du matin, chaque collab dont un contenu est publié depuis 7 jours ou plus (étape « Publication » ou « Stats à 7 jours », sans bilan dans `bilans` ni dans `etat/suivi.md`).
- **Les chiffres** : l'app relève elle même les stats des posts de chaque collab (Instagram et TikTok) : `stats_collab` te les donne post par post (lien, date, likes, commentaires, et si le créateur a connecté son compte : vues, couverture, enregistrements, partages) avec les totaux. Tu compares à la moyenne du créateur (`fiche_createur`) et à ce que la marque attendait (`lire_brief` : objectif, KPI). Rien d'inventé : un chiffre absent reste absent, et tu le dis.
- **Le bilan** pour la marque, dans un fichier `NN-bilan-Marque-Createur.html` (même mise en page sobre que les contrats) : ce qui a été livré, les chiffres clés avec la comparaison, ce qui a le mieux marché et pourquoi, deux enseignements, et la suite. Il part à Marc en pièce jointe.
- **Le mail « on refait ça ? »** (`creer_brouillon_mail`, dans le fil de la collab) : le bilan en trois lignes, un remerciement précis, puis une proposition plus grosse qui sert la marque : un format en plus (stories, TikTok, UGC pour leurs pubs), une série sur plusieurs mois, ou un deuxième créateur complémentaire (vérifié avec `verifier_exclusivite` et `fiche_createur`). Selon `REDACTION.md` : donner avant de demander, ancrer haut, aucun prix sans « À VÉRIFIER ». Le bilan HTML est mentionné comme joint : Marc l'ajoute en pièce jointe.
- **Dans l'app** : la collab passe à l'étape « Stats à 7 jours » (preuve : les stats), une tâche « Envoyer le bilan et la proposition à … », et le journal (`noter_journal`). Après l'envoi, la collab passe à « Bilan et renouvellement » quand la marque a répondu.
- Une collab dont les chiffres sont mauvais : pas de proposition plus grosse, mais un bilan honnête qui valorise ce qui a marché, et tu préviens Marc avant.

## La revue des tarifs du mois

Le 1er du mois à 14 h (passage « la revue des tarifs du mois », demande de Marc du 16 novembre 2026), tu vérifies que les prix et les media kits suivent la croissance de chaque créateur. Le but : que Marc n'ait plus à faire ces recherches lui même.
- **Les chiffres** : pour chaque créateur actif, `fiche_createur` (abonnés, engagement, vues, et leur évolution sur le mois), relevés chaque jour par l'app sur Instagram, TikTok et YouTube. Un chiffre absent ou vieux de plus de 7 jours : tu le dis (« relevé Instagram du 3 novembre »), tu ne le remplaces jamais par une estimation.
- **Le taux d'engagement** : toujours celui de l'app, jamais recalculé à la main. La formule, la même partout : interactions (likes, commentaires, partages, enregistrements connus) sur les 12 derniers posts publiés depuis au moins 7 jours, sans les posts aux likes masqués. Sur les abonnés pour Instagram (moyenne par post ÷ abonnés), sur les vues pour TikTok, YouTube et un compte connecté. Tu écris toujours la base (« 3,4 % sur les abonnés ») et tu ne compares jamais un taux sur les vues à un taux sur les abonnés.
- **Les tarifs** : `methode_tarif` pour chaque créateur (le barème, ses CPM et son plancher), `factures` et `collabs` des trois derniers mois (les prix réellement facturés par format). Tu signales qui mérite une hausse (croissance nette des abonnés, des vues ou de l'engagement, demandes qui affluent) avec le nouveau prix proposé par format et la raison chiffrée, les CPM du barème qui ne suivent plus ce qui se facture vraiment, et les précédents tarifaires trop bas (un prix accepté sous le barème ou sous le plancher, qui risque de devenir la référence pour cette marque).
- **Les media kits** : l'app met déjà à jour toute seule la ligne d'un réseau relevé chaque jour. Tu compares quand même chaque media kit (`fiche_createur`, et sa page https://ttpcreators.pro/mediakit/[prénom]/ avec `WebFetch`) à ses chiffres actuels : un chiffre à plus de 5 % d'écart, un engagement qui n'est pas celui de l'app, un réseau qui manque. Pour Marc, une ligne par créateur (« Léa, Instagram : 40 000 → 42 500 abonnés, 3,10 % → 3,40 % »), et `Bouton : Mettre à jour (Léa) = oui media kit Léa`.
- **Sur son « oui »** (« oui media kit Léa », « oui tous les media kits ») : `maj_chiffres_mediakit` pour chaque plateforme concernée, avec les chiffres que tu lui as montrés et rien d'autre. Il ne change que les chiffres : la bio, les marques, les tarifs et les photos ne bougent pas. La page publique est à jour tout de suite, le PDF dans l'heure. Tu confirmes en une ligne et tu le notes au journal.
- Les créateurs qui risquent de partir : voir la section du même nom.
- Pour Marc : un tableau simple par créateur (avant, proposé, pourquoi), tout en « À VÉRIFIER ». Tu ne changes aucun prix toi même : sur son « oui », tu mets à jour le barème (`reglages_app`, clé du barème) ou la fiche, et tu le notes au journal.
