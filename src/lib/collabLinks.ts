/*
 * Collab au centre (règles PURES, testées par collabLinks.test.ts) :
 *   • un objet (facture, tâche, rendez-vous, brief, gifting) est relié à une collab par
 *     sa colonne `collab_id` (sql/2026-10-23-collab-id.sql) ;
 *   • avant ce SQL, ou pour un objet ancien sans lien, on SUGGÈRE les objets qui citent
 *     la marque de la collab et concernent son créateur (bouton « Relier ») ;
 *   • à chaque étape franchie, une tâche de l'étape est proposée (`autoTaskFor`).
 */

export type CollabLite = { id: string; brand: string; creator: string | null; step: number; status: string; cachet?: string | null };

/** La colonne `collab_id` n'existe pas encore (SQL pas lancé) : on travaille sans. */
export function collabIdMissing(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "42703" || e.code === "PGRST204" || /collab_id/i.test(e.message ?? "");
}

const fold = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Prénom affiché (« LÉNA PASQUALE » → « Léna »). */
export function firstNameOf(creator: string | null | undefined): string {
  const w = (creator ?? "").trim().split(/\s+/)[0] ?? "";
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : "";
}

/** « Nutripure × Léna ». */
export function collabLabel(c: Pick<CollabLite, "brand" | "creator">): string {
  const who = firstNameOf(c.creator);
  return [c.brand.trim(), who].filter(Boolean).join(" × ") || "Collab";
}

/** Le texte cite-t-il la marque (mot entier, sans tenir compte des accents ni de la casse) ? */
export function mentionsBrand(text: string | null | undefined, brand: string): boolean {
  const b = fold(brand);
  if (b.length < 2) return false;
  const t = ` ${fold(text).replace(/[^a-z0-9]+/g, " ")} `;
  return t.includes(` ${b.replace(/[^a-z0-9]+/g, " ").trim()} `);
}

/** L'objet concerne-t-il le créateur de la collab ? (liste « Nom A, Nom B » acceptée). */
export function concernsCreator(names: string | string[] | null | undefined, creator: string | null): boolean {
  if (!creator) return true;
  const me = fold(creator);
  const list = Array.isArray(names) ? names : (names ?? "").split(",");
  return list.some((n) => fold(n) === me);
}

/** Collabs proposées dans le champ « Collab » d'un objet : celles du créateur choisi d'abord. */
export function collabChoices(collabs: readonly CollabLite[], creator: string | null | undefined): CollabLite[] {
  const listed = collabs.filter((c) => c.status === "active" || c.status === "gagnee");
  if (!creator) return listed;
  const me = fold(creator);
  return listed.filter((c) => fold(c.creator) === me);
}

// ── Tâches créées à chaque étape franchie ──────────────────────────────────

const DAY = 86400000;
const iso = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Modèle par étape ATTEINTE : texte ({prenom}, {marque}) et échéance en jours. */
export const AUTO_TASKS: Record<number, { text: string; days: number }> = {
  2: { text: "Résumer le brief pour {prenom}", days: 1 },
  4: { text: "Relancer {prenom} pour le contenu", days: 3 },
  5: { text: "Envoyer le contenu à {marque} pour validation", days: 1 },
  6: { text: "Relever les stats à 7 jours", days: 7 },
  7: { text: "Créer la facture {marque}", days: 1 },
  8: { text: "Relancer {marque} pour le paiement", days: 30 },
  9: { text: "Reverser {prenom}", days: 3 },
  10: { text: "Préparer le bilan pour {marque}", days: 3 },
};

/** Tâche à créer quand la collab atteint `step` (null si l'étape n'en a pas). */
export function autoTaskFor(step: number, c: Pick<CollabLite, "brand" | "creator">, now: number = Date.now()): { text: string; due: string } | null {
  const m = AUTO_TASKS[step];
  if (!m) return null;
  const prenom = firstNameOf(c.creator) || "le créateur";
  const text = m.text.replace("{prenom}", prenom).replace("{marque}", c.brand.trim() || "la marque");
  return { text, due: iso(now + m.days * DAY) };
}

/** Une tâche identique existe déjà pour cette collab (pas de doublon). */
export function hasAutoTask(todos: readonly { text: string; collab_id?: string | null }[], collabId: string, text: string): boolean {
  const t = fold(text);
  return todos.some((x) => fold(x.text) === t && (x.collab_id == null || x.collab_id === collabId));
}

/** Montant du cachet (« 1 500 € », « 1500€ HT ») → nombre, 0 si illisible. */
export function cachetAmount(cachet: string | null | undefined): number {
  const m = (cachet ?? "").replace(/\s| | /g, "").match(/\d+(?:[.,]\d+)?/);
  return m ? Math.round(Number(m[0].replace(",", ".")) * 100) / 100 : 0;
}

// ── Fiche collab : objets reliés et suggérés ────────────────────────────────

export type LinkTable = "briefs" | "todos" | "events" | "invoices" | "gifting";
type Raw = Record<string, unknown>;
/** Tables chargées telles quelles (`select *`), `collab_id` présent seulement après le SQL. */
export type LinkData = Record<LinkTable, Raw[]>;

export type LinkItem = {
  table: LinkTable;
  id: string;
  title: string;
  /** Une info sous le titre (date, statut, montant…). */
  meta: string;
  /** Argent en retard (facture) : seule la pastille rouge de l'app. */
  late?: boolean;
  /** Facture : montant affiché à droite. */
  amount?: string;
};
export type LinkGroups = Record<LinkTable, { linked: LinkItem[]; suggested: LinkItem[] }>;

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

/** Échéance d'une facture « JJ/MM/AAAA » ou ISO → dépassée ? (statut « retard » ou « attente » échue). */
function invoiceLate(r: Raw, now: Date): boolean {
  const status = str(r.status);
  if (status === "retard") return true;
  if (status !== "attente") return false;
  const t = str(r.date).trim();
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  const isoM = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  const d = fr ? new Date(Number(fr[3]), Number(fr[2]) - 1, Number(fr[1])) : isoM ? new Date(Number(isoM[1]), Number(isoM[2]) - 1, Number(isoM[3])) : null;
  if (!d) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return d.getTime() < today.getTime();
}

const BRIEF_STATUS: Record<string, string> = { attente: "En attente", valider: "À valider", cours: "En cours", "terminé": "Terminé", termine: "Terminé" };
const INVOICE_STATUS: Record<string, string> = { payee: "Payée", attente: "En attente", retard: "En retard", brouillon: "Brouillon" };

function toItem(table: LinkTable, r: Raw, now: Date, fmt: (v: unknown) => string): LinkItem {
  const id = str(r.id);
  switch (table) {
    case "briefs":
      return { table, id, title: str(r.brand) || "Brief", meta: [BRIEF_STATUS[str(r.status)] ?? "Brief", fmt(r.due)].filter(Boolean).join(" · ") };
    case "todos":
      return { table, id, title: str(r.text), meta: [r.done || str(r.status) === "Fait" ? "Faite" : str(r.status) || "À faire", fmt(r.due)].filter(Boolean).join(" · ") };
    case "events":
      return { table, id, title: str(r.title) || "Rendez-vous", meta: [fmt(r.date), str(r.time)].filter(Boolean).join(" · ") };
    case "invoices": {
      const late = invoiceLate(r, now);
      return { table, id, title: str(r.ref) || "Facture", meta: [late ? "En retard" : INVOICE_STATUS[str(r.status)] ?? str(r.status), fmt(r.date)].filter(Boolean).join(" · "), late, amount: str(r.amount) };
    }
    case "gifting":
      return { table, id, title: str(r.product) || str(r.brand) || "Gifting", meta: [str(r.brand), fmt(r.received_on)].filter(Boolean).join(" · ") };
  }
}

/** L'objet concerne-t-il cette collab, sans lien enregistré ? (marque + créateur) */
function suggests(table: LinkTable, r: Raw, c: Pick<CollabLite, "brand" | "creator">): boolean {
  switch (table) {
    case "briefs":
    case "gifting":
      return fold(str(r.brand)) === fold(c.brand) && concernsCreator(str(r.creator), c.creator);
    case "invoices":
      return mentionsBrand(str(r.party), c.brand) && concernsCreator(str(r.creator), c.creator);
    case "todos": {
      const names = Array.isArray(r.creators) && r.creators.length ? (r.creators as string[]) : str(r.creator);
      return mentionsBrand(str(r.text), c.brand) && concernsCreator(names, c.creator);
    }
    case "events":
      return mentionsBrand(str(r.title), c.brand) && concernsCreator(str(r.who), c.creator);
  }
}

export const LINK_TABLES: LinkTable[] = ["briefs", "todos", "events", "invoices", "gifting"];

/** Objets reliés à la collab (`collab_id`) puis suggestions (sans lien, même marque et créateur). */
export function linkGroups(c: CollabLite, data: LinkData, fmt: (v: unknown) => string, now: Date = new Date()): LinkGroups {
  const out = {} as LinkGroups;
  for (const table of LINK_TABLES) {
    const rows = (data[table] ?? []).filter((r) => !r.deleted);
    const linked = rows.filter((r) => r.collab_id === c.id);
    const suggested = rows.filter((r) => !r.collab_id && suggests(table, r, c));
    out[table] = { linked: linked.map((r) => toItem(table, r, now, fmt)), suggested: suggested.slice(0, 5).map((r) => toItem(table, r, now, fmt)) };
  }
  return out;
}
