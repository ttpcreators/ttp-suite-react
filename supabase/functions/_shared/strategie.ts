// ============================================================================
// _shared/strategie.ts : la stratégie commerciale de l'agence, en un seul endroit.
// ----------------------------------------------------------------------------
// Source : « TTP Creators : stratégie pour signer 10 à 20 k€ de collabs par mois »,
// Gianni, 20 novembre 2026, adoptée par Marc. Lue par Alfred et les assistants (outil
// MCP `strategie`), et rappelée par methode_tarif et preparer_devis. Les chiffres
// changent ici, et nulle part ailleurs. Règles PURES, testées par strategie.test.ts.
// ============================================================================

export const STRATEGIE_VERSION = "2026-11-20";

/** Deal minimum, sauf test stratégique décidé par Marc. */
export const DEAL_MINIMUM_HT = 500;
/** Commission des NOUVEAUX contrats de représentation (les contrats signés ne changent pas). */
export const COMMISSION_NOUVEAUX_CONTRATS = 25;

/** Cibles de montant HT signé par mois (plan 90 jours). */
export const CIBLES_MENSUELLES: { mois: string; montantHT: number }[] = [
  { mois: "2026-12", montantHT: 8000 },
  { mois: "2027-02", montantHT: 12000 },
  { mois: "2027-03", montantHT: 15000 },
];

/** Volumes d'une semaine. */
export const VOLUMES_SEMAINE = {
  mailsOneToOne: 145,
  invitationsLinkedIn: 100,
  dmInstagramMarques: 75,
  whatsappRelations: "10 à 15",
  approchesCreatrices: 25,
  objectif: "10 à 12 réponses positives et 6 à 8 visios",
};

/** Temps forts de l'année et fenêtre où on les pitche (6 à 8 semaines avant). Dates « MM-JJ ». */
export const TEMPS_FORTS: { nom: string; du: string; au: string }[] = [
  { nom: "Résolutions de janvier (sport, nutrition, bien-être)", du: "11-01", au: "01-15" },
  { nom: "Saint-Valentin (couple, beauté, bijoux) : pitcher avant le 15/12", du: "11-15", au: "12-15" },
  { nom: "Printemps beauté et triathlon", du: "02-01", au: "03-31" },
  { nom: "Été", du: "04-01", au: "05-31" },
  { nom: "Rentrée", du: "07-01", au: "08-31" },
];

/** Temps forts à pitcher le jour donné (« AAAA-MM-JJ »). Une fenêtre peut passer le 31 décembre. */
export function tempsFortsDuMoment(jour: string): string[] {
  const md = jour.slice(5, 10);
  return TEMPS_FORTS.filter((t) => (t.du <= t.au ? md >= t.du && md <= t.au : md >= t.du || md <= t.au)).map((t) => t.nom);
}

/** Alerte quand un devis ou un deal est sous le minimum ; null sinon. */
export function alerteDealMinimum(montantHT: number): string | null {
  if (!Number.isFinite(montantHT) || montantHT <= 0 || montantHT >= DEAL_MINIMUM_HT) return null;
  return `⚠ ${Math.round(montantHT)} € HT : sous le deal minimum de ${DEAL_MINIMUM_HT} € HT (stratégie de l'agence). À garder seulement si Marc en fait un test stratégique ; sinon proposer un pack ou une option sur 3 mois.`;
}

/** Règles de prix et d'offre, rappelées par methode_tarif et preparer_devis. */
export const REGLES_OFFRE = `## Règles commerciales de l'agence (stratégie du ${STRATEGIE_VERSION})
- Deal minimum ${DEAL_MINIMUM_HT} € HT, sauf test stratégique décidé par Marc.
- Jamais le prix en premier : on demande le budget, puis on propose 3 options.
- On vend des packs, pas des posts (ex. un Reel, 3 stories et un TikTok). Toujours une option sur 3 mois à côté de l'offre simple.
- Les droits sont facturés en plus : whitelisting +30 % par mois, droits d'usage +25 % pour 3 mois, exclusivité +30 à 50 %.
- Offres : Pack UGC (3 vidéos pour les pubs, 600 à 900 €), Ambassadrice 3 mois (2 500 à 4 500 €), campagne multi-créatrices (3 000 à 8 000 €).
- Plus de gifting seul ; l'affiliation seule est limitée à un test de 30 jours.
- Commission des nouveaux contrats de représentation : ${COMMISSION_NOUVEAUX_CONTRATS} % (les contrats en cours gardent leur taux).`;

const fmt = (n: number) => n.toLocaleString("fr-FR").replace(/ /g, " ");

/** La stratégie complète, en texte, avec ce qui s'applique le jour donné. */
export function strategieTexte(jour: string): string {
  const moments = tempsFortsDuMoment(jour);
  return `# Stratégie de TTP Creators : signer 10 à 20 k€ de collabs par mois
Source : document de Gianni du 20 novembre 2026, adopté par Marc. Rien ne part sans le oui de Marc : tout message passe par la file « À valider ».

## Le cap
- Point de départ : environ 310 € de commission par mois depuis juillet, 2 400 € HT signés en novembre, deal moyen d'environ 800 € HT.
- Cibles de montant HT signé : ${CIBLES_MENSUELLES.map((c) => `${c.mois} ${fmt(c.montantHT)} €`).join(" · ")} (environ 3 300 € de commission en mars).
- Mix visé en mars (≈ 15 100 € HT, 18 deals par mois) : 4 contrats mensuels à 1 000 €, 4 gros deals (plus de 150 000 abonnés) à 1 500 €, 6 deals moyens à 650 €, 4 UGC sans publication à 300 €.
- Ce que ça demande chaque mois : 28 devis, 42 visios ou briefs, 84 discussions ouvertes (35 agences, 25 demandes entrantes, 24 prospection). Roster : 12 à 14 créatrices actives, dont 6 de plus de 150 000 abonnés. Taux à recaler après 4 semaines.

## Ce qui s'applique maintenant (${jour})
- Temps forts à pitcher : ${moments.length ? moments.join(" ; ") : "aucun en ce moment, préparer le suivant"}.

## Qui fait quoi (organisation Gianni / Marc)
- Gianni, acquisition automatisée : prospection des marques et des agences (premiers contacts et toutes les relances, par mail et Instagram, plus LinkedIn), nouveaux contacts (marques qui paient déjà des créateurs, agences), relance de toute la base (513 contacts, dont 231 jamais contactés), recrutement de créatrices sur Instagram et par mail, niche par niche.
- Tous les mails de prospection partent au nom de Marc, avec sa signature : les appels et les visios arrivent directement chez lui.
- Marc, relation et closing : talent manager (suivi des créatrices, briefs, contenus, validation avant publication), visios avec les marques et les agences qui ont répondu puis devis et négociation jusqu'à la signature, appels avec les créatrices à recruter. Plus aucun démarchage mail de son côté : tout passe par Gianni.
- Passage de relais dès qu'un contact montre un vrai intérêt (budget, brief, demande de tarifs ou « ok pour en parler ») : le contact reçoit un lien pour réserver une visio dans l'agenda de Marc, et Marc reçoit une fiche (marque, créatrice, historique, budget). Visio sous 7 jours, devis sous 24 h après la visio.
- Lien de réservation : https://app.ttpcreators.pro/rdv/ (créneaux de Marc réglés dans Paramètres › Rendez-vous). Si la page dit « pas ouverte », proposer deux créneaux et demander à Marc. Une réservation crée toute seule le rendez-vous Meet, l'invitation et la tâche « Visio : marque ».
- Pas de visio pour du gifting ou de l'affiliation seule : on demande d'abord le budget par écrit. Sans intérêt réel, le contact reste chez Gianni, dans les relances.
- Le temps de Marc : 2 demi-journées fixes par semaine pour les visios ; le reste est automatisé au maximum (bilans J+7, factures, rappels aux créatrices).
- Suivi chaque lundi : Gianni (contacts touchés par canal, taux de réponse, contacts passés à Marc, créatrices approchées) ; Marc (visios faites, devis envoyés, deals signés, montant moyen).
- Objectif : plus de visios qualifiées pour Marc, zéro démarchage de son côté, des collabs signées chaque semaine.

## Décisions
1. Commission de ${COMMISSION_NOUVEAUX_CONTRATS} % pour les nouveaux contrats.
2. Deal minimum de ${DEAL_MINIMUM_HT} € HT, sauf test stratégique.
3. Plus de gifting seul ; l'affiliation seule limitée à un test de 30 jours.
4. Nutripure 2027 à négocier dès maintenant, avec une prime d'exclusivité (via Agently), signé avant le 20/12.
5. Chloé Difrancesco : un appel pour savoir si elle reste, sinon elle sort du roster. Lucie et Beverly sont sorties du roster.
6. L'acquisition est la priorité n°1, pour les marques comme pour les créatrices : volumes fixes chaque semaine et par canal.

${REGLES_OFFRE}

## Le roster : recruter des créatrices qui vendent déjà
- Critère : au moins 3 partenariats payés visibles sur 90 jours, active ces 30 derniers jours, pas déjà dans une agence.
- Objectif mars 2027 : 9 recrues, dont au moins 4 de plus de 150 000 abonnés. Niches : sport, running, triathlon (2) ; fitness, Hyrox, UGC (1) ; bien-être, santé, nutrition (1) ; couple (1) ; beauté et lifestyle (1) ; food (1) ; déco, rénovation, DIY (1) ; maman et famille (1).
- Approche : chaque lundi 25 profils (Base créateurs et Scouting) ; J0 mail à l'adresse pro de la bio avec 3 marques précises et nos preuves (Kosbiotic, Nutripure, Teveo) ; J+1 DM Instagram court qui renvoie au mail, après avoir réagi à un contenu ; J+4 vocal Instagram ou WhatsApp si le numéro est public ; J+10 dernière relance avec une marque concrète ; puis appel de 15 minutes, test de 2 mois, contrat de 12 mois.
- Volumes : 25 approches par semaine ; objectif 3 appels et 1 à 2 signatures par mois. Autres sources : candidatures entrantes, recommandations de nos créatrices (prime de bienvenue), agences partenaires.
- Onboarding en 7 jours : contrat, boîte mail reliée, adresse pro en bio, média kit à jour, statistiques, grille de prix, 20 marques rêvées, exclusivités en cours.

## L'acquisition de marques et d'agences
- D'abord le carnet (513 contacts : 311 marques, 137 agences) :
  - jamais contactés : premier mail one-to-one avec la créatrice n°1 du tableur de matching, 40 par semaine ;
  - touchés une seule fois : relance personnalisée, une seule créatrice et un nouvel angle (pas une relance du mail générique), 25 par semaine ;
  - en conversation (3 échanges ou plus) : visio proposée sous 7 jours, sinon WhatsApp ou LinkedIn ;
  - à relancer (rien depuis 45 jours) : relance J+45 avec le prochain temps fort, 20 par semaine ;
  - avec un profil LinkedIn : invitation puis message après acceptation ; avec un compte Instagram : DM en plus du mail ; sans e-mail : LinkedIn ou Instagram seulement.
- Conversations hors mail (DM, WhatsApp, LinkedIn) : un mail de suite propre avec une proposition concrète. Toute conversation doit finir en visio ou en devis.
- Nouveaux contacts : LinkedIn 20 invitations par jour ouvré (influence, brand, social media managers, responsables partenariats ; talent managers en agence), invitation sans pitch puis message à J+2 ; Instagram 15 DM par jour aux marques qui travaillent avec des créateurs (réagir à une story, puis DM avec une idée et le média kit ; mail sous 24 h si la marque renvoie vers le mail) ; mail 12 par jour aux marques qui paient déjà des créateurs (adresse nominative vérifiée, une créatrice et un temps fort) ; veille hebdomadaire des agences concurrentes et des plateformes de campagnes payées (Filify…).
- WhatsApp, pour les relations proches (Lorna Wood, The Node, Agently, Golden Influence, Teveo, Prepmymeal, Vaillant, Kosbiotic…) : le message du lundi (un mot personnel, « nos dispos de la semaine », 2 ou 3 profils, une actu chiffrée) ; un vocal plutôt qu'un long texte ; les bons moments (lancement, résultat, contenu réussi) ; listes de diffusion par cercle, jamais de groupe ; les 15 à 20 meilleures relations, chacune au plus une fois tous les 15 jours et toujours avec quelque chose d'utile.
- Séquence d'une marque ou d'une agence, 100 % mail (décision de Gianni du 25/11/2026) : J0 premier mail (une créatrice, une idée, une question) ; J+5 relance dans le même fil avec un nouvel angle ; J+12 dernière relance, courte, puis reprise au prochain temps fort. Chaque relance est personnalisée et naturelle, jamais insistante si la personne a fermé la porte.
- Calendrier : on pitche 6 à 8 semaines avant chaque temps fort : résolutions de janvier (dès novembre), Saint-Valentin (avant le 15/12), printemps beauté et triathlon (dès le 1er février), été (dès le 1er avril), rentrée (dès le 1er juillet).
- Volumes d'une semaine : ${VOLUMES_SEMAINE.mailsOneToOne} mails one-to-one (40 jamais contactés, 25 touchés une fois, 20 à relancer, 60 nouveaux), ${VOLUMES_SEMAINE.invitationsLinkedIn} invitations LinkedIn, ${VOLUMES_SEMAINE.dmInstagramMarques} DM Instagram aux marques, ${VOLUMES_SEMAINE.whatsappRelations} WhatsApp aux relations proches, ${VOLUMES_SEMAINE.approchesCreatrices} approches de créatrices. Objectif : ${VOLUMES_SEMAINE.objectif}.

## Les agences : notre premier canal
- Passer de 8 à 20 agences actives (une trentaine à activer : WOO, North, Reach Paris, Puig, Sport Endorse, Ykone, Webedia… ; 10 nouvelles par semaine parmi les 136 du carnet).
- Le 1er de chaque mois : les dispos du mois (chiffres à jour, prix agence, exclusivités).
- Réponse à leurs briefs en moins de 4 h, avec 2 profils proposés à chaque fois.
- Plateformes de campagnes (Filify…) : seulement les campagnes payées.

## Le closing : visio sous 7 jours, devis sous 24 h
- La visio en 5 points : le besoin, le budget, qui décide, notre proposition orale, et un devis envoyé le jour même. Relances à J+2, J+5 et J+10 avec une date limite.
- Devis : page Tarifs › « 3 options » crée d'un coup trois devis en brouillon (Essentiel, Pack avec stories et TikTok, Ambassadrice 3 mois avec remise partenariat). Un devis passé « Envoyé » dans Facturation entre dans les relances : outil devis_a_relancer.
- Contacts chauds (novembre) : Golden Influence (Ana, visio et grille fixe) ; Loop Creators (Léna, Luxeol 700 €, signer) ; Teveo (Léna, Justine : contrat 3 mois à 1 000 €/mois) ; Agently (Nutripure 2027, prime d'exclusivité) ; Kosbiotic (ajouter Ana pour janvier) ; Absolution (Cassandra, obtenir le budget) ; Faved (Ana, devis pack) ; Novettino, Holafly (Léna, envoyer la proposition) ; Thomas Sabo, Aubade (Ivana, visio début décembre pour la Saint-Valentin) ; Oraije, Falconeri (Candice, Ana, visio en décembre pour 2027) ; Saucony, CHiQ (Justine et Pierre, relance téléphonique, budget).

## Le renouvellement
- Bilan à J+7 après chaque collab, sans attendre qu'on le demande, avec une proposition de suite dans le même mail.
- Chaque collab réussie devient une étude de cas pour la prospection (Teveo, Nutripure, Kosbiotic, le Reel d'Ana à 33 000 interactions).
- À traiter maintenant : Nutripure, Teveo, Kosbiotic, Opera Air, Prepmymeal (si le Black Friday vend), Vaillant (Saint-Valentin).

## Les demandes entrantes
- Toutes les boîtes mail des créatrices reliées à l'app ; l'adresse pro dans chaque bio ; des média kits en ligne à jour.
- Tri : refus en un mail type pour le gifting et les arnaques, question du budget pour le reste.

## Ce qu'Alfred prépare (toujours dans « À valider »)
Séquence multicanal dès la validation du premier mail ; 15 contacts du carnet par jour avec le mail rédigé ; 12 marques neuves par jour avec signaux de paiement et adresse vérifiée ; liste LinkedIn du jour (20 profils et le message) ; liste Instagram du jour (15 marques, 5 créatrices, DM rédigés) ; WhatsApp du lundi aux relations proches ; envoi depuis l'alias de la créatrice ; tri des demandes entrantes ; facture préparée dès la signature ; bilan J+7 ; dispos du mois pour les agences ; tableau de bord du lundi avec les volumes par canal.

## Le tableau de bord du lundi (aujourd'hui → fin décembre → mars)
Montant HT signé dans le mois 2 400 € → 8 000 € → 15 000 € ; deal moyen ~800 € → 1 000 € → 1 100 € ; contrats mensuels actifs 1 → 2 → 4 ; contacts du carnet traités (sur 513) ~280 → 400 → 513 ; mails / invitations LinkedIn / DM par semaine → 145 / 100 / 75 ; réponses positives par semaine → 8 → 12 ; visios par semaine ~1 → 6 → 10 ; relations proches suivies sur WhatsApp → 15 → 20 ; agences actives 8 → 12 → 20 ; recrues signées 0 → 3 → 6 ; créatrices qui signent au moins un deal dans le mois 3 → 7 → 12 ; part de Léna dans le montant signé plus de 50 % → 40 % → 25 % ; incidents de conformité 4 en novembre → 0 → 0.
Règle : si un indicateur est en retard deux lundis de suite, on change de méthode, pas seulement de volume.

## Les risques et les limites
- Perdre Nutripure (seul contrat mensuel) à cause du Reel Prozis : chaque post sponsorisé est validé avant publication.
- Dépendre de Léna : recruter des créatrices déjà payées dans d'autres niches.
- Abîmer la réputation par le volume : one-to-one, adresses vérifiées, environ 100 invitations LinkedIn par semaine et 15 DM Instagram par jour au maximum.
- Saturer les relations proches : WhatsApp au plus une fois tous les 15 jours, toujours avec quelque chose d'utile.
- RGPD : adresses professionnelles, offre liée à la fonction de la personne, et on retire toute personne qui le demande.`;
}
