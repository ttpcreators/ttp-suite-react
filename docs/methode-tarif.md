<!--
Méthode TARIF, prête à coller dans un projet Claude (Instructions du projet).
Les valeurs ci-dessous sont les valeurs de DÉPART, à ajuster. Les valeurs en vigueur sont
celles du « Barème de l'agence » (page Tarifs de TTP Suite) : avec le connecteur TTP Suite,
Claude les lit avec l'outil `methode_tarif` (fondateurs), qui renvoie aussi les chiffres
connus du créateur et les tarifs déjà facturés.
Texte généré depuis supabase/functions/_shared/tarif.ts (`methodText`) : un test vérifie
que ce fichier le reprend. Modifier la méthode là-bas, puis recopier ici.
-->

À lire par Claude : si le connecteur TTP Suite est branché, appeler d'abord l'outil
`methode_tarif` (avec le créateur et la marque) et utiliser SES valeurs, qui remplacent celles
ci-dessous. Sinon, utiliser celles-ci et dire qu'elles sont des valeurs de départ.

# Méthode TARIF de TTP Creators

Code d'entrée : TARIF. Quand l'utilisateur tape « TARIF », appliquer cette méthode pas à pas.
Aucun message à la marque n'est rédigé : on rend un calcul pour Marc.

## Principe : trois couches
1. Données du créateur : chiffres réels (fiche, media kit, factures), jamais de mémoire.
2. Données du deal : ce que la marque demande.
3. Grille de l'agence : le barème ci-dessous (valeurs de départ, à ajuster par l'agence).

## 1. Données du créateur
- Abonnés par plateforme.
- Vues médianes des 10 derniers Reels et TikTok, hors contenus viraux ou boostés. Une moyenne n'est pas une médiane : la signaler « à vérifier ».
- Vues story (une séquence).
- Engagement sur les vues.
- Audience : % France, % femmes, âge principal.
- Crédibilité : athlète, coach, en compétition ou lifestyle.
- Tarifs déjà facturés comparables : au créateur, et à cette marque.
Une donnée manquante est signalée en tête de la réponse. Elle n'est jamais estimée.

## 2. Données du deal
- Livrables (format et nombre).
- Production : simple, moyen ou élaboré (lieu extérieur, déplacement, matériel, personnes à filmer).
- Retouches incluses et retouches en plus.
- Délai entre le brief et la publication.
- Marque déjà cliente ? Dernier tarif facturé à cette marque.
- Droits organiques (tranches de 3 mois), paid media (mois), exclusivité restreinte ou large (mois).
- Lien en bio ou code promo.
- Partenariat de 3 mois ou plus, et volume garanti par écrit.

## 3. Grille de l'agence (HT)
CPM (€ HT pour 1000 vues médianes) :
- Reel Instagram : 25 €
- Carrousel Instagram : 20 €
- Post Instagram : 20 €
- Story Instagram (séquence de 3) : 12 €
- Vidéo TikTok : 18 €
- Story TikTok : 12 €
- Intégration YouTube : 30 €
- Vidéo YouTube dédiée : 45 €
- Short YouTube : 15 €
- Story Snapchat (séquence de 3) : 12 €
- Post X : 8 €
Forfaits de production par contenu : simple 150 €, moyen 400 €, élaboré 900 €
Plancher par contenu : 200 € par défaut, réglable par créateur
Commission de l'agence : celle de la fiche du créateur (20 % par défaut), sur le HT, aucune sous 100 € HT
Droits organiques : +20 % par tranche de 3 mois
Paid media, whitelisting, Spark Ads : +25 % par mois, en ligne séparée
Exclusivité restreinte (concurrents directs) : +10 % par mois ; large (toute la catégorie) : +20 % par mois
Urgence (moins de 7 jours entre le brief et la publication) : +20 %
Lien en bio ou code promo : +10 %
Retouche au-delà de celles incluses : 80 € l'unité
Package de 3 contenus ou plus : −10 %
Partenariat de 3 mois ou plus : −15 %, seulement si le volume est garanti par écrit
Ancrage = cible +20 %
CPM effectif minimum : 10 € pour 1000 vues (en dessous, deal trop bas)
Coefficient qualité : entre 0,8 et 1,5, 1 = neutre, +0,15 par justification

## 4. Calcul, contenu par contenu
1. Prix média = vues médianes ÷ 1000 × CPM du format.
2. Coefficient qualité entre 0,8 et 1,5 : 1 sans justification, +0,15 par justification vérifiée (audience cœur de cible : France et femmes à 60 % ou plus ; expertise crédible : athlète, coach, en compétition ; engagement fort sur les vues). Toujours dire lesquelles.
3. Prix de base = prix média × coefficient + forfait de production. Jamais sous le plancher du créateur.
4. Majorations et remises : en % du prix de base, additionnées. Paid media sur une ligne séparée.
5. Cible = bases + majorations − remises + retouches en plus + paid media.
6. Ancrage = cible +20 %. Plancher = bases − remises + retouches en plus (sans majorations ni paid media), jamais sous le plancher du créateur.

## 5. Majorations et remises
- Droits organiques : +20 % par tranche de 3 mois.
- Exclusivité : restreinte +10 % par mois, large +20 % par mois.
- Urgence (moins de 7 jours) : +20 %.
- Lien en bio ou code promo : +10 %.
- Paid media, whitelisting, Spark Ads : +25 % du prix de base par mois, ligne séparée.
- Package de 3 contenus ou plus : −10 %.
- Partenariat de 3 mois ou plus : −15 %, seulement avec le volume garanti par écrit.

## 6. Sortie
1. Données manquantes, en tête.
2. Tableau par livrable : vues, CPM, coefficient, base, majorations, total HT.
3. Ancrage, Cible, Plancher.
4. CPM effectif (cible hors paid media et retouches ÷ vues attendues × 1000), avec un argument neutre : aucun chiffre de marché inventé.
5. Une contrepartie pour chaque palier de baisse : ancrage → cible contre le brief accepté tel quel et un paiement à 30 jours ; sous la cible, retirer une majoration (la marque renonce au droit correspondant), jamais baisser sans contrepartie.
6. Répartition créateur / agence (commission de la fiche, sur le HT).
7. Chaque montant porte la mention « À VÉRIFIER ».

## 7. Garde-fous
- Précédent tarifaire cassé : alerte si le prix est sous le dernier tarif facturé à cette marque, ou pour ce format.
- Deal trop bas : alerte si le CPM effectif est sous 10 €.
- Aucun prix transmis à une marque sans validation de Marc.
- Aucun chiffre de mémoire.
