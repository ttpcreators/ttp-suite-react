import type { ViewId } from "./nav";

/**
 * Une phrase sous le titre de chaque page : à quoi elle sert, en mots simples.
 * Pour qu'une page se comprenne au premier coup d'œil, même la première fois.
 */
export const VIEW_HINTS: Partial<Record<ViewId, string>> = {
  activite: "Qui a fait quoi dans l'agence, et quand : chaque ajout, « Fait », suppression ou avancée.",
  agent: "Ton assistant : ce qui stagne et les prochaines actions à mener.",
  stats: "Les chiffres de l'agence sur une période, comparés à la période d'avant.",
  objectifs: "Tes objectifs du mois (CA, signatures…) et où tu en es.",
  roster: "Tes créatrices : abonnés, engagement, CA, et qui doit mettre ses chiffres à jour.",
  engagement: "Calcule le taux d'engagement d'une créatrice à partir de ses statistiques.",
  suivi: "L'évolution des abonnés et de l'engagement de tes créatrices dans le temps.",
  mediakit: "Le media kit de chaque créatrice : ce que tu remplis ici se met à jour en ligne.",
  collabs: "Chaque collaboration, de la signature au paiement, en 11 étapes.",
  briefs: "Les consignes de chaque campagne, envoyées aux créatrices.",
  debrief: "Le bilan d'une campagne à envoyer à la marque : chiffres et points forts.",
  gifting: "Les produits offerts aux créatrices, et ce qu'elles doivent publier en retour.",
  ideas: "Les idées de contenus et de collabs, à trier et à lancer.",
  todo: "Les tâches de l'équipe, par priorité.",
  planning: "Le calendrier de l'agence (relié à Google Agenda) et les posts Instagram de TTP à programmer.",
  facturation: "Les factures : à envoyer, en attente, payées, en retard.",
  reversements: "Ce que l'agence doit reverser à chaque créatrice.",
  relances: "Les factures en retard, à relancer.",
  echeances: "Les fins de contrat à anticiper.",
  contacts: "Ton carnet de marques et d'agences, avec le suivi de vos échanges.",
  whatsapp: "La prospection du jour : qui contacter ou relancer, et par quel canal.",
  mails: "Tes deux boîtes mail, partnerships@ et talent@, au même endroit.",
  messages: "Les messages privés Instagram de TTP : recherche, emails et suivi de prospection remplis tout seuls.",
  prospection: "Les marques que tu démarches, étape par étape jusqu'à la signature.",
  vivier: "Les créatrices repérées, que tu suis avant de les recruter.",
  sourcing: "Trouve de nouvelles créatrices et des marques à démarcher grâce à Instagram, YouTube et TikTok.",
  contrats: "Prépare les contrats : marque × créatrice, représentation, UGC.",
  documents: "Tous les fichiers de l'agence et des créatrices.",
  templates: "Tes modèles de mails et de messages, prêts à réutiliser.",
  checklist: "Les étapes à ne pas oublier, mission par mission.",
  acces: "Les comptes de l'équipe et des créatrices.",
  parametres: "Les réglages de l'agence et de l'app.",
  diagnostique: "Vérifie que tout fonctionne : base de données, fonctions, connexions.",
  corbeille: "Les éléments supprimés : à restaurer, ou à effacer pour de bon.",
};
