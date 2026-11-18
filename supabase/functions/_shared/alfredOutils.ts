// ============================================================================
// _shared/alfredOutils.ts : logique pure des outils objectifs, modeles_mails et ajouter_modele
// (demande de Marc, 18 novembre 2026). Testée par alfredOutils.test.ts.
// ============================================================================

export type Objectif = { name?: string; label?: string; creator?: string; ca?: string; target?: string; pct?: number; current?: unknown; value?: unknown; actual?: unknown };

/** Les objectifs d'un mois (« AAAA-MM ») ; l'ancien format (clé « 0 ») vaut pour le mois courant. */
export function objectifsDuMois(parMois: unknown, mois: string, moisCourant: string): Objectif[] {
  const o = (parMois && typeof parMois === "object" ? parMois : {}) as Record<string, unknown>;
  const l = o[mois] ?? (mois === moisCourant ? o["0"] : undefined);
  return Array.isArray(l) ? (l as Objectif[]) : [];
}

export const CATEGORIES_MODELES = ["Prospection", "Négociation", "Suivi", "Facturation"];

/**
 * Un modèle tiré d'un mail que Marc a envoyé tel quel : réutilisable, donc sans donnée
 * personnelle. Renvoie le problème, ou null s'il est bon.
 */
export function problemeModele(titre: string, texte: string): string | null {
  if (titre.trim().length < 3) return "Titre trop court.";
  if (texte.trim().length < 40) return "Texte trop court pour un modèle.";
  if (/[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}/i.test(texte)) return "Le modèle contient une adresse mail : remplace-la par {contact}.";
  if (/(\+33|0)[1-9](?:[ .-]?\d{2}){4}/.test(texte)) return "Le modèle contient un numéro de téléphone : retire-le.";
  if (/\bhttps?:\/\/\S+/i.test(texte)) return "Le modèle contient un lien : retire-le ou mets {lien}.";
  return null;
}
