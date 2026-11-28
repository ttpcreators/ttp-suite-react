// ============================================================================
// _shared/lignesFacture.ts : bornes des factures et des devis préparés par le connecteur
// (outils preparer_facture et preparer_devis de ttp-mcp/admin.ts). Logique PURE, testée par
// lignesFacture.test.ts.
//   • quantité : un nombre fini, plus grand que 0 et au plus QTE_MAX (absente = 1) ;
//   • prix HT : un nombre fini, au plus PRIX_MAX en valeur absolue (une ligne de remise
//     négative reste possible) ;
//   • commission : entre 0 et 100 % ; TVA : un des taux français (TVA_PERMISES) ;
//   • total HT : plus grand que 0. Un avoir se prépare dans l'app, pas par le connecteur.
// ============================================================================

export const QTE_MAX = 10_000;
export const PRIX_MAX = 1_000_000;
export const TVA_PERMISES = [0, 2.1, 5.5, 10, 20] as const;

export type LigneLue = { id: string; label: string; qty: number; unit: number };
type Json = Record<string, unknown>;

/** Lignes reçues par l'outil → lignes de facture, ou la raison du refus (numéro de ligne compris). */
export function lireLignes(brutes: unknown[], prefixeId: string, libelle: (v: unknown) => string): { items: LigneLue[] } | { error: string } {
  const items: LigneLue[] = [];
  for (let i = 0; i < brutes.length; i++) {
    const l = (brutes[i] && typeof brutes[i] === "object" ? brutes[i] : {}) as Json;
    const qty = l.quantite == null || l.quantite === "" ? 1 : Number(l.quantite);
    const unit = typeof l.prix_ht === "number" || typeof l.prix_ht === "string" ? Number(l.prix_ht) : NaN;
    if (!Number.isFinite(qty) || qty <= 0 || qty > QTE_MAX) return { error: `Ligne ${i + 1} : quantité refusée (un nombre plus grand que 0, au plus ${QTE_MAX}).` };
    if (!Number.isFinite(unit)) return { error: `Ligne ${i + 1} : prix HT illisible.` };
    if (Math.abs(unit) > PRIX_MAX) return { error: `Ligne ${i + 1} : prix HT refusé (au plus ${PRIX_MAX} en valeur absolue).` };
    items.push({ id: `${prefixeId}${i}`, label: libelle(l.libelle), qty, unit });
  }
  return { items };
}

/** Commission et TVA DONNÉES par l'appel (une valeur absente n'est pas contrôlée ici). */
export function problemeTaux(a: { commission?: unknown; tva?: unknown }): string | null {
  if (a.commission !== undefined) {
    const c = a.commission;
    if (typeof c !== "number" || !Number.isFinite(c) || c < 0 || c > 100) return "Commission refusée : un pourcentage entre 0 et 100.";
  }
  if (a.tva !== undefined) {
    const t = a.tva;
    if (typeof t !== "number" || !(TVA_PERMISES as readonly number[]).includes(t)) return `TVA refusée : choisis parmi ${TVA_PERMISES.map((x) => String(x).replace(".", ",")).join(", ")} %.`;
  }
  return null;
}

/** Total HT d'une facture ou d'un devis : nul ou négatif, refus (un avoir se fait dans l'app). */
export function problemeTotalHt(ht: number): string | null {
  return Number.isFinite(ht) && ht > 0 ? null : "Total HT nul ou négatif : un avoir se prépare dans l'app (Facturation).";
}
