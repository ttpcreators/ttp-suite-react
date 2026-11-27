// ============================================================================
// _shared/siteLead.ts : une marque demande le roster depuis le site (ttpcreators.pro),
// stratégie du 20 nov. 2026 (« sur le site, un formulaire recevoir le roster »).
// La demande devient un contact « Lead site » du carnet, avec une touche « réponse »
// datée, et une tâche de tri pour Gianni (demandes entrantes : question du budget).
// Règles PURES, testées par siteLead.test.ts. Endpoint public : rien de ce que tape le
// visiteur ne part dans une notification (même règle que report-error).
// ============================================================================

export const LEAD_TAG = "Lead site";
export const ROSTER_URL = "https://ttpcreators.pro/mediakit/agence/";
export const LEAD_ORIGINS = ["https://ttpcreators.pro", "https://www.ttpcreators.pro", "http://localhost:5173"];
/** Au-delà, on refuse pour l'heure (robot) : la page reste utilisable avec le lien mail. */
export const LEADS_PAR_HEURE = 30;

export type Lead = { email: string; marque: string; nom: string; message: string };

const EMAIL_RE = /^[^@\s<>"',;:]{1,64}@[^@\s<>"',;:]{1,190}\.[a-z]{2,24}$/i;
/** Texte d'une ligne, sans caractères de contrôle ni balises. */
const propre = (v: unknown, max: number) =>
  String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Demande lue et nettoyée, ou la raison du refus. `piege` rempli = robot. */
export function lireLead(body: unknown): { lead: Lead } | { robot: true } | { erreur: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (propre(b.site, 200)) return { robot: true };
  const email = propre(b.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return { erreur: "email" };
  const marque = propre(b.marque, 80);
  if (!marque) return { erreur: "marque" };
  return { lead: { email, marque, nom: propre(b.nom, 80), message: String(b.message ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, " ").trim().slice(0, 1500) } };
}

/** Valeur d'un filtre ilike qui ne trouve QUE ce texte : « % » et « _ » perdent leur rôle de joker. */
export function ilikeExact(v: string): string {
  return v.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** La touche du journal de contact pour cette demande. */
export function toucheLead(lead: Lead, now: Date) {
  return {
    id: `site${now.getTime().toString(36)}`,
    date: now.toISOString(),
    canal: "email",
    kind: "reponse",
    note: `Demande du roster via le site${lead.message ? ` : ${lead.message.slice(0, 300)}` : ""}`,
  };
}

/** La tâche de tri : format fixe, la marque seule vient du visiteur (nettoyée, courte). */
export function tacheLead(lead: Lead): string {
  return `Lead site : ${lead.marque.slice(0, 60)} demande le roster (tri : question du budget)`;
}
