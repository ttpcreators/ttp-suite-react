/*
 * Fiche marque (page Contacts) : « on a déjà bossé avec eux ? » en un coup d'œil.
 * Règles PURES (testées par brandRecord.test.ts), à partir de ce que l'agence lit déjà :
 *   • collabs de la marque (même marque, sans tenir compte des accents ni de la casse) ;
 *   • chiffre d'affaires = factures PAYÉES de la marque (champ `party` « Nike x Léna »,
 *     ou facture reliée à une de ses collabs) ;
 *   • gifts de la marque ;
 *   • historique mail = Gmail (déjà affiché) + `email_activity`, sans doublon.
 */
import { normBrand } from "./mailCollab";
import { parseAmount } from "./money";

export type BrandCollab = { id: string; brand: string; creator: string | null; step: number; status: string; cachet?: string | null; created_at?: string | null };
export type BrandInvoice = { id: string; party: string | null; amount: string | null; status: string | null; date?: string | null; collab_id?: string | null };
export type BrandGift = { id: string; brand: string | null; creator: string | null; product: string | null; value: string | null; received_on?: string | null };
export type BrandMail = { id: string; subject: string; date: string; snippet: string; direction: "in" | "out" };
export type ActivityRow = { id: string; gmail_message_id?: string | null; subject?: string | null; snippet?: string | null; direction?: string | null; created_at: string };

/** « Nike x Léna », « Nike × Léna », « Nike - campagne » → « Nike » (la marque est devant). */
export function partyBrand(party: string | null | undefined): string {
  return String(party ?? "").split(/\s+(?:x|×|\/|-|–|—)\s+/i)[0]?.trim() ?? "";
}

/** Même marque ? (« Décathlon » = « decathlon », « Alo Yoga » = « aloyoga »). */
export function sameBrand(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normBrand(a);
  const y = normBrand(b);
  if (!x || !y) return false;
  return x === y || x.replace(/ /g, "") === y.replace(/ /g, "");
}

export type BrandRecord = {
  collabs: BrandCollab[];
  /** Chiffre d'affaires encaissé (factures payées), null si les factures sont illisibles (membre). */
  revenue: number | null;
  /** Factures payées comptées dans le CA. */
  paidCount: number;
  gifts: BrandGift[];
};

const ACTIVE = new Set(["active"]);

export function brandRecord(
  brand: string | null | undefined,
  data: { collabs: BrandCollab[]; invoices: BrandInvoice[] | null; gifting: BrandGift[] },
): BrandRecord {
  const collabs = data.collabs
    .filter((c) => sameBrand(c.brand, brand))
    .sort((a, b) => Number(ACTIVE.has(b.status)) - Number(ACTIVE.has(a.status)) || String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  const ids = new Set(collabs.map((c) => c.id));
  let revenue: number | null = null;
  let paidCount = 0;
  if (data.invoices) {
    revenue = 0;
    for (const iv of data.invoices) {
      if (iv.status !== "payee") continue;
      if (!(iv.collab_id && ids.has(iv.collab_id)) && !sameBrand(partyBrand(iv.party), brand)) continue;
      revenue += parseAmount(iv.amount);
      paidCount += 1;
    }
    revenue = Math.round(revenue);
  }
  const gifts = data.gifting.filter((g) => sameBrand(g.brand, brand));
  return { collabs, revenue, paidCount, gifts };
}

const dayOf = (d: string) => {
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? "" : t.toISOString().slice(0, 10);
};
const subjKey = (s: string | null | undefined) => normBrand(String(s ?? "").replace(/^\s*((re|tr|fwd?)\s*:\s*)+/i, ""));

/**
 * Historique mail : les messages Gmail d'abord, plus les lignes `email_activity` qui n'y
 * sont pas déjà (même id Gmail, ou même sens, même objet et même jour). Du plus récent au
 * plus ancien.
 */
export function mergeMailHistory(gmail: BrandMail[], activity: ActivityRow[]): BrandMail[] {
  const ids = new Set(gmail.map((m) => m.id));
  const keys = new Set(gmail.map((m) => `${m.direction}|${subjKey(m.subject)}|${dayOf(m.date)}`));
  const extra: BrandMail[] = [];
  for (const a of activity) {
    if (a.gmail_message_id && ids.has(a.gmail_message_id)) continue;
    const direction = a.direction === "in" ? "in" : "out";
    const key = `${direction}|${subjKey(a.subject)}|${dayOf(a.created_at)}`;
    if (keys.has(key)) continue;
    keys.add(key);
    extra.push({ id: `act:${a.id}`, subject: (a.subject ?? "").trim(), date: a.created_at, snippet: (a.snippet ?? "").trim(), direction });
  }
  return [...gmail, ...extra].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
