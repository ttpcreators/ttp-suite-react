# Compta de l'agence en micro-entreprise

Synthèse des règles utilisées par la page **Compta** (`src/views/Compta.tsx`, calculs
`src/lib/compta.ts`, taux `src/lib/comptaRates.ts`). Sources officielles consultées le
**29 octobre 2026**. Ce n'est pas un avis comptable : chaque point marqué « à confirmer »
se valide avec un expert-comptable.

## Cotisations sociales (en % du chiffre d'affaires encaissé)

| Activité | Cotisations | Avec versement libératoire | Formation (CFP) |
|---|---|---|---|
| Prestations de services commerciales (BIC) | 21,2 % | 22,9 % | 0,1 % |
| Activité libérale non réglementée (BNC) | 25,6 % | 27,8 % | 0,2 % |
| Libéral réglementé Cipav (pour mémoire) | 23,2 % | 25,4 % | 0,2 % |

- Taux : [service-public.gouv.fr, F36232](https://entreprendre.service-public.gouv.fr/vosdroits/F36232) (page « vérifiée le 1er janvier 2026 »).
- Formation professionnelle : [service-public.gouv.fr, F23459](https://entreprendre.service-public.gouv.fr/vosdroits/F23459) : 0,1 % commerce, 0,3 % artisanat, 0,2 % libéral.
- Déclaration et paiement chaque mois ou chaque trimestre, au plus tard à la fin du mois qui suit la période (l'app compte « à mettre de côté » les périodes dont cette date n'est pas passée).

**Catégorie de l'agence : à confirmer.** Une agence d'influence qui touche des commissions
sur les contrats de ses talents fait de l'intermédiation ; selon la façon dont l'activité a été
déclarée (commerciale BIC ou libérale BNC), le taux est 21,2 % ou 25,6 %. Aucune source
officielle consultée ne tranche pour ce métier. L'app part sur **BNC (25,6 %)**, le taux le plus
prudent, modifiable dans les réglages. Le vrai taux est celui de l'attestation URSSAF de l'agence.

## Seuils

- **Micro-entreprise** : 83 600 € HT de chiffre d'affaires pour les services (BIC) et le libéral
  (BNC), 203 100 € pour la vente. On ne sort du régime qu'après deux années de suite au-dessus.
  [service-public.gouv.fr, F32353](https://entreprendre.service-public.gouv.fr/vosdroits/F32353).
- **Franchise en base de TVA** (services, 2026, inchangée) : 37 500 € de CA l'année précédente
  (au-delà : TVA au 1er janvier suivant) ; seuil majoré 41 250 € sur l'année en cours (au-delà :
  TVA dès le jour du dépassement). Mention obligatoire sur les factures : « TVA non applicable,
  art. 293 B du CGI ». [service-public.gouv.fr, F21746](https://entreprendre.service-public.gouv.fr/vosdroits/F21746).

## Ce qui compte dans le chiffre d'affaires de l'agence

L'agence encaisse parfois pour le compte du créateur. Ce qui compte dans SON chiffre d'affaires
dépend de la façon dont elle facture la marque :

- **Elle facture en son nom** (intermédiaire « opaque », comme les factures de l'app aujourd'hui :
  émetteur TTP Creators, facturé à la marque) : elle est réputée avoir réalisé toute la prestation.
  Tout le HT est son chiffre d'affaires (cotisations, seuils, TVA sur le total si assujettie).
- **Elle facture au nom et pour le compte du créateur** (intermédiaire « transparent », mandat
  écrit) : seule sa commission est son chiffre d'affaires ; la part du créateur passe en compte
  de tiers.

Sources : [BOI-TVA-CHAMP-10-10-40-40](https://bofip.impots.gouv.fr/bofip/323-PGP.html/identifiant=BOI-TVA-CHAMP-10-10-40-40-20210813)
(intermédiaires agissant en leur nom ou au nom d'autrui),
[BOI-TVA-BASE-10-10-30](https://bofip.impots.gouv.fr/bofip/488-PGP.html/identifiant=BOI-TVA-BASE-10-10-30-20220511)
(débours exclus de la base s'ils sont engagés au nom et pour le compte du mandant),
[BOI-TVA-DECLA-30-20-10-30](https://bofip.impots.gouv.fr/bofip/13244-PGP.html/identifiant=BOI-TVA-DECLA-30-20-10-30-20220629)
(mandat de facturation : « facture établie par A au nom et pour le compte de B »).

**À confirmer** : le régime réel de l'agence. L'écart est énorme : en facturant en son nom,
quelques collabs suffisent à dépasser 37 500 € et donc la franchise de TVA. Réglage « Factures
aux marques » de la page Compta.

## Ce que l'app calcule

- **Sur le compte pro** : factures payées encaissées par l'agence (TTC) + factures de commission
  payées par les créateurs, moins les versements aux créateurs (page Reversements). Solde
  théorique : les autres dépenses et rentrées de l'agence n'y sont pas.
- **À mettre de côté** : part des créateurs pas encore versée ; cotisations des périodes pas
  encore échues ; TVA encaissée sur ces périodes.
- **Vraiment disponible** = solde − à mettre de côté.
- **Ce que je prends** (par collab) : commission HT, cotisations, net.
- **Deux façons d'encaisser** par collab (fiche collab) : l'agence encaisse puis reverse, ou le
  créateur encaisse et l'agence lui facture sa commission (« Créer la facture » prépare la bonne).
  Défaut : le « mandat d'encaissement » du contrat de représentation du créateur, sinon l'agence.

**Limite** : l'app ne connaît pas la date réelle des virements (pas de colonne « payée le ») ; une
facture compte à sa date d'émission, sinon à son échéance.
