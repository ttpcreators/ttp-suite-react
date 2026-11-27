/**
 * Devis (onglet Devis de Facturation). Un devis n'est PAS une facture : il ne compte ni dans
 * le chiffre d'affaires, ni dans les relances, ni dans les gains du créateur. Il vit dans le
 * blob agence (clé `quotes`, liste écrite entrée par entrée) et se transforme en facture
 * une fois accepté.
 */
import { CACHET_DEVISES, ecrireCachet, type CachetDevise } from "../../supabase/functions/_shared/cachet.ts";

export type QuoteStatus = "brouillon" | "envoye" | "accepte" | "refuse";
/** Statut AFFICHÉ : un devis brouillon ou envoyé dont la date de validité est passée est « expiré ». */
export type QuoteShownStatus = QuoteStatus | "expire";

export const QUOTE_STATUS_OPTIONS: { value: QuoteStatus; label: string }[] = [
  { value: "brouillon", label: "Brouillon" },
  { value: "envoye", label: "Envoyé" },
  { value: "accepte", label: "Accepté" },
  { value: "refuse", label: "Refusé" },
];

export const QUOTE_STATUS_LABEL: Record<QuoteShownStatus, string> = {
  brouillon: "Brouillon",
  envoye: "Envoyé",
  accepte: "Accepté",
  refuse: "Refusé",
  expire: "Expiré",
};

/** Durée de validité proposée pour un nouveau devis. */
export const QUOTE_VALIDITY_DAYS = 30;

/** Prochain numéro « D-AAAA-NNN » : la suite de l'année en cours, à partir de 001. */
export function nextQuoteRef(refs: string[], year = new Date().getFullYear()): string {
  const prefix = `D-${year}-`;
  const max = refs.reduce((m, ref) => {
    if (!String(ref).startsWith(prefix)) return m;
    return Math.max(m, Number(String(ref).slice(prefix.length)) || 0);
  }, 0);
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

/** Statut affiché : brouillon ou envoyé dont la validité (ISO « AAAA-MM-JJ ») est passée → expiré. */
export function quoteShownStatus(q: { status: string; validUntil?: string | null }, today: string): QuoteShownStatus {
  const status = (QUOTE_STATUS_LABEL as Record<string, string>)[q.status] && q.status !== "expire" ? (q.status as QuoteStatus) : "brouillon";
  const until = String(q.validUntil ?? "").slice(0, 10);
  if ((status === "brouillon" || status === "envoye") && /^\d{4}-\d{2}-\d{2}$/.test(until) && until < today) return "expire";
  return status;
}

/** Date ISO décalée de `days` jours (validité par défaut d'un devis). */
export function addDaysISO(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Devis accepté → collab (constat WC1) ─────────────────────────────────────
// Un devis accepté ne crée rien tout seul : une collab automatique doublonnerait celle créée
// depuis Prospection (« La marque a dit oui »). Il PROPOSE un bouton « Créer la collab » qui
// ouvre le formulaire de Collabs prérempli ; une fois la collab créée, le prospect ouvert de la
// marque passe « Signé » comme pour toute collab (autoCollabSignee).

const plie = (s: string | null | undefined) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
type CollabLegere = { brand: string | null; creator: string | null; status: string | null; step?: number | null };
/** Collab encore en cours de travail : active ou gagnée, avant le bilan (étape 11). */
const enCours = (c: CollabLegere) => (c.status === "active" || c.status === "gagnee") && (Number(c.step) || 0) < 11;

/** Proposer « Créer la collab » : devis accepté, pas déjà relié à une collab, et aucune collab en cours pour cette marque et ce créateur. */
export function collabAProposer(q: { status: string; brand: string; creator?: string | null; collabId?: string | null }, collabs: readonly CollabLegere[] | null): boolean {
  if (q.status !== "accepte" || q.collabId || !plie(q.brand) || !collabs) return false;
  return !collabs.some((c) => enCours(c) && plie(c.brand) === plie(q.brand) && plie(c.creator) === plie(q.creator));
}

export type CollabPrefill = { brand: string; creator: string; deliverables: string; cachet: string };

/** Devise du devis que le champ Cachet sait écrire (EUR, USD, GBP, CHF) ; sans devise : EUR ; autre : null. */
function deviseDuDevis(currency: string | null | undefined): CachetDevise | null {
  const d = String(currency || "EUR").trim().toUpperCase();
  return (CACHET_DEVISES as readonly string[]).includes(d) ? (d as CachetDevise) : null;
}

/**
 * Formulaire de collab prérempli depuis un devis : marque, créateur, livrables (lignes du devis),
 * cachet HT dans la devise du devis (« 1 500 $ HT » pour un devis en dollars : jamais des euros,
 * la facture reprend ensuite le cachet). Devise inconnue : cachet laissé vide.
 */
export function collabDepuisDevis(q: { brand: string; creator?: string | null; currency?: string | null; items?: { label?: string | null }[] | null }, ht: number): CollabPrefill {
  const lignes = (q.items ?? []).map((it) => String(it?.label ?? "").trim()).filter(Boolean);
  const devise = deviseDuDevis(q.currency);
  const cachet = ht > 0 && devise ? ecrireCachet({ montant: ht, devise, affiliation: false }) : null;
  return {
    brand: q.brand.trim(),
    creator: String(q.creator ?? "").trim(),
    deliverables: lignes.join(", "),
    cachet: cachet ? `${cachet} HT` : "",
  };
}

/** Lit le préremplissage passé à Collabs (« collab:new », JSON) ; null si absent ou illisible. */
export function lireCollabPrefill(data: string | undefined): CollabPrefill | null {
  if (!data) return null;
  try {
    const o = JSON.parse(data) as Partial<CollabPrefill>;
    if (!o || typeof o !== "object" || typeof o.brand !== "string" || !o.brand.trim()) return null;
    const txt = (v: unknown) => (typeof v === "string" ? v : "");
    return { brand: o.brand.trim(), creator: txt(o.creator), deliverables: txt(o.deliverables), cachet: txt(o.cachet) };
  } catch {
    return null;
  }
}
