/*
 * Notifications d'argent au créateur (constat W15). Jamais de montant ni de référence
 * interne (numéro de facture) dans une notification : elle s'affiche sur l'écran verrouillé.
 *   - « La marque a payé » (brand-paid) : la facture de la marque passe payée ET donne lieu à
 *     un reversement : pas une facture de commission, pas une collab où la marque paie le
 *     créateur en direct (encaissement « createur », page Compta) ;
 *   - « Versement envoyé » (payout) : un versement est noté dans Reversements ; {objet} = les
 *     marques des factures que ce versement couvre, les plus anciennes d'abord (même règle
 *     que la page Reversements).
 * Le serveur compose le texte dans la langue du créateur à partir de {objet}.
 * Logique pure, testée par argentPush.test.ts.
 */
import { cashModeFor } from "./compta";
import { partyBrand } from "./brandRecord";

/** Écart d'arrondi toléré, comme PAYOUT_TOLERANCE_EUR. */
const TOLERANCE = 0.5;
const cents = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 || 0 : 0);
const cle = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** La facture payée donne-t-elle un reversement au créateur ? */
export function factureDonneReversement(f: { kind?: string | null; collabId?: string | null }, collabModes: Record<string, string>): boolean {
  return f.kind !== "commission" && cashModeFor(f.collabId ?? null, null, collabModes, {}) !== "createur";
}

/** Facture due au créateur (ligne de la page Reversements). `brand` : le libellé « Marque × Prénom ». */
export type LigneVersee = { id: string; brand: string; paidOn: string; du: number };

/**
 * Marques des factures que ce versement touche : les virements couvrent d'abord les factures
 * les plus anciennes ; `dejaVerse` = total versé au créateur AVANT ce versement.
 */
export function marquesDuVersement(lignes: readonly LigneVersee[], dejaVerse: number, montant: number): string[] {
  let avant = cents(Math.max(0, dejaVerse));
  let reste = cents(montant);
  const out: string[] = [];
  const triees = [...lignes].sort((x, y) => x.paidOn.localeCompare(y.paidOn) || x.id.localeCompare(y.id));
  for (const l of triees) {
    if (reste <= TOLERANCE) break;
    const du = cents(l.du);
    const couvert = cents(Math.max(0, Math.min(du, avant)));
    avant = cents(avant - couvert);
    const ouvert = cents(du - couvert);
    if (ouvert <= TOLERANCE) continue;
    reste = cents(reste - Math.min(ouvert, reste));
    const marque = partyBrand(l.brand);
    if (marque && !out.some((m) => cle(m) === cle(marque))) out.push(marque);
  }
  return out;
}

/** {objet} d'une notification de versement : trois marques au plus. */
export function objetMarques(marques: readonly string[]): string {
  return marques.length > 3 ? `${marques.slice(0, 3).join(", ")}…` : marques.join(", ");
}
