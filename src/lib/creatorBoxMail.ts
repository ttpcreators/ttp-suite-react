/**
 * Boîtes Gmail des créateurs dans la page Mails (fonction creator-box-mail) : logique pure.
 * Testée par creatorBoxMail.test.ts.
 */

export type CreatorBox = { email: string; creator: string; connected: boolean };
export type BoxThread = { threadId: string; subject: string; from: string; date: string; ts: number; messages: number; unread: boolean; snippet: string };
export type BoxMessage = { id: string; from: string; to: string; cc: string; date: string; ts: number; text: string; files: string[]; sent: boolean };

/** Adresse d'un en-tête « Nom <a@b.fr> » (minuscules). */
export function adresseDe(v: string): string {
  return (String(v ?? "").match(/[^\s<>,;"']+@[^\s<>,;"']+\.[^\s<>,;"']+/)?.[0] ?? "").toLowerCase();
}

/** Nom affiché d'un en-tête « Nom <a@b.fr> », sinon l'adresse. */
export function nomDe(v: string): string {
  const s = String(v ?? "").trim();
  const nom = s.replace(/<[^>]*>/g, "").replace(/"/g, "").trim();
  return nom && !nom.includes("@") ? nom : adresseDe(s) || s;
}

/** À qui répondre : l'auteur du dernier message reçu ; si le dernier est de la boîte, ses destinataires. */
export function destinataireReponse(messages: BoxMessage[], boite: string): string {
  const moi = boite.trim().toLowerCase();
  const dernier = messages[messages.length - 1];
  if (!dernier) return "";
  if (adresseDe(dernier.from) !== moi) return adresseDe(dernier.from);
  const autres = String(dernier.to ?? "").split(",").map(adresseDe).filter((a) => a && a !== moi);
  return [...new Set(autres)].join(", ");
}

/** Message d'erreur lisible pour un code renvoyé par creator-box-mail. */
export function erreurBoite(code?: string): string {
  switch (code) {
    case "unauthorized": return "Réservé aux fondateurs.";
    case "boite_non_connectee": return "Cette boîte n'est plus reliée : demande un nouveau lien à Alfred (lien_boite_createur).";
    case "destinataire_invalide": return "Adresse du destinataire invalide.";
    case "copie_invalide": return "Adresse en copie invalide.";
    case "message_vide": return "Le message est vide.";
    case "objet_manquant": return "Il manque l'objet.";
    case "reseau": return "Connexion impossible, réessaie.";
    default: return "Gmail ne répond pas, réessaie dans un instant.";
  }
}
