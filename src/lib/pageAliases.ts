import type { ViewId } from "./nav";

/**
 * Synonymes pour retrouver une page même sans taper son nom exact. Partagés par la
 * recherche globale (téléphone) et la palette ⌘K.
 */
export const PAGE_ALIASES: Partial<Record<ViewId, string[]>> = {
  aujourdhui: ["aujourd'hui", "journee", "a traiter", "today", "inbox zero"],
  apercu: ["dashboard", "accueil", "tableau de bord"],
  reversements: ["paie", "paiement", "reverser", "reversement", "salaire createur"],
  relances: ["impaye", "retard", "relancer", "relance facture"],
  facturation: ["facture", "devis"],
  planning: ["agenda", "calendrier", "rendez-vous", "rdv", "posts instagram", "programmer un post", "publier"],
  mediakit: ["media kit", "kit"],
  contrats: ["contrat"],
  prospection: ["prospect", "deal", "pipeline"],
  whatsapp: ["a contacter", "prospection", "relancer une marque", "whatsapp"],
  pricing: ["prix", "tarif", "tarifs", "devis", "cpm", "pricing", "combien facturer"],
  suivi: ["evolution", "suivi engagement", "courbe abonnes"],
  mails: ["mail", "email", "boite mail", "gmail"],
  templates: ["modele", "modeles", "template"],
  echeances: ["echeance", "echeances", "expiration", "renouvellement contrat", "fin de contrat"],
  diagnostique: ["diagnostic", "bug", "panne"],
  sourcing: ["sourcing", "radar", "trouver", "recruter", "marques instagram", "concurrents", "agences concurrentes", "veille"],
  messages: ["dm", "messages", "messagerie", "inbox", "instagram"],
  roster: ["createurs", "talents"],
  objectifs: ["objectif", "goal"],
  stats: ["statistiques", "analytics"],
  debrief: ["bilan", "rapport"],
  acces: ["mot de passe", "identifiants", "login"],
  agent: ["megan", "agents", "ia", "assistant"],
  corbeille: ["poubelle", "supprime"],
};

/** Minuscules sans accents (comparaisons de recherche). */
export const normSearch = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
