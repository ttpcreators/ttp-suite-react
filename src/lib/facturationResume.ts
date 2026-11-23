import { parseAmount } from "./money";
import { isOverdueInvoice } from "./relance";

/**
 * Chiffres « à encaisser » du haut de la page Facturation (logique PURE, testée).
 * Avant (nov. 2026), la case « À encaisser TTC » affichait le NOMBRE de factures impayées
 * (« 1 ») à côté d'une case en euros : chaque case porte maintenant un montant en euros, et le
 * nombre de factures passe en légende.
 *   - à encaisser = factures émises pas encore payées (« En attente » ou « En retard »), TTC ;
 *   - en retard   = même règle que le badge (« En retard », ou « En attente » échue) ;
 *   - brouillons  = pas encore émises (ni comptées dans « à encaisser »).
 */
export type ResumeInvoice = { status: string; date: string | null; amount: string | null };

export type EncaisserResume = {
  aEncaisser: number;
  nbAEncaisser: number;
  nbRetard: number;
  brouillons: number;
  nbBrouillons: number;
};

export function encaisserResume(invoices: ResumeInvoice[], now: Date = new Date()): EncaisserResume {
  const unpaid = invoices.filter((r) => r.status === "attente" || r.status === "retard");
  const drafts = invoices.filter((r) => r.status === "brouillon");
  const sum = (list: ResumeInvoice[]) => Math.round(list.reduce((s, r) => s + parseAmount(r.amount), 0) * 100) / 100;
  return {
    aEncaisser: sum(unpaid),
    nbAEncaisser: unpaid.length,
    nbRetard: invoices.filter((r) => isOverdueInvoice(r, now)).length,
    brouillons: sum(drafts),
    nbBrouillons: drafts.length,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Légende sous « À encaisser » : « 1 facture en attente », « 3 factures, dont 1 en retard ». */
export function encaisserLegende(r: Pick<EncaisserResume, "nbAEncaisser" | "nbRetard">): string {
  if (r.nbAEncaisser === 0) return "Aucune facture en attente";
  if (r.nbRetard === 0) return `${plural(r.nbAEncaisser, "facture", "factures")} en attente`;
  return `${plural(r.nbAEncaisser, "facture", "factures")}, dont ${r.nbRetard} en retard`;
}

/** Légende sous « Brouillons » : « 4 factures pas encore émises ». */
export function brouillonsLegende(n: number): string {
  return n === 0 ? "Aucun brouillon" : `${plural(n, "facture pas encore émise", "factures pas encore émises")}`;
}
