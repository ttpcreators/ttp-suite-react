import { titleCase } from "@/lib/utils";

/*
 * Registre des contrats (page d'arrivée Contrats) : une seule liste lisible
 * construite à partir des DEUX historiques existants du blob app_state :
 *   - `brandContractHistory` : contrats Marque × Créateur et UGC (HTML archivé) ;
 *   - `contractHistory`      : contrats de représentation (config + fichier dans documents).
 * Fonctions pures (sans client Supabase) : testables.
 *
 * Statut : champ `status` facultatif sur chaque entrée d'historique. Absent (contrats
 * créés avant la page d'arrivée) = « En attente » : l'app n'a aucun moyen de savoir
 * qu'un document signé existe (la table documents n'a pas de notion de signature).
 */

export type CtType = "marque" | "repr" | "ugc";
export type ContractStatus = "signed" | "pending" | "changes";
export type HistKey = "brandContractHistory" | "contractHistory";

export const CT_TYPES: CtType[] = ["marque", "repr", "ugc"];

export const TYPE_META: Record<CtType, { label: string; hint: string; dot: string }> = {
  marque: { label: "Marque × Créateur", hint: "Partenariat commercial entre une marque et un créateur", dot: "bg-primary" },
  repr: { label: "Représentation", hint: "Contrat d'agent entre TTP et un créateur", dot: "bg-signal" },
  ugc: { label: "UGC", hint: "Cession de droits sur des contenus UGC", dot: "bg-info" },
};

export const STATUSES: ContractStatus[] = ["signed", "pending", "changes"];

export const STATUS_META: Record<ContractStatus, { label: string; dot: string; text: string }> = {
  signed: { label: "Signé", dot: "bg-ok", text: "text-ok" },
  pending: { label: "En attente", dot: "bg-wait", text: "text-wait" },
  changes: { label: "Modifs demandées", dot: "bg-progress", text: "text-progress" },
};

/** Valeur stockée → statut connu (« En attente » par défaut, libellés français tolérés). */
export function normStatus(v: unknown): ContractStatus {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "signed" || s === "signé" || s === "signe") return "signed";
  if (s === "changes" || s.startsWith("modif")) return "changes";
  return "pending";
}

/** Une ligne de la liste « Tes contrats », quel que soit l'historique d'origine. */
export type ContractRow = {
  id: string;
  key: HistKey;
  type: CtType;
  /** Marque (vide pour la représentation). */
  brand: string;
  /** Nom du créateur tel que stocké (clé du roster), null si externe / inconnu. */
  creator: string | null;
  /** Nom affiché du créateur. */
  creatorLabel: string;
  /** Référence imprimée sur le contrat, ou la formule pour la représentation. */
  ref: string;
  ts: number;
  status: ContractStatus;
  title: string;
};

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const VARIANT_LABEL: Record<string, string> = { exclusif: "Formule exclusive", nonexclusif: "Formule non exclusive" };

/** Les deux historiques bruts → lignes bien formées (entrées d'un autre format ignorées). */
export function buildRows(brandHist: unknown, reprHist: unknown): ContractRow[] {
  const rows: ContractRow[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(brandHist) ? brandHist : []) {
    const e = rec(raw);
    if (!e || typeof e.id !== "string" || typeof e.html !== "string") continue;
    const type: CtType = e.ctType === "ugc" || e.ctType === "repr" ? e.ctType : "marque";
    const name = str(e.ctName).trim();
    const known = !!name && name !== "[Créateur]";
    const key = `b:${e.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      id: e.id,
      key: "brandContractHistory",
      type,
      brand: str(e.brand).trim(),
      creator: known ? name : null,
      creatorLabel: known ? titleCase(name) : "Créateur",
      ref: str(e.ref),
      ts: Number(e.ts) || 0,
      status: normStatus(e.status),
      title: str(e.title) || "Contrat",
    });
  }
  for (const raw of Array.isArray(reprHist) ? reprHist : []) {
    const e = rec(raw);
    // Même garde que la page Représentation : le blob a pu contenir un temps des entrées d'un autre format.
    if (!e || typeof e.id !== "string" || typeof e.path !== "string" || !rec(e.config)) continue;
    const key = `r:${e.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cfg = rec(e.config) ?? {};
    const creator = str(e.creator).trim() || null;
    const talent = str(cfg.talentNom).trim();
    const ts = Date.parse(str(e.createdAt));
    rows.push({
      id: e.id,
      key: "contractHistory",
      type: "repr",
      brand: "",
      creator,
      creatorLabel: creator ? titleCase(creator) : talent || "Externe",
      ref: VARIANT_LABEL[str(e.variante)] ?? "Représentation",
      ts: Number.isFinite(ts) ? ts : 0,
      status: normStatus(e.status),
      title: str(e.title) || "Contrat de représentation",
    });
  }
  return rows;
}

/** « Saucony × Candice » ; la représentation lie l'agence au créateur. */
export function rowName(r: Pick<ContractRow, "type" | "brand" | "creatorLabel">): string {
  const left = r.type === "repr" ? "TTP Creators" : r.brand || "Marque";
  return `${left} × ${r.creatorLabel}`;
}

export type StatusTab = "all" | ContractStatus;
export type SortKey = "recent" | "name";
export type RowFilter = { tab: StatusTab; q: string; creator: string; type: "" | CtType };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Onglet (statut) + recherche (marque, créateur, référence) + filtres créateur et type. */
export function filterRows(rows: ContractRow[], f: RowFilter): ContractRow[] {
  const q = fold(f.q);
  return rows.filter((r) => {
    if (f.tab !== "all" && r.status !== f.tab) return false;
    if (f.type && r.type !== f.type) return false;
    if (f.creator && fold(r.creator ?? r.creatorLabel) !== fold(f.creator)) return false;
    if (!q) return true;
    return [r.brand, r.creatorLabel, r.creator ?? "", r.ref, r.title, TYPE_META[r.type].label].some((v) => fold(v).includes(q));
  });
}

export function sortRows(rows: ContractRow[], by: SortKey): ContractRow[] {
  const out = rows.slice();
  if (by === "name") out.sort((a, b) => fold(rowName(a)).localeCompare(fold(rowName(b)), "fr") || b.ts - a.ts);
  else out.sort((a, b) => b.ts - a.ts);
  return out;
}

export function countByStatus(rows: ContractRow[]): Record<ContractStatus, number> {
  const c: Record<ContractStatus, number> = { signed: 0, pending: 0, changes: 0 };
  for (const r of rows) c[r.status] += 1;
  return c;
}

export type Category = { type: CtType; count: number; creators: string[]; brands: string[] };

/** Catégories = types de contrat : nombre de documents, créateurs concernés (du plus
 *  récent au plus ancien), marques distinctes. */
export function buildCategories(rows: ContractRow[]): Category[] {
  return CT_TYPES.map((type) => {
    const list = sortRows(rows.filter((r) => r.type === type), "recent");
    const creators: string[] = [];
    const brands: string[] = [];
    for (const r of list) {
      const c = r.creator ?? r.creatorLabel;
      if (c && !creators.some((x) => fold(x) === fold(c))) creators.push(c);
      if (r.brand && !brands.some((x) => fold(x) === fold(r.brand))) brands.push(r.brand);
    }
    return { type, count: list.length, creators, brands };
  });
}

export type BrandContact = { brand: string | null; email: string | null; person?: string | null; first_name?: string | null; creator?: string | null };

/** Contact (avec e-mail) d'une marque : nom de marque identique, contact agence d'abord. */
export function findBrandContact<T extends BrandContact>(contacts: T[], brand: string): T | null {
  const b = fold(brand);
  if (!b) return null;
  const ok = contacts.filter((c) => fold(c.brand ?? "") === b && /@/.test(c.email ?? ""));
  return ok.find((c) => !c.creator) ?? ok[0] ?? null;
}

/** Objet + texte de la relance de signature. */
export function relanceDraft(r: ContractRow, firstName?: string | null): { subject: string; body: string } {
  const hello = firstName?.trim() ? `Bonjour ${firstName.trim()},` : "Bonjour,";
  if (r.type === "repr") {
    // Le créateur : on le tutoie, comme partout dans l'app.
    return {
      subject: "Contrat de représentation : signature en attente",
      body: `${hello.replace("Bonjour", "Hello")}\n\nPetit rappel pour notre contrat de représentation, préparé le ${fmtDate(r.ts)} : il attend encore ta signature.\n\nTu peux nous le renvoyer signé quand tu as un moment ? Si un point te pose question, dis-le-nous, on l'ajuste.\n\nMerci !`,
    };
  }
  const ref = r.ref ? ` (réf. ${r.ref})` : "";
  return {
    subject: `Contrat ${rowName(r)} : signature en attente`,
    body: `${hello}\n\nPetit rappel concernant le contrat ${rowName(r)}${ref}, préparé le ${fmtDate(r.ts)} : il attend encore votre signature.\n\nPouvez-vous nous le retourner signé quand vous avez un moment ? Si un point vous pose question, dites-le-nous, nous l'ajustons.\n\nMerci beaucoup,`,
  };
}

/** 10 oct. 2026 */
export function fmtDate(ts: number): string {
  if (!ts) return "date inconnue";
  return new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

export const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
