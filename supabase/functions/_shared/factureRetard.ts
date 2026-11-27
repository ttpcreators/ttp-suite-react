// ============================================================================
// _shared/factureRetard.ts : une facture est-elle en retard ? (règle PURE et UNIQUE)
// ----------------------------------------------------------------------------
// Statut « retard », ou « attente » dont l'échéance (`invoices.date` : « AAAA-MM-JJ », ou
// ancien « jj/mm[/aaaa] ») est passée. Rien ne passe une facture en « retard » toute seule :
// la cloche et le résumé de 8 h, qui ne lisaient que ce statut, ne voyaient donc pas une
// facture échue que Facturation affichait « En retard » (constat W23).
// Partagée par l'app (src/lib/relance.ts la reprend : Facturation, Relances, Aujourd'hui,
// cloche, gains du créateur) et par le résumé du matin (daily-digest).
// Testée par factureRetard.test.ts.
// ============================================================================

/** Échéance en « AAAA-MM-JJ » (année de `aujourdhui` quand elle manque), sinon "". */
export function echeanceIso(v: unknown, aujourdhui: string): string {
  const t = String(v ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const fr = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t);
  if (!fr) return "";
  const y = fr[3] ? (fr[3].length === 2 ? "20" + fr[3] : fr[3].padStart(4, "0")) : aujourdhui.slice(0, 4);
  return `${y}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}`;
}

/** Facture à relancer : « retard », ou « attente » dont l'échéance est passée (le jour même ne compte pas). */
export function factureEnRetard(iv: { status?: string | null; date?: string | null }, aujourdhui: string): boolean {
  if (iv.status === "retard") return true;
  if (iv.status !== "attente") return false;
  const due = echeanceIso(iv.date, aujourdhui);
  return !!due && due < aujourdhui.slice(0, 10);
}
