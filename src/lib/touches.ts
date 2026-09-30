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

/** Rythme de recontact PAR DÉFAUT (jours) : réglable dans Paramètres → Prospection. */
export const RELANCE_DAYS = 45;

/** Réglages prospection (blob agence `prospectSettings`). */
export type WaMode = "app" | "web";
export type ProspectSettings = {
  /** Rythme de recontact en jours (défaut RELANCE_DAYS). */
  relanceDays?: number;
  /** Ouverture WhatsApp : app native (wa.me) ou WhatsApp Web (compte pro connecté). */
  waMode?: WaMode;
};

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
 * « À relancer » : cycle de recontact. Au moins une prise de contact, et la
 * dernière activité (touche, RÉPONSE COMPRISE, ou mail sortant) date de `days`
 * jours ou plus. Une réponse reçue remet donc le compteur à zéro, elle
 * n'exempte plus définitivement : on entretient la relation tous les N jours.
 */
export function needsRelance(list: Touch[], lastContacted?: string | null, days: number = RELANCE_DAYS): boolean {
  const last = lastActivityMs(list, lastContacted);
  if (!last) return false;
  return Date.now() - last >= Math.max(1, days) * 86400000;
}

/** Type auto de la prochaine touche : premier contact si vierge, sinon relance. */
export function nextKind(list: Touch[], lastContacted?: string | null): TouchKind {
  return list.length === 0 && !lastContacted ? "contact" : "relance";
}

/**
 * Patch base à écrire après une modification du journal : les touches, plus
 * `last_contacted` synchronisé si la nouvelle activité est plus récente.
 * Partagé entre la page Contacts et la page WhatsApp (une seule logique).
 */
export function buildTouchesPatch(next: Touch[], currentLastContacted?: string | null): Record<string, unknown> {
  const acts = next.map((t) => new Date(t.date).getTime()).filter((n) => Number.isFinite(n));
  const lastIso = acts.length ? new Date(Math.max(...acts)).toISOString() : null;
  const patch: Record<string, unknown> = { touches: next };
  if (lastIso && (!currentLastContacted || new Date(lastIso).getTime() > new Date(currentLastContacted).getTime()))
    patch.last_contacted = lastIso;
  return patch;
}

/**
 * Statut de prospection DÉRIVÉ du journal — se met à jour tout seul, aucune
 * saisie : Jamais contacté → Contacté → Relancé ×N → A répondu.
 */
export type DerivedTone = "never" | "contacted" | "relanced" | "replied";
export function derivedStatus(list: Touch[], lastContacted?: string | null): { label: string; tone: DerivedTone } {
  const lt = lastTouch(list);
  if (lt?.kind === "reponse") return { label: "A répondu", tone: "replied" };
  const n = list.filter((t) => t.kind === "relance").length;
  if (n > 0) return { label: `Relancé ×${n}`, tone: "relanced" };
  if (list.length > 0 || lastContacted) return { label: "Contacté", tone: "contacted" };
  return { label: "Jamais contacté", tone: "never" };
}

/** Numéro international nettoyé (0 français initial → 33), ou null si illisible. */
function waDigits(phone?: string | null): string | null {
  const raw = (phone ?? "").trim();
  if (!raw) return null;
  // « +33 (0)6 … » : le (0) optionnel ne doit pas rester dans le numéro.
  let digits = raw.replace(/\(\s*0\s*\)/g, "").replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("0")) digits = "33" + digits.slice(1);
  // Numéro FR saisi sans le 0 (« 6 12 34 56 78 ») → indicatif 33.
  else if (digits.length === 9) digits = "33" + digits;
  return digits.length >= 8 ? digits : null;
}

/** Lien WhatsApp « wa.me » (app native). Sert aussi de test « numéro joignable ». */
export function waLink(phone?: string | null): string | null {
  const d = waDigits(phone);
  return d ? `https://wa.me/${d}` : null;
}

/**
 * Lien WhatsApp selon le mode choisi. « web » ouvre WhatsApp Web : c'est le
 * COMPTE CONNECTÉ dans le navigateur qui envoie (le numéro pro de Marc s'il y
 * est connecté) — un lien ne peut pas choisir le numéro émetteur, seul le
 * compte connecté de l'app ou du navigateur le détermine.
 */
export function waHref(phone: string | null | undefined, mode: WaMode): string | null {
  const d = waDigits(phone);
  if (!d) return null;
  return mode === "web" ? `https://web.whatsapp.com/send?phone=${d}` : `https://wa.me/${d}`;
}

/** Pseudo Instagram nettoyé (accepte « @pseudo » ou une URL de profil complète). */
export function igHandle(raw?: string | null): string {
  return (raw ?? "").trim().replace(/^@/, "").replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, "").replace(/[/?].*$/, "").replace(/\s/g, "");
}
