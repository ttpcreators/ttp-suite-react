import { cachetAmount } from "@/lib/collabLinks";

/**
 * Gifting ou rémunéré : UNE règle pour les collabs (cachet) et les briefs (budget), pour que
 * Marc voie d'un coup d'œil s'il y a de l'argent en jeu.
 *   • « gifting », « offert », « produit », « en échange »… ou un montant à 0 → Gifting ;
 *   • un montant au-dessus de 0 → Rémunéré ;
 *   • vide ou « — » → inconnu (rien d'affiché : on ne devine pas).
 * Un texte qui cite les deux (« 300 € + produits offerts ») est rémunéré : il y a un cachet.
 */
export type DealKind = "gifting" | "paid";

const GIFT = /\b(gift(ing|ed)?|offert|offerte|offerts|cadeau|produits?|en [ée]change|sans r[ée]mun[ée]ration|non r[ée]mun[ée]r[ée]|b[ée]n[ée]vole|free)\b/i;

export function dealKind(amountText: string | null | undefined): DealKind | null {
  const t = String(amountText ?? "").trim();
  if (!t || /^[—–-]+$/.test(t)) return null;
  const n = cachetAmount(t);
  if (n > 0) return "paid";
  if (GIFT.test(t)) return "gifting";
  return /\d/.test(t) ? "gifting" : null; // « 0 », « 0 € »
}

/** Brief : son budget, sinon le cachet de sa collab. */
export function briefDealKind(budget: string | null | undefined, collabCachet?: string | null): DealKind | null {
  return dealKind(budget) ?? dealKind(collabCachet);
}
