/*
 * « Créer le devis » (page Tarifs) ou « Créer la facture » (fiche collab) : la page Facturation s'ouvre sur une nouvelle facture
 * en brouillon, lignes déjà remplies. Le passage se fait par le stockage de l'onglet
 * (lu une fois, puis effacé).
 */
import type { QuoteLine } from "./pricingForm";

/**
 * `collabId` : facture créée depuis une collab (reliée à l'enregistrement).
 * `kind: "commission"` : facture de la commission de l'agence AU CRÉATEUR (la marque a payé
 * le créateur, page Compta) ; `brand` porte alors le nom du créateur facturé, `creator` est vide
 * (aucun reversement, invisible dans l'espace du créateur), `franchise` suit le régime de TVA.
 */
export type InvoicePrefill = { creator: string; brand: string; lines: QuoteLine[]; collabId?: string; kind?: "commission"; franchise?: boolean };

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
