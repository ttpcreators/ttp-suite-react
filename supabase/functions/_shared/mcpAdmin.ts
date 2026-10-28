// ============================================================================
// _shared/mcpAdmin.ts : « accès complet » de Claude à l'app (connecteur ttp-mcp, outils
// réservés aux fondateurs). Règles PURES, testées par mcpAdmin.test.ts :
//   • tables lisibles / modifiables, colonnes interdites (jetons, synchro Google…) ;
//   • suppression = Corbeille de l'app (blob trashBin), restaurable 30 jours ;
//   • facture : mêmes calculs que la page Facturation (lignes, TVA, numéro « AAAA-NNN »).
// ============================================================================

export type TableRule = {
  /** Libellé lisible (Corbeille, réponses de Claude). */
  label: string;
  /** Colonnes de recherche (texte). */
  search: string[];
  /** Clé de la ligne (« id » par défaut). */
  key?: string;
  /** Suppression possible : « corbeille » (blob trashBin) ou « tombstone » (events, synchro Google). */
  remove?: "corbeille" | "tombstone";
  /** Création refusée (ex. documents : il faut un fichier). */
  noCreate?: boolean;
  /** Colonnes modifiables seulement (sinon : toutes sauf les interdites). */
  only?: string[];
};

export const TABLES: Record<string, TableRule> = {
  contacts: { label: "Contact", search: ["brand", "person", "email", "instagram"], remove: "corbeille" },
  creators: { label: "Créateur", search: ["name", "handle", "email", "email_pro"], remove: "corbeille" },
  collabs: { label: "Collab", search: ["brand", "creator", "title"], remove: "corbeille" },
  collab_steps: { label: "Étape de collab", search: ["step", "note"] },
  briefs: { label: "Brief", search: ["brand", "creator", "consignes"], remove: "corbeille" },
  invoices: { label: "Facture", search: ["ref", "party", "creator"], remove: "corbeille", noCreate: true, only: ["status", "date", "creator", "collab_id"] },
  todos: { label: "À faire", search: ["text", "descr", "creator", "tag"], remove: "corbeille" },
  todo_routines: { label: "Routine", search: ["text"] },
  events: { label: "Rendez-vous", search: ["title", "who", "description"], remove: "tombstone" },
  gifting: { label: "Gifting", search: ["brand", "creator", "product"], remove: "corbeille" },
  documents: { label: "Document", search: ["name", "creator"], noCreate: true, only: ["name", "type", "creator"] },
  ideas: { label: "Idée", search: ["text", "creator"], remove: "corbeille" },
  prospects: { label: "Prospect", search: ["brand", "contact", "creator"], remove: "corbeille" },
  creator_pool: { label: "Scouting créateur", search: ["name", "handle", "email", "note"], remove: "corbeille" },
  athlete_pool: { label: "Scouting sportif", search: ["name", "handle", "email", "club"], remove: "corbeille" },
  creator_roadmap: { label: "Feuille de route", search: ["creator"], key: "creator" },
  creator_mail_settings: { label: "Réglage Mails du créateur", search: ["creator", "alias"], key: "creator" },
  ig_threads: { label: "Conversation Instagram", search: ["username", "name", "last_text"], noCreate: true, only: ["hidden", "contact_id"] },
  email_sequences: { label: "Séquence d'emails", search: ["name"] },
  agency_mediakit: { label: "Media kit agence", search: [] },
};

/** Jamais écrites par Claude : clés, horodatages techniques, synchro Google / Meta. */
const SYSTEM = new Set(["id", "created_at", "updated_at", "google_event_id", "google_etag", "last_synced_at", "sync_source", "synced_at", "igsid"]);
const SECRET = /token|secret|password|passwd|mdp|cred|iban|bic/i;

/** Champs autorisés pour une écriture, et ceux refusés (pour le dire à Claude). */
export function writableFields(table: string, fields: Record<string, unknown>): { ok: Record<string, unknown>; refused: string[] } {
  const rule = TABLES[table];
  const ok: Record<string, unknown> = {};
  const refused: string[] = [];
  for (const [k, v] of Object.entries(fields ?? {})) {
    const bad = !/^[a-z_][a-z0-9_]{0,40}$/.test(k) || SYSTEM.has(k) || SECRET.test(k) || (rule?.only && !rule.only.includes(k));
    if (bad) refused.push(k);
    else ok[k] = v;
  }
  return { ok, refused };
}

/** Ligne lisible par Claude : sans colonnes sensibles, valeurs très longues raccourcies. */
export function readableRow(row: Record<string, unknown>, max = 1500): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (SECRET.test(k)) continue;
    const s = typeof v === "string" ? v : v == null ? v : JSON.stringify(v);
    out[k] = typeof s === "string" && s.length > max ? `${s.slice(0, max)}… (${s.length} caractères)` : v;
  }
  return out;
}

/** Clés du blob agence jamais lues ni écrites par Claude. */
export function blockedSetting(key: string): boolean {
  return key === "credVault" || key === "trashBin" || SECRET.test(key);
}

// ── Factures (mêmes règles que la page Facturation et src/lib/invoice.ts) ─────
export type InvoiceLine = { id: string; label: string; qty: number; unit: number };
export const cents = (n: number): number => (Number.isFinite(n) ? Math.round(n * 100) / 100 || 0 : 0);
const COMMISSION_FLOOR_EUR = 100;

export function invoiceTotals(items: InvoiceLine[], franchise: boolean, vatRate: number, commissionRate: number) {
  const ht = cents(items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unit) || 0), 0));
  const tva = franchise ? 0 : cents(ht * ((Number(vatRate) || 0) / 100));
  const ttc = cents(ht + tva);
  const commission = ht < COMMISSION_FLOOR_EUR ? 0 : cents(ht * ((Number(commissionRate) || 0) / 100));
  return { ht, tva, ttc, commission, reversal: cents(ht - commission) };
}

/** Prochain numéro « AAAA-NNN » (comme Facturation : le plus grand numéro + 1, à partir de 181). */
export function nextInvoiceRef(refs: string[], year = new Date().getFullYear()): string {
  const max = refs.reduce((m, ref) => Math.max(m, Number(String(ref).split("-").pop()) || 0), 180);
  return `${year}-${String(max + 1).padStart(3, "0")}`;
}

/** « 1 273,00 € » (espaces insécables), le format du montant enregistré. */
export function euro2(n: number): string {
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true })
    .format(Number.isFinite(n) ? n : 0).replace(/[ \s]/g, " ") + " €";
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
/** Libellé de la facture : « Marque × Prénom » (comme Facturation). */
export function invoiceParty(brand: string, creator?: string | null): string {
  const b = brand.trim();
  return creator?.trim() ? `${b} × ${titleCase(creator.trim()).split(" ")[0]}` : b;
}

/** « 25 % », « 25,5 » → 25,5 ; null si illisible. */
export function pct(v: unknown): number | null {
  const m = /(\d+(?:[.,]\d+)?)/.exec(String(v ?? ""));
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

// ── Mails envoyés par Claude ─────────────────────────────────────────────────
const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
/** Texte → HTML (retours à la ligne, liens cliquables) + signature de l'agence (Réglages Mails). */
export function mailHtml(text: string, signatureHtml = ""): string {
  const body = escHtml(text.trim()).replace(/\b(?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)]/gi, (u) => `<a href="${/^www\./i.test(u) ? "https://" + u : u}">${u}</a>`);
  const sig = signatureHtml.trim() ? `<br><div class="ttp-signature">${signatureHtml}</div>` : "";
  return `<div style="font-family:system-ui,Arial,sans-serif;font-size:14px;line-height:1.6;white-space:pre-line">${body}</div>${sig}`;
}

/** Liste d'adresses (« a@b.fr, c@d.com ») ; null si l'une est invalide. */
export function addressList(v: unknown): string[] | null {
  const list = (Array.isArray(v) ? v : String(v ?? "").split(/[,;\s]+/)).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  return list.every((x) => /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/.test(x)) ? [...new Set(list)] : null;
}
