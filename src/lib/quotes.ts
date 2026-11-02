/**
 * Devis (onglet Devis de Facturation). Un devis n'est PAS une facture : il ne compte ni dans
 * le chiffre d'affaires, ni dans les relances, ni dans les gains du créateur. Il vit dans le
 * blob agence (clé `quotes`, liste écrite entrée par entrée) et se transforme en facture
 * une fois accepté.
 */

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
