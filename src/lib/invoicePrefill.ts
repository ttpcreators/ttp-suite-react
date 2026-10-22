/*
 * « Créer le devis » (page Tarifs) ou « Créer la facture » (fiche collab) : la page Facturation s'ouvre sur une nouvelle facture
 * en brouillon, lignes déjà remplies. Le passage se fait par le stockage de l'onglet
 * (lu une fois, puis effacé).
 */
import type { QuoteLine } from "./pricingForm";

/** `collabId` : facture créée depuis une collab (reliée à l'enregistrement). */
export type InvoicePrefill = { creator: string; brand: string; lines: QuoteLine[]; collabId?: string };

const KEY = "ttp:invoice-prefill";

export function putInvoicePrefill(p: InvoicePrefill): boolean {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

/** Lit le devis préparé et l'efface (null s'il n'y en a pas ou s'il est illisible). */
export function takeInvoicePrefill(): InvoicePrefill | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const v = JSON.parse(raw) as InvoicePrefill;
    return v && Array.isArray(v.lines) ? v : null;
  } catch {
    return null;
  }
}
