/**
 * Générateur de CONTRAT DE REPRÉSENTATION (agence × créateur) — data-driven.
 * Spec produite + revue juridique/complétude par un workflow multi-agents,
 * calquée sur deux vrais contrats TTP AGENCY signés (exclusif « contrat test »
 * & non-exclusif « gestion boîte mail »). Un seul moteur configurable couvre
 * les deux variantes et tous les cas intermédiaires.
 */

export type FieldType = "text" | "number" | "date" | "select" | "bool";
export type RcField = {
  key: string;
  label: string;
  type: FieldType;
  default: string;
  options?: { value: string; label: string }[];
  help?: string;
  group: string;
};

export const RC_META = {
  brandTitle: "TTP AGENCY",
  brandSubtitle: "Talent Management & Influence Commerciale",
  footer: "TTP AGENCY • 143 avenue Thiers, 69006 Lyon • marc@ttpcreators.pro • ttpcreators.pro",
  agencyBlock:
    "L'AGENCE — TTP AGENCY, société immatriculée au Registre du Commerce et des Sociétés de Lyon sous le numéro 921 151 726, dont le siège social est sis 143 avenue Thiers, 69006 Lyon, représentée par Marc Maher Bouraoui, co-fondateur, dûment habilité aux fins des présentes.\nContact : marc@ttpcreators.pro · 07 66 25 98 03 · ttpcreators.pro.\nCi-après « l'Agence ».",
  preambule:
    "Considérant que le Talent exerce une activité d'influenceur au sens de l'article 1er de la loi n°2023-451 du 9 juin 2023 visant à encadrer l'influence commerciale (modifiée par l'ordonnance n°2024-978 du 6 novembre 2024), et dans le respect des dispositions du Code de la consommation relatives aux pratiques commerciales (articles L.121-1 et suivants) ;\n\nConsidérant que l'Agence dispose d'un réseau professionnel, d'une expertise en négociation et gestion de campagnes, ainsi que des outils de monétisation optimale de l'activité du Talent ;\n\nIl a été convenu ce qui suit.",
  signatures:
    "Fait à {lieuSignature}, le {dateSignature}, en deux (2) exemplaires originaux.\n\nPour l'Agence\nTTP AGENCY\nMarc Maher Bouraoui, Co-fondateur\n\n_______________________\n\nPour le Talent\n{talentNom}\n\n_______________________\n(signature précédée de la mention manuscrite « Lu et approuvé »)",
  emailAgence: "partnerships@ttpcreators.pro",
};

export const RC_FIELDS: RcField[] = [
  { key: "variante", label: "Type de représentation", type: "select", default: "exclusif", group: "Général", options: [{ value: "exclusif", label: "Exclusif" }, { value: "nonexclusif", label: "Non exclusif" }], help: "Pilote la commission par défaut, l'exclusivité et le titre." },
  { key: "contratTest", label: "Mention « Contrat test » dans le titre", type: "bool", default: "true", group: "Général" },
  { key: "titrePersonnalise", label: "Sous-titre / mention personnalisée", type: "text", default: "", group: "Général" },
  { key: "lieuSignature", label: "Lieu de signature", type: "text", default: "Lyon", group: "Général" },
  { key: "dateSignature", label: "Date de signature", type: "date", default: "", group: "Général" },

  { key: "talentNom", label: "Nom et prénom du Talent", type: "text", default: "", group: "Talent" },
  { key: "talentDateNaissance", label: "Date de naissance", type: "date", default: "", group: "Talent" },
  { key: "talentAdresse", label: "Adresse complète", type: "text", default: "", group: "Talent" },
  { key: "talentSiret", label: "SIRET / statut juridique", type: "text", default: "", group: "Talent" },
  { key: "talentEmailPro", label: "Email professionnel géré", type: "text", default: "", group: "Talent", help: "Requis si gestion de la boîte mail." },
  { key: "talentStatutTva", label: "Statut TVA du Talent", type: "select", default: "franchise", group: "Talent", options: [{ value: "franchise", label: "Franchise en base (non assujetti)" }, { value: "assujetti", label: "Assujetti à la TVA" }] },

  { key: "modeDuree", label: "Régime de durée", type: "select", default: "determinee", group: "Durée", options: [{ value: "determinee", label: "Durée déterminée (fin de plein droit)" }, { value: "reconductible", label: "Reconductible" }] },
  { key: "dureeMois", label: "Durée (mois)", type: "number", default: "2", group: "Durée" },
  { key: "dateDebut", label: "Date de début", type: "date", default: "", group: "Durée", help: "Si durée déterminée ; sinon = date de signature." },
  { key: "dateFin", label: "Date de fin (incluse)", type: "date", default: "", group: "Durée", help: "Auto = début + durée − 1 j si laissé vide." },
  { key: "taciteReconduction", label: "Tacite reconduction", type: "bool", default: "false", group: "Durée" },
  { key: "periodeReconductionMois", label: "Période de reconduction (mois)", type: "number", default: "4", group: "Durée" },
  { key: "preavisJours", label: "Préavis de dénonciation (jours)", type: "number", default: "30", group: "Durée" },
  { key: "essaiActif", label: "Période d'essai réciproque", type: "bool", default: "true", group: "Durée" },
  { key: "essaiJours", label: "Durée période d'essai (jours)", type: "number", default: "15", group: "Durée" },
  { key: "essaiParEmail", label: "Résiliation d'essai par email admise", type: "bool", default: "false", group: "Durée" },

  { key: "modeCommission", label: "Barème de commission", type: "select", default: "parOrigine", group: "Commission", options: [{ value: "parOrigine", label: "Par origine du deal (apporté / initié)" }, { value: "uniforme", label: "Taux uniforme" }] },
  { key: "regimeFiscalComm", label: "Base de la commission", type: "select", default: "HT", group: "Commission", options: [{ value: "HT", label: "Hors taxes (HT)" }, { value: "TTC", label: "Toutes taxes comprises (TTC)" }] },
  { key: "commApportee", label: "Taux — deal apporté & géré Agence (%)", type: "number", default: "30", group: "Commission", help: "Mode par origine." },
  { key: "commInitiee", label: "Taux — deal initié Talent, géré Agence (%)", type: "number", default: "15", group: "Commission", help: "Mode par origine." },
  { key: "commUniforme", label: "Taux uniforme (%)", type: "number", default: "20", group: "Commission", help: "Mode uniforme." },
  { key: "commAutonome", label: "Taux — collaborations autonomes (%)", type: "number", default: "0", group: "Commission" },
  { key: "seuil", label: "Seuil de commission (€, avantages inclus)", type: "number", default: "100", group: "Commission" },
  { key: "avantagesNatureInclus", label: "Avantages en nature dans l'assiette", type: "bool", default: "true", group: "Commission" },
  { key: "giftingSeuilStrict", label: "Avantages comptés si gifting 100 % ET > seuil", type: "bool", default: "false", group: "Commission" },

  { key: "mandatEncaissement", label: "Mandat d'encaissement (l'Agence encaisse et reverse le net)", type: "bool", default: "true", group: "Encaissement" },
  { key: "reversJours", label: "Reversement du net (jours ouvrés)", type: "number", default: "7", group: "Encaissement" },
  { key: "contestationVirementJours", label: "Justificatif de non-réception (jours ouvrés)", type: "number", default: "5", group: "Encaissement" },

  { key: "gestionMail", label: "Gestion de la boîte mail professionnelle", type: "bool", default: "false", group: "Boîte mail" },
  { key: "mailChangementAccesHeures", label: "Info changement d'accès (heures)", type: "number", default: "24", group: "Boîte mail" },
  { key: "mailRevocationHeures", label: "Cessation de consultation après fin (heures)", type: "number", default: "24", group: "Boîte mail" },

  { key: "visibiliteEmail", label: "Afficher partnerships@ttpcreators.pro sur les profils", type: "bool", default: "true", group: "Options" },
  { key: "visibiliteMiseEnDemeureJours", label: "Mise en demeure visibilité (jours ouvrés)", type: "number", default: "7", group: "Options" },
  { key: "reportingMensuel", label: "Reporting mensuel", type: "bool", default: "true", group: "Options" },
  { key: "exclusivite", label: "Clause d'exclusivité active", type: "bool", default: "true", group: "Options" },
  { key: "charteEthique", label: "Charte éthique TTP / ARPP", type: "bool", default: "true", group: "Options" },

  { key: "clausePenaleActive", label: "Clause pénale", type: "bool", default: "true", group: "Juridique" },
  { key: "clausePenaleMois", label: "Clause pénale (mois de commission moyenne)", type: "number", default: "2", group: "Juridique" },
  { key: "retardPaiementJours", label: "Retard de paiement = faute grave (jours)", type: "number", default: "30", group: "Juridique" },
  { key: "imageApresTermeMois", label: "Droit à l'image après le terme (mois)", type: "number", default: "12", group: "Juridique", help: "0 = durée du contrat uniquement." },
  { key: "confidentialiteApresAns", label: "Confidentialité après le terme (années)", type: "number", default: "3", group: "Juridique" },
  { key: "approcheDirecteHeures", label: "Info d'une approche directe (heures)", type: "number", default: "48", group: "Juridique" },
  { key: "mediationOrg", label: "Organe de médiation", type: "select", default: "cciLyon", group: "Juridique", options: [{ value: "cciLyon", label: "CCI de Lyon" }, { value: "mediateurInfluence", label: "Médiateur spécialisé influence" }] },
  { key: "mediationDelaiJours", label: "Délai de médiation (jours)", type: "number", default: "30", group: "Juridique" },
  { key: "tribunal", label: "Tribunal compétent", type: "text", default: "Tribunal Judiciaire de Lyon", group: "Juridique" },
  { key: "clauseL44110", label: "Réf. art. L.441-10 (marque défaillante, hors mandat)", type: "bool", default: "false", group: "Juridique", help: "Intérêts + indemnité réclamés à la marque débitrice." },
  { key: "clauseRGPD", label: "Mention RGPD (données de la boîte mail)", type: "bool", default: "true", group: "Juridique" },
];

export const RC_GROUPS = ["Général", "Talent", "Durée", "Commission", "Encaissement", "Boîte mail", "Options", "Juridique"];

type Variant = { key: string; label: string; title: string; commissionSummary: string; defaults: Record<string, string> };

export const RC_VARIANTS: Variant[] = [
  {
    key: "exclusif",
    label: "Exclusif — Contrat test (durée déterminée)",
    title: "CONTRAT DE REPRÉSENTATION — TALENT MANAGEMENT — EXCLUSIF",
    commissionSummary: "30 % HT si apporté & géré par l'Agence ; 15 % HT si initié par le Talent et géré par l'Agence ; 0 % pour les collaborations autonomes. Aucune commission < 100 €.",
    defaults: { variante: "exclusif", contratTest: "true", modeDuree: "determinee", dureeMois: "2", taciteReconduction: "false", preavisJours: "0", essaiActif: "true", essaiJours: "15", essaiParEmail: "false", mandatEncaissement: "true", reversJours: "7", contestationVirementJours: "5", gestionMail: "false", visibiliteEmail: "true", visibiliteMiseEnDemeureJours: "7", reportingMensuel: "true", modeCommission: "parOrigine", regimeFiscalComm: "HT", commApportee: "30", commInitiee: "15", commAutonome: "0", seuil: "100", avantagesNatureInclus: "true", giftingSeuilStrict: "false", exclusivite: "true", clausePenaleActive: "true", clausePenaleMois: "2", retardPaiementJours: "30", imageApresTermeMois: "12", confidentialiteApresAns: "3", approcheDirecteHeures: "48", charteEthique: "true", mediationOrg: "cciLyon", mediationDelaiJours: "30", talentStatutTva: "franchise" },
  },
  {
    key: "nonexclusif",
    label: "Non exclusif — Gestion boîte mail",
    title: "CONTRAT DE REPRÉSENTATION — TALENT MANAGEMENT — NON EXCLUSIF",
    commissionSummary: "20 % TTC pour les deals apportés ou gérés par l'Agence ; 0 % pour les collaborations gérées intégralement par le Talent. Aucune commission < 100 €.",
    defaults: { variante: "nonexclusif", contratTest: "false", modeDuree: "reconductible", dureeMois: "4", taciteReconduction: "true", periodeReconductionMois: "4", preavisJours: "30", essaiActif: "true", essaiJours: "30", essaiParEmail: "true", mandatEncaissement: "true", reversJours: "7", contestationVirementJours: "5", gestionMail: "true", mailChangementAccesHeures: "24", mailRevocationHeures: "24", visibiliteEmail: "true", visibiliteMiseEnDemeureJours: "7", reportingMensuel: "true", modeCommission: "uniforme", regimeFiscalComm: "TTC", commUniforme: "20", commAutonome: "0", seuil: "100", avantagesNatureInclus: "true", giftingSeuilStrict: "true", exclusivite: "false", clausePenaleActive: "true", clausePenaleMois: "3", retardPaiementJours: "30", imageApresTermeMois: "0", confidentialiteApresAns: "3", approcheDirecteHeures: "48", charteEthique: "true", mediationOrg: "cciLyon", mediationDelaiJours: "30", talentStatutTva: "franchise" },
  },
];

type Article = { id: string; number: string; title: string; variant: "both" | "exclusif" | "nonexclusif"; includeIf?: string; body: string };

export const RC_ARTICLES: Article[] = [
  { id: "parties", number: "", title: "Entre les soussignés", variant: "both", body: "ENTRE LES SOUSSIGNÉS :\n\n{agencyBlock}\n\nET\n\nLE TALENT — {talentNom}, né(e) le {talentDateNaissance}, demeurant {talentAdresse}, exerçant sous le SIRET / statut : {talentSiret}.\nCi-après « le Talent ».\n\nEnsemble « les Parties »." },
  { id: "art1_objet_exclusif", number: "Article 1", title: "Objet du contrat", variant: "exclusif", body: "Le Talent confie à l'Agence, qui l'accepte, un mandat de représentation de manière EXCLUSIVE aux fins de :\n• représenter le Talent auprès de toutes marques, annonceurs et tiers, pour toute collaboration commerciale ;\n• assurer la gestion et le traitement des demandes entrantes via la boîte mail professionnelle du Talent (qualification, réponses, transfert, suivi) ;\n• négocier et sécuriser les contrats (volets financier, juridique, logistique) ;\n• gérer les encaissements et paiements au nom et pour le compte du Talent (mandat d'encaissement) ;\n• accompagner le développement stratégique du Talent (conseil éditorial, positionnement, diversification).\n\nCaractère exclusif — Pendant toute la durée du présent contrat, le Talent s'interdit de conclure, directement ou par l'intermédiaire d'un tiers, toute collaboration commerciale sans intervention préalable de l'Agence, sous réserve des exceptions prévues à l'article 4." },
  { id: "art1_objet_nonexclusif", number: "Article 1", title: "Objet du contrat", variant: "nonexclusif", body: "Le Talent confie à l'Agence, qui l'accepte, un mandat de représentation à caractère NON EXCLUSIF aux fins de :\n• représenter le Talent pour les collaborations apportées ou gérées par l'Agence ;\n• assurer la gestion et le traitement des demandes entrantes via la boîte mail professionnelle du Talent (qualification, réponses, transfert, suivi) ;\n• négocier et sécuriser les contrats (volets financier, juridique, logistique) ;\n• gérer les encaissements et paiements dans le cadre des deals où l'Agence est impliquée (mandat d'encaissement) ;\n• accompagner le développement stratégique du Talent (conseil éditorial, positionnement, diversification).\n\nCaractère non exclusif — Le Talent conserve la liberté de conclure directement des collaborations sans passer par l'Agence, sans obligation de tout confier à cette dernière." },
  { id: "art2_champ_exclusif", number: "Article 2", title: "Champ d'application", variant: "exclusif", body: "Le présent contrat couvre l'ensemble des activités monétisables du Talent : publications, stories, Reels, contenus TikTok ; contenus UGC ; événements, shootings, activations ; lancements de produits ou projets gérés par l'Agence ; et toute rémunération, en numéraire ou en avantages en nature, d'une valeur supérieure ou égale à {seuil} €.\nL'exclusivité s'applique à toutes les plateformes, présentes ou futures (Instagram, TikTok, YouTube et autres)." },
  { id: "art2_champ_nonexclusif", number: "Article 2", title: "Champ d'application", variant: "nonexclusif", body: "Le présent contrat couvre les activités monétisables pour lesquelles le Talent fait appel à l'Agence : partenariats sponsorisés, contenus UGC, événements, rémunérations diverses, ainsi que les demandes entrantes via la boîte mail professionnelle traitées par l'Agence.\nLe Talent n'a aucune obligation de tout confier à l'Agence." },
  { id: "art3_missions", number: "Article 3", title: "Missions de l'Agence", variant: "both", body: "L'Agence s'engage à :\n• prospecter et identifier des opportunités de collaboration ;\n• négocier les meilleures conditions (tarifs, droits, durées d'exploitation, exclusivités) ;\n• rédiger et sécuriser les contrats ;\n• gérer la logistique (briefs, validations, relances, reporting marques) ;\n• encaisser et reverser au Talent le montant NET, dans les {reversJours} jours ouvrés suivant la réception effective des fonds." },
  { id: "art3_mail_missions", number: "Article 3", title: "Missions de l'Agence — gestion de la boîte mail", variant: "both", includeIf: "gestionMail", body: "Au titre de la gestion complète de la boîte mail professionnelle du Talent, l'Agence assure : la consultation chaque jour ouvré, la qualification des demandes, la réponse aux sollicitations commerciales, le transfert immédiat des emails non commerciaux ou personnels, et l'archivage CRM." },
  { id: "art3_reporting", number: "Article 3", title: "Missions de l'Agence — reporting", variant: "both", includeIf: "reportingMensuel", body: "L'Agence établit un reporting mensuel synthétique (deals en cours, chiffre d'affaires généré, performances), incluant le cas échéant l'activité de la boîte mail professionnelle lorsque celle-ci est gérée par l'Agence." },
  { id: "art3bis_acces_mail", number: "Article 3 bis", title: "Accès à la boîte mail professionnelle", variant: "both", includeIf: "gestionMail", body: "3 bis.1 — Le Talent transmet à l'Agence les accès nécessaires (identifiants ou accès délégué de type Google Workspace) à la boîte mail {talentEmailPro}. Le Talent s'interdit de répondre directement aux emails professionnels à caractère commercial sans en informer l'Agence, et informe l'Agence de tout changement de mot de passe ou d'accès dans un délai de {mailChangementAccesHeures} heures.\n\n3 bis.2 — L'Agence s'engage à n'utiliser les accès à aucune fin étrangère à l'exécution du présent contrat, à une confidentialité stricte, et à ne prendre aucun engagement financier au nom du Talent sans son accord exprès.\n\n3 bis.3 — Les accès sont strictement limités à la durée du contrat. En cas de résiliation, les accès sont révoqués immédiatement et l'Agence cesse toute consultation dans un délai de {mailRevocationHeures} heures suivant la fin du préavis. Le traitement des données personnelles contenues dans la boîte mail s'effectue dans le respect du Règlement (UE) 2016/679 (RGPD)." },
  { id: "art_visibilite", number: "Article 7 bis", title: "Visibilité de l'Agence", variant: "both", includeIf: "visibiliteEmail", body: "Le Talent s'engage à afficher de manière visible l'adresse {emailAgence} sur l'ensemble de ses comptes et profils publics actifs (section Contact / Bio / Description ; bouton d'action « E-mail » sur Instagram, lien en bio TikTok, ou toute autre modalité claire), et ce pendant toute la durée du contrat.\nLe non-respect de cette obligation, après mise en demeure restée sans effet pendant {visibiliteMiseEnDemeureJours} jours ouvrés, constitue un manquement au sens de l'article relatif à la résiliation pour faute grave." },
  { id: "art4_remuneration_parOrigine", number: "Article 4", title: "Rémunération de l'Agence", variant: "both", includeIf: "modeCommissionParOrigine", body: "4.1 Principe — La commission de l'Agence est déterminée selon l'origine du deal et calculée sur la rémunération brute perçue par le Talent (numéraire + valeur des avantages en nature). Elle s'entend {regimeFiscalComm}.\nSeuil — Aucune commission n'est due si la rémunération brute est inférieure à {seuil} € (avantages inclus) ; les taux s'appliquent à compter de {seuil} €.\n\n4.2 Barème —\n• Deal apporté ET géré par l'Agence : {commApportee} % {regimeFiscalComm}.\n• Deal initié par le Talent, géré par l'Agence : {commInitiee} % {regimeFiscalComm}.\n• Collaboration autonome (article 4.3) : {commAutonome} %.\n\nCes conditions particulières, individuellement négociées, dérogent le cas échéant aux conditions générales.\n\n4.3 Collaborations autonomes (exception stricte) — À titre exceptionnel et sous réserve de l'accord écrit préalable de l'Agence, le Talent peut conclure directement, sans commission, des partenariats non commerciaux ou des échanges entre pairs. Toute collaboration commerciale conclue hors de ce cadre, sans accord préalable, constitue une violation de l'exclusivité et entraîne l'application de la clause pénale prévue à l'article Fin et résiliation.\n\n4.4 Avantages en nature — Les dotations ne sont pas réductrices du numéraire. Leur valeur n'est intégrée à l'assiette de la commission que si la contrepartie est à 100 % en gifting et que la valeur est supérieure à {seuil} €." },
  { id: "art4_remuneration_uniforme", number: "Article 4", title: "Rémunération de l'Agence", variant: "both", includeIf: "modeCommissionUniforme", body: "4.1 Principe — La commission de l'Agence est calculée sur la rémunération brute perçue par le Talent (numéraire + valeur des avantages en nature) et s'élève à {commUniforme} % {regimeFiscalComm}.\nSeuil — Aucune commission n'est due si la rémunération brute est inférieure à {seuil} € (avantages inclus) ; les taux s'appliquent à compter de {seuil} €.\n\n4.2 Barème —\n• Deal apporté par l'Agence, géré par l'Agence : {commUniforme} % {regimeFiscalComm}.\n• Deal apporté par le Talent, géré / négocié par l'Agence à sa demande : {commUniforme} % {regimeFiscalComm}.\n• Deal apporté ET géré intégralement par le Talent : {commAutonome} % (le Talent en informe néanmoins l'Agence).\n\nLes conditions particulières, individuellement négociées, dérogent le cas échéant aux conditions générales.\n\n4.3 Régime fiscal de la commission — La commission s'entend {regimeFiscalComm}. Lorsqu'elle s'entend TTC, le prélèvement s'opère net du taux applicable quelle que soit la situation fiscale du Talent.{mentionFranchiseTva}\n\n4.4 Avantages en nature — Les dotations ne sont pas réductrices du numéraire. Leur valeur n'est intégrée à l'assiette de la commission que si la contrepartie est à 100 % en gifting et que la valeur est supérieure à {seuil} €." },
  { id: "art5_mandat_encaissement", number: "Article 5", title: "Mandat d'encaissement", variant: "both", includeIf: "mandatEncaissement", body: "5.1 Le Talent donne mandat à l'Agence pour recevoir les rémunérations directement auprès des marques, en vérifier la conformité (montant, délais, conditions), et lui reverser le montant net dans les {reversJours} jours ouvrés suivant l'encaissement effectif, déduction faite de la commission. Une quittance et un relevé détaillé accompagnent chaque virement.\n\n5.2 Impayés — La responsabilité de tout impayé incombe exclusivement à la marque. L'Agence n'est pas garante des sommes dues et se limite à une diligence de recouvrement. Si le Talent conteste un virement, il fournit un justificatif bancaire de non-réception dans un délai de {contestationVirementJours} jours ouvrés." },
  { id: "art5_facturation_directe", number: "Article 5", title: "Modalités de paiement", variant: "both", includeIf: "mandatEncaissementFalse", body: "L'Agence ne procède à aucun encaissement pour le compte du Talent. Le Talent perçoit directement les rémunérations des marques et règle à l'Agence sa commission sur facture, à réception des fonds. En cas de défaillance de la marque, l'Agence assure une diligence de recouvrement ; la responsabilité de l'impayé incombe à la marque, l'Agence n'en étant pas garante.{clauseL44110Marque}" },
  { id: "art6_duree_determinee", number: "Article 6", title: "Durée et terme", variant: "both", includeIf: "modeDureeDeterminee", body: "6.1 Le présent contrat est conclu pour une durée DÉTERMINÉE de {dureeMois} mois, du {dateDebut} au {dateFin} inclus. Il ne fait l'objet d'AUCUNE tacite reconduction et prend fin de plein droit à son terme. Toute poursuite de la relation nécessite la conclusion d'un nouveau contrat.\n\n6.2 Période d'essai — Les Parties conviennent d'une période d'essai réciproque correspondant aux {essaiJours} premiers jours du contrat, durant laquelle chaque Partie peut résilier sans motif, par lettre recommandée avec accusé de réception, avec effet immédiat.{mentionEssaiEmail}" },
  { id: "art6_duree_reconductible", number: "Article 6", title: "Durée et renouvellement", variant: "both", includeIf: "modeDureeReconductible", body: "6.1 Le présent contrat est conclu pour une durée initiale de {dureeMois} mois à compter de la signature. Il est TACITEMENT reconductible par périodes successives de {periodeReconductionMois} mois, sauf dénonciation par lettre recommandée avec accusé de réception moyennant un préavis de {preavisJours} jours.\n\n6.2 Période d'essai — Les Parties conviennent d'une période d'essai réciproque correspondant aux {essaiJours} premiers jours du contrat, durant laquelle chaque Partie peut résilier sans motif, par lettre recommandée avec accusé de réception, avec effet immédiat.{mentionEssaiEmail}" },
  { id: "art7_obligations", number: "Article 7", title: "Obligations du Talent", variant: "both", body: "Le Talent s'engage à :\n• fournir mensuellement ses insights analytics (plateformes, données démographiques, performances) ;\n• respecter les briefs, livrables et échéances convenus ;\n• informer l'Agence de toute approche directe de marque dans un délai de {approcheDirecteHeures} heures ;\n• respecter la charte éthique TTP (aucun contenu illégal, haineux, discriminatoire ou contraire aux recommandations de l'ARPP) ;\n• assumer la responsabilité de ses contenus et indemniser l'Agence en cas de litige lié à ceux-ci." },
  { id: "art7_obligations_exclusif", number: "Article 7", title: "Obligations du Talent — exclusivité", variant: "exclusif", includeIf: "exclusivite", body: "En complément, au titre de l'exclusivité, le Talent s'engage à confier exclusivement à l'Agence la gestion, la négociation et la conclusion de ses collaborations commerciales, et à ne pas contacter directement de marques à des fins commerciales sans en informer l'Agence." },
  { id: "art7_obligations_mail", number: "Article 7", title: "Obligations du Talent — accès mail", variant: "both", includeIf: "gestionMail", body: "Le Talent s'engage en outre à maintenir les accès à la boîte mail professionnelle actifs pendant toute la durée du contrat." },
  { id: "art8_pi_image", number: "Article 8", title: "Propriété intellectuelle et droit à l'image", variant: "both", body: "8.1 Le Talent conserve la pleine propriété de ses contenus. Les droits d'exploitation consentis aux marques sont négociés au cas par cas.\n\n8.2 Le Talent accorde à l'Agence un droit NON exclusif, gratuit et mondial d'utiliser son image, son nom et ses identifiants dans ses communications commerciales (portfolio, site, pitchs), {dureeDroitImage}." },
  { id: "art9_confidentialite", number: "Article 9", title: "Confidentialité", variant: "both", body: "Les Parties sont tenues à une obligation de confidentialité absolue portant sur les conditions financières, les stratégies internes et les informations relatives aux marques, prospects et partenaires{mentionContenuMail}. Cette obligation s'applique pendant toute la durée du contrat et pendant {confidentialiteApresAns} ans après son terme.{mentionRgpdConfid}" },
  { id: "art10_fin_terme", number: "Article 10", title: "Fin et résiliation", variant: "both", includeIf: "modeDureeDeterminee", body: "10.1 Le contrat prend fin de plein droit à son terme, le {dateFin}, sans qu'aucune formalité ne soit requise." },
  { id: "art10_fin_amiable", number: "Article 10", title: "Fin et résiliation", variant: "both", includeIf: "modeDureeReconductible", body: "10.1 Après la période d'essai, chaque Partie peut résilier à l'amiable, sans motif, par lettre recommandée avec accusé de réception, moyennant un préavis de {preavisJours} jours." },
  { id: "art10_faute_grave", number: "Article 10", title: "Fin et résiliation — faute grave", variant: "both", body: "10.2 Résiliation anticipée pour faute grave — En cas de manquement grave (retard de paiement supérieur à {retardPaiementJours} jours, atteinte à l'image, violation de la confidentialité{mentionExclusiviteFaute}{mentionMailFaute}), la Partie lésée peut résilier par lettre recommandée avec accusé de réception motivée, avec effet immédiat.\n\n10.3 Deals en cours — L'Agence continue de gérer les deals en cours{mentionJusquauTerme} ; la commission correspondante reste due." },
  { id: "art10_revocation_mail", number: "Article 10", title: "Fin et résiliation — révocation des accès mail", variant: "both", includeIf: "gestionMail", body: "10.4 Révocation des accès — Les accès à la boîte mail sont révoqués à la date d'effet de la fin du contrat ; l'Agence cesse toute consultation dans un délai de {mailRevocationHeures} heures." },
  { id: "art10_clause_penale", number: "Article 10", title: "Fin et résiliation — clause pénale", variant: "both", includeIf: "clausePenaleActive", body: "10.{numClausePenale} Clause pénale — {libelleClausePenale} ouvre droit, au profit de l'Agence, à des dommages-intérêts forfaitaires égaux à {clausePenaleMois} mois de commission moyenne, sans préjudice de tout autre recours." },
  { id: "art11_responsabilite", number: "Article 11", title: "Responsabilité", variant: "both", body: "11.1 L'Agence est responsable de la bonne exécution de son mandat. Elle n'est pas responsable des contenus du Talent ni des impayés dès lors qu'elle a accompli les démarches de diligence et de recouvrement.\n\n11.2 Le Talent est seul responsable de ses contenus (respect de la loi, des recommandations de l'ARPP et des droits des tiers) et indemnise l'Agence de tout préjudice en résultant." },
  { id: "art11_responsabilite_mail", number: "Article 11", title: "Responsabilité — gestion de la boîte mail", variant: "both", includeIf: "gestionMail", body: "11.3 Gestion de la boîte mail — L'Agence agit avec diligence et loyauté. Elle n'est pas responsable d'un email manqué en cas d'indisponibilité technique ou de force majeure." },
  { id: "art12_litiges", number: "Article 12", title: "Litiges et loi applicable", variant: "both", body: "Le présent contrat est régi par le droit français. En cas de différend, les Parties s'engagent à rechercher une solution amiable préalable, au besoin par la médiation {organeMediation}. À défaut d'accord dans un délai de {mediationDelaiJours} jours, le {tribunal} sera seul compétent." },
];

// ─── Résolution ──────────────────────────────────────────────────────────────

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function frLong(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").trim());
  if (!m) return iso || "……………";
  const d = Number(m[3]);
  return `${d === 1 ? "1er" : d} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
function addMonthsMinusDay(iso: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").trim());
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() - 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const is = (c: Record<string, string>, k: string) => c[k] === "true";

/** Valeur d'un placeholder (config / champ créateur / figé / calculé). */
function ph(key: string, c: Record<string, string>): string {
  switch (key) {
    case "agencyBlock": return RC_META.agencyBlock;
    case "emailAgence": return RC_META.emailAgence;
    case "talentNom": return c.talentNom || "……………";
    case "talentDateNaissance": return frLong(c.talentDateNaissance);
    case "dateSignature": return frLong(c.dateSignature);
    case "dateDebut": return frLong(c.dateDebut || c.dateSignature);
    case "dateFin": {
      if (c.dateFin) return frLong(c.dateFin);
      const start = c.dateDebut || c.dateSignature;
      const auto = addMonthsMinusDay(start, Number(c.dureeMois || "0"));
      return frLong(auto);
    }
    case "mentionFranchiseTva": return c.regimeFiscalComm === "TTC" && c.talentStatutTva === "franchise" ? " Le Talent relevant de la franchise en base de TVA, aucune TVA additionnelle n'est due." : "";
    case "clauseL44110Marque": return is(c, "clauseL44110") ? " Les intérêts de retard et l'indemnité forfaitaire de recouvrement prévus à l'article L.441-10 du Code de commerce sont, le cas échéant, réclamés à la marque défaillante." : "";
    case "mentionEssaiEmail": return is(c, "essaiParEmail") ? " La résiliation durant la période d'essai peut également intervenir par email confirmé." : "";
    case "dureeDroitImage": {
      const n = Number(c.imageApresTermeMois || "0");
      return n > 0 ? `pour la durée du contrat ET pendant ${n} mois suivant son terme` : "pour la seule durée du contrat, ce droit prenant fin à la date d'effet de la résiliation ou du non-renouvellement";
    }
    case "mentionContenuMail": return is(c, "gestionMail") ? ", ainsi que sur le contenu de la boîte mail professionnelle consulté par l'Agence" : "";
    case "mentionRgpdConfid": return is(c, "gestionMail") && is(c, "clauseRGPD") ? " Le traitement des données personnelles s'effectue conformément au Règlement (UE) 2016/679 (RGPD)." : "";
    case "mentionExclusiviteFaute": return c.variante === "exclusif" && is(c, "exclusivite") ? " ou de l'exclusivité" : "";
    case "mentionMailFaute": return is(c, "gestionMail") ? ", utilisation abusive des accès à la boîte mail" : "";
    case "mentionJusquauTerme": return c.modeDuree === "determinee" ? " jusqu'à leur terme" : "";
    case "numClausePenale": return is(c, "gestionMail") ? "5" : "4";
    case "libelleClausePenale": return c.variante === "exclusif" ? "Toute violation avérée de l'exclusivité (collaboration conclue sans l'Agence, contournement)" : "Toute violation avérée des obligations du Talent ayant causé un préjudice à l'Agence (non-déclaration d'une collaboration manageable, contournement)";
    case "organeMediation": return c.mediationOrg === "mediateurInfluence" ? "(médiateur spécialisé en influence commerciale)" : "(CCI de Lyon)";
    default: return c[key] ?? "";
  }
}

function resolve(text: string, c: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k) => ph(k, c));
}

function includeOk(token: string | undefined, c: Record<string, string>): boolean {
  if (!token) return true;
  switch (token) {
    case "modeCommissionParOrigine": return c.modeCommission === "parOrigine";
    case "modeCommissionUniforme": return c.modeCommission === "uniforme";
    case "mandatEncaissementFalse": return !is(c, "mandatEncaissement");
    case "modeDureeDeterminee": return c.modeDuree === "determinee";
    case "modeDureeReconductible": return c.modeDuree === "reconductible";
    default: return is(c, token);
  }
}

export type BuiltContract = {
  title: string;
  subtitle: string;
  articles: { number: string; title: string; body: string }[];
  signatures: string;
  preambule: string;
};

/** Assemble le contrat de représentation pour une configuration donnée. */
export function buildRepresentation(config: Record<string, string>): BuiltContract {
  const variante = config.variante === "nonexclusif" ? "nonexclusif" : "exclusif";
  const v = RC_VARIANTS.find((x) => x.key === variante) ?? RC_VARIANTS[0];

  const articles = RC_ARTICLES.filter((a) => (a.variant === "both" || a.variant === variante) && includeOk(a.includeIf, config)).map((a) => {
    let number = a.number;
    if (a.id === "art_visibilite") number = variante === "exclusif" ? "Article 7 bis" : "Article 3 ter";
    return { number, title: a.title, body: resolve(a.body, config) };
  });

  const titleBits = [v.title];
  if (is(config, "contratTest")) titleBits.push("CONTRAT TEST");
  return {
    title: titleBits.join(" — "),
    subtitle: (config.titrePersonnalise || "").trim(),
    articles,
    preambule: resolve(RC_META.preambule, config),
    signatures: resolve(RC_META.signatures, config),
  };
}

/** Texte brut (copie / .txt). */
export function representationText(config: Record<string, string>): string {
  const c = buildRepresentation(config);
  const lines = [RC_META.brandTitle, RC_META.brandSubtitle, "", c.title];
  if (c.subtitle) lines.push(c.subtitle);
  lines.push("", "PRÉAMBULE", c.preambule, "");
  for (const a of c.articles) {
    lines.push([a.number, a.title].filter(Boolean).join(" — "));
    lines.push(a.body, "");
  }
  lines.push("SIGNATURES", c.signatures, "", RC_META.footer);
  return lines.join("\n");
}

const esc = (s: unknown) => String(s ?? "").replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[ch] ?? ch);
function htmlBody(text: string): string {
  return esc(text)
    .split("\n")
    .map((l) => (l.startsWith("• ") ? `<li>${l.slice(2)}</li>` : l.trim() === "" ? "" : `<p>${l}</p>`))
    .join("")
    .replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`);
}

/** Contrat HTML imprimable (PDF) — charte TTP AGENCY (accent doré). */
export function representationHTML(config: Record<string, string>): string {
  const c = buildRepresentation(config);
  const articles = c.articles
    .map((a) => `<section><h2>${esc([a.number, a.title].filter(Boolean).join(" — "))}</h2>${htmlBody(a.body)}</section>`)
    .join("");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.title)}</title>
<style>
*{box-sizing:border-box}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,Arial,sans-serif;color:#1a1a1a;max-width:820px;margin:0 auto;padding:48px 46px;font-size:12.5px;line-height:1.6}
.hd{text-align:center;border-bottom:2px solid #b8933f;padding-bottom:16px;margin-bottom:6px}
.hd .b{font-size:22px;font-weight:800;letter-spacing:.5px}
.hd .s{color:#b8933f;font-size:12px;margin-top:2px}
.conf{text-align:right;color:#a1a1aa;font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;margin:8px 0 18px}
h1{font-size:17px;text-align:center;letter-spacing:.3px;margin:22px 0 2px}
.sub{text-align:center;color:#b8933f;font-weight:600;font-size:12px;margin-bottom:18px}
h2{font-size:12.5px;font-weight:700;margin:20px 0 4px;color:#111}
p{margin:5px 0}
ul{margin:5px 0 5px 2px;padding-left:18px}
li{margin:2px 0}
.pre{margin-top:16px}
.sign{margin-top:26px;white-space:pre-line;border-top:1px solid #e4e4e7;padding-top:14px}
.ft{margin-top:26px;border-top:1px solid #e4e4e7;padding-top:12px;text-align:center;color:#a1a1aa;font-size:10px}
@media print{body{padding:0}}
</style></head><body>
<div class="hd"><div class="b">${esc(RC_META.brandTitle)}</div><div class="s">${esc(RC_META.brandSubtitle)}</div></div>
<div class="conf">Confidentiel</div>
<h1>${esc(c.title)}</h1>
${c.subtitle ? `<div class="sub">${esc(c.subtitle)}</div>` : ""}
<div class="pre"><h2>Préambule</h2>${htmlBody(c.preambule)}</div>
${articles}
<div class="sign"><h2>Signatures</h2>${esc(c.signatures)}</div>
<div class="ft">${esc(RC_META.footer)}</div>
</body></html>`;
}
