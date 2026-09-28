/**
 * Journal de contact multi-canal (« touches ») d'un contact marque — le suivi
 * de prospection de Marc : « contacté le X via WhatsApp, relancé le Y, a
 * répondu le Z ». Stocké dans la colonne `contacts.touches` (jsonb, tableau),
 * même motif que todos.subtasks. `last_contacted` reste synchronisé à chaque
 * touche pour que tout l'existant (bento, filtres, alerte sur-contact, vue
 * agent de Megan) continue de fonctionner.
 */

export type TouchCanal = "whatsapp" | "email" | "instagram" | "linkedin" | "tel" | "autre";
export type TouchKind = "contact" | "relance" | "reponse";

export type Touch = {
  id: string;
  /** Date ISO (YYYY-MM-DD ou ISO complet). */
  date: string;
  canal: TouchCanal;
  kind: TouchKind;
  note?: string;
};

export const CANAL_LABELS: Record<TouchCanal, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  tel: "Téléphone",
  autre: "Autre",
};

export const KIND_LABELS: Record<TouchKind, string> = {
  contact: "Premier contact",
  relance: "Relance",
  reponse: "Réponse reçue",
};

/** Sans réponse depuis ce nombre de jours, le contact passe « à relancer ». */
export const RELANCE_DAYS = 7;

let _uid = 0;
export function touchId(): string {
  _uid += 1;
  return `tc${Date.now().toString(36)}${_uid}`;
}

/** Lit le tableau de touches d'une ligne contact (tolérant : null / mauvais type → []). */
export function parseTouches(raw: unknown): Touch[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Touch[]).filter((t) => t && typeof t.date === "string" && typeof t.canal === "string");
}

function ms(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Touches triées de la plus récente à la plus ancienne. */
export function sortTouches(list: Touch[]): Touch[] {
  return [...list].sort((a, b) => ms(b.date) - ms(a.date));
}

export function lastTouch(list: Touch[]): Touch | null {
  return sortTouches(list)[0] ?? null;
}

/** Dernière activité connue : la touche la plus récente OU le dernier mail sortant. */
export function lastActivityMs(list: Touch[], lastContacted?: string | null): number {
  const t = lastTouch(list);
  return Math.max(t ? ms(t.date) : 0, lastContacted ? ms(lastContacted) : 0);
}

/**
 * « À relancer » : au moins une prise de contact, la dernière activité date de
 * RELANCE_DAYS ou plus, et la dernière touche n'est pas une réponse reçue.
 */
export function needsRelance(list: Touch[], lastContacted?: string | null): boolean {
  const last = lastActivityMs(list, lastContacted);
  if (!last) return false;
  const lt = lastTouch(list);
  if (lt && lt.kind === "reponse") return false;
  return Date.now() - last >= RELANCE_DAYS * 86400000;
}

/** Type auto de la prochaine touche : premier contact si vierge, sinon relance. */
export function nextKind(list: Touch[], lastContacted?: string | null): TouchKind {
  return list.length === 0 && !lastContacted ? "contact" : "relance";
}

/**
 * Lien WhatsApp « wa.me » depuis un numéro libre. Un 0 français initial devient
 * +33 ; un numéro déjà international (+ ou 00) est nettoyé tel quel.
 */
export function waLink(phone?: string | null): string | null {
  const raw = (phone ?? "").trim();
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("0")) digits = "33" + digits.slice(1);
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}
