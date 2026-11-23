import type { StatusTone } from "./statusTone";
import { cents, PAYOUT_TOLERANCE_EUR } from "./invoice";
import { toISODate } from "./dates";
import { invoiceNet, type RealPayout, type ReportDetail, type ReportInvoice } from "./creatorGains";

/**
 * « Ce qu'on te doit » (espace créateur, page Gains), collab par collab (logique PURE,
 * testée). Données de la fonction serveur `creator-report`, filtrées sur le créateur :
 * ses factures (avec collab et date de paiement), le détail de ses factures, ses
 * virements reçus (blob `creatorPayouts`). Même règle que la page Reversements
 * (src/lib/reversements.ts, `allocate`) : les virements couvrent les factures payées par
 * la marque, les plus anciennes d'abord.
 *   - « marque »  : la marque n'a pas encore payé (date = échéance de la facture) ;
 *   - « arrive »  : la marque a payé, le versement de l'agence arrive ;
 *   - « verse »   : versé (date = jour du virement qui a soldé la facture).
 */

export type OwedInvoice = ReportInvoice & { collab_id?: string | null; paid_at?: string | null };
export type OwedKey = "marque" | "arrive" | "verse";
export type OwedLine = {
  key: string;
  collabId: string | null;
  /** Marque de la collab, sinon le client de la facture. */
  brand: string;
  amount: number;
  status: OwedKey;
  /** AAAA-MM-JJ : échéance (marque) ou jour du versement (versé) ; null sinon. */
  date: string | null;
};

/** Texte, pastille et couleur de chaque statut (clés françaises, traduites à l'affichage). */
export const OWED_LABEL: Record<OwedKey, { text: string; pill: string; tone: StatusTone }> = {
  marque: { text: "La marque n'a pas encore payé", pill: "En attente", tone: "wait" },
  arrive: { text: "Payée, ton versement arrive", pill: "En cours", tone: "progress" },
  verse: { text: "Versé le {date}", pill: "Versé", tone: "ok" },
};

const ORDER: Record<OwedKey, number> = { arrive: 0, marque: 1, verse: 2 };
const day = (v: unknown) => toISODate(v) || null;

export function owedByCollab(input: {
  invoices: OwedInvoice[];
  details: Record<string, ReportDetail>;
  payouts: RealPayout[];
  ratePct: number;
  /** Ses collabs (marque affichée). */
  collabs?: { id: string; brand: string | null }[];
  /** Factures sans reversement (commission, ou la marque paie le créateur). */
  skip?: ReadonlySet<string>;
}): OwedLine[] {
  const brandOfCollab = new Map((input.collabs ?? []).map((c) => [c.id, String(c.brand ?? "").trim()]));
  const lines = new Map<string, OwedLine>();
  const add = (inv: OwedInvoice, status: OwedKey, amount: number, date: string | null) => {
    if (amount <= 0) return;
    const collabId = inv.collab_id ?? null;
    const key = `${collabId ?? `inv:${inv.id}`}:${status}`;
    const cur = lines.get(key);
    if (!cur) {
      const brand = (collabId && brandOfCollab.get(collabId)) || String(inv.party ?? "").trim();
      lines.set(key, { key, collabId, brand, amount: cents(amount), status, date });
      return;
    }
    cur.amount = cents(cur.amount + amount);
    // Échéance la plus proche ; versement le plus récent.
    if (date && (!cur.date || (status === "verse" ? date > cur.date : date < cur.date))) cur.date = date;
  };

  const paid: { inv: OwedInvoice; net: number; paidOn: string }[] = [];
  for (const inv of input.invoices) {
    if (inv.status === "annulee" || input.skip?.has(inv.id)) continue;
    const net = invoiceNet(inv, input.details, input.ratePct);
    if (net <= 0) continue;
    if (inv.status === "payee") paid.push({ inv, net, paidOn: String(day(inv.paid_at) ?? day(inv.date) ?? "") });
    else add(inv, "marque", net, day(inv.date));
  }

  // Virements, les plus anciens d'abord, répartis sur les factures payées les plus anciennes.
  const pays = input.payouts
    .map((p) => ({ date: day(p.date), amount: cents(Number(p.amount) || 0) }))
    .filter((p) => p.amount > 0)
    .sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
  let pi = 0;
  let left = pays[0]?.amount ?? 0;
  paid.sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.inv.id.localeCompare(b.inv.id));
  for (const p of paid) {
    let need = p.net;
    let covered = 0;
    let lastDate: string | null = null;
    while (need > 0 && pi < pays.length) {
      const take = cents(Math.min(need, left));
      covered = cents(covered + take);
      need = cents(need - take);
      left = cents(left - take);
      if (take > 0) lastDate = pays[pi].date;
      if (left <= 0) {
        pi += 1;
        left = pays[pi]?.amount ?? 0;
      }
    }
    const rest = cents(p.net - covered);
    // Un reste sous la tolérance est un écart d'arrondi : la facture est versée.
    if (rest <= PAYOUT_TOLERANCE_EUR) {
      if (covered > 0) add(p.inv, "verse", p.net, lastDate);
    } else {
      add(p.inv, "verse", covered, lastDate);
      add(p.inv, "arrive", rest, null);
    }
  }

  return [...lines.values()].sort((a, b) => {
    if (a.status !== b.status) return ORDER[a.status] - ORDER[b.status];
    if (a.status === "verse") return String(b.date ?? "").localeCompare(String(a.date ?? ""));
    if (a.date !== b.date) return !a.date ? 1 : !b.date ? -1 : a.date.localeCompare(b.date);
    return a.brand.localeCompare(b.brand);
  });
}

/** Total encore dû (marque pas payée + versement qui arrive). */
export function owedTotal(lines: OwedLine[]): number {
  return cents(lines.filter((l) => l.status !== "verse").reduce((s, l) => s + l.amount, 0));
}
