// ============================================================================
// _shared/mailModels.ts : modèles de mails fournis d'office par l'app (page « Modèles »).
// COPIE de DEFAULT_TEMPLATES (src/lib/mailModels.ts), pour que le connecteur Claude les
// voie : ils ne sont jamais enregistrés en base (seuls les modèles de l'agence le sont,
// clé `customTemplates`). src/lib/mailModelsSync.test.ts vérifie que les deux restent égaux.
// ============================================================================

export const DEFAULT_MAIL_MODELS: { category: string; title: string; body: string }[] = [
  {
    category: "Prospection",
    title: "DM marque à froid",
    body:
      "Bonjour {marque} 👋\n\n" +
      "Je gère les collaborations de {créateur} chez TTP Creators. On adore votre univers et on pense qu'une campagne ensemble aurait du sens : audience engagée, contenu qui performe.\n\n" +
      "Puis-je vous envoyer le media kit de {créateur} par mail ?\n\n" +
      "Belle journée,\nTTP Creators",
  },
  {
    category: "Prospection",
    title: "Relance après devis",
    body:
      "Bonjour {marque},\n\n" +
      "Je me permets de revenir vers vous concernant le devis envoyé pour la collaboration avec {créateur}.\n\n" +
      "Avez-vous eu l'occasion d'en discuter en interne ? Je reste disponible pour ajuster le format ou le budget si besoin.\n\n" +
      "Au plaisir d'échanger,\nTTP Creators",
  },
  {
    category: "Négociation",
    title: "Contre-proposition tarif",
    body:
      "Bonjour {marque},\n\n" +
      "Merci pour votre retour. Pour ce format, le tarif de {créateur} est de [Montant], droits et exclusivité inclus.\n\n" +
      "Nous pouvons ajuster selon le volume ou la durée de diffusion : dites-moi ce qui correspond à votre budget et je vous fais une proposition sur-mesure.\n\n" +
      "Bien à vous,\nTTP Creators",
  },
  {
    category: "Suivi",
    title: "Brief validé",
    body:
      "Bonjour {marque},\n\n" +
      "Bonne nouvelle : {créateur} a validé le brief 🎉 La production démarre.\n\n" +
      "Livraison prévue le [Date]. Je vous tiens informé(e) de l'avancement et reviens vers vous dès que les premiers contenus sont prêts pour relecture.\n\n" +
      "Merci de votre confiance,\nTTP Creators",
  },
  {
    category: "Suivi",
    title: "Rappel deadline",
    body:
      "Bonjour {marque},\n\n" +
      "Petit rappel amical : la livraison des contenus de {créateur} est prévue pour le [Date].\n\n" +
      "Il nous manque encore [élément manquant] de votre côté pour finaliser. Pourriez-vous nous le transmettre d'ici [Date] afin de tenir la deadline ?\n\n" +
      "Merci !\nTTP Creators",
  },
  {
    category: "Facturation",
    title: "Envoi de facture",
    body:
      "Bonjour {marque},\n\n" +
      "Comme convenu, vous trouverez ci-joint la facture #[Réf] pour la collaboration avec {créateur}, d'un montant de [Montant].\n\n" +
      "Le règlement est attendu sous [30] jours. N'hésitez pas si vous avez besoin d'un justificatif complémentaire.\n\n" +
      "Merci et à bientôt,\nTTP Creators",
  },
  {
    category: "Facturation",
    title: "Relance impayé",
    body:
      "Bonjour {marque},\n\n" +
      "Sauf erreur de notre part, la facture #[Réf] d'un montant de [Montant] (échéance le [Date]) reste en attente de règlement.\n\n" +
      "Pourriez-vous nous indiquer une date de paiement ? Je reste à disposition pour tout justificatif.\n\n" +
      "Merci d'avance,\nTTP Creators",
  },
];
