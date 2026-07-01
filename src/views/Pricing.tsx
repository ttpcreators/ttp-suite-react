import { useState } from "react";
import {
  useAppState,
  parseAmount,
  formatEuro,
  type AppState,
} from "@/lib/appState";

/** Une ligne de la grille tarifaire (blob `pricingData`). */
type PriceRow = {
  format: string;
  base: string;
  excl: string;
};

/** Grille par défaut (utilisée tant qu'aucune donnée blob n'existe). */
const DEFAULT_PRICING: PriceRow[] = [
  { format: "Reel", base: "6 800 €", excl: "+ 35%" },
  { format: "Post", base: "4 200 €", excl: "+ 30%" },
  { format: "Story (3)", base: "2 500 €", excl: "+ 25%" },
  { format: "Pack complet", base: "11 000 €", excl: "sur devis" },
];

/**
 * Extrait le pourcentage d'une valeur d'exclusivité ("+ 35%" → 35).
 * Renvoie null si la valeur n'est pas chiffrée ("sur devis").
 */
function parsePct(x: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*%/.exec(x);
  if (!m) return null;
  return Number(m[1].replace(",", ".")) || 0;
}

export function Pricing() {
  const { data, loading } = useAppState<PriceRow[]>(
    (s: AppState) => (s["pricingData"] as PriceRow[]) ?? DEFAULT_PRICING,
  );

  // Quantité choisie par format (indexé par position dans la grille).
  const [qty, setQty] = useState<Record<number, number>>({});
  const [excl, setExcl] = useState(false);

  // État de chargement.
  if (loading) {
    return (
      <div className="grid place-items-center rounded-2xl border border-border bg-surface p-16 text-sm text-muted-foreground shadow-sm">
        Chargement de la grille tarifaire…
      </div>
    );
  }

  const rows = data && data.length ? data : DEFAULT_PRICING;

  // État vide (grille vidée manuellement).
  if (!rows.length) {
    return (
      <div className="grid place-items-center rounded-2xl border border-border bg-surface p-16 text-sm text-muted-foreground shadow-sm">
        Aucun tarif enregistré.
      </div>
    );
  }

  // Total hors exclusivité = somme(qty × prix de base).
  const subtotal = rows.reduce(
    (sum, r, i) => sum + (qty[i] || 0) * parseAmount(r.base),
    0,
  );

  // Majoration moyenne (sur les formats chiffrés) appliquée si "+ exclusivité".
  const pcts = rows.map((r) => parsePct(r.excl)).filter((p): p is number => p != null);
  const avgPct = pcts.length
    ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)
    : 0;

  const total = excl ? Math.round(subtotal * (1 + avgPct / 100)) : subtotal;
  const hasLines = rows.some((_, i) => (qty[i] || 0) > 0);

  const setQ = (i: number, v: number) =>
    setQty((q) => ({ ...q, [i]: Math.max(0, v || 0) }));

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.3fr_1fr]">
      {/* GRILLE TARIFAIRE */}
      <div className="rounded-2xl border border-border bg-surface p-2 shadow-sm">
        <div className="grid grid-cols-[2fr_1fr_1fr] gap-3 px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.08em] text-faint">
          <span>Format</span>
          <span className="text-right">Tarif base</span>
          <span className="text-right">+ Exclusivité</span>
        </div>
        {rows.map((r, i) => (
          <div
            key={`${r.format}-${i}`}
            className="grid grid-cols-[2fr_1fr_1fr] items-center gap-3 rounded-xl px-4 py-2.5 transition-colors hover:bg-rowhover"
          >
            <span className="text-[13px] font-medium text-foreground">
              {r.format}
            </span>
            <span className="text-right text-[13px] font-semibold text-foreground">
              {r.base}
            </span>
            <span className="text-right text-[13px] font-semibold text-muted-foreground">
              {r.excl}
            </span>
          </div>
        ))}
      </div>

      {/* CALCULATEUR */}
      <div className="flex flex-col rounded-2xl bg-foreground p-6 text-background">
        <div className="text-xs font-semibold uppercase tracking-wide text-signal">
          Simulateur de tarif
        </div>

        <div className="mt-4 text-[10px] font-medium uppercase tracking-wide text-faint">
          Contenus · choisis les quantités
        </div>
        <div className="mt-2.5 flex flex-col gap-2.5">
          {rows.map((r, i) => (
            <div key={`q-${i}`} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold text-background">
                  {r.format}
                </div>
                <div className="text-[9px] font-normal text-faint">
                  {r.base} / unité
                </div>
              </div>
              <input
                type="number"
                min={0}
                value={qty[i] || 0}
                onChange={(e) => setQ(i, parseInt(e.target.value, 10))}
                className="w-16 rounded-lg border border-white/15 bg-white/10 px-2.5 py-1.5 text-right text-[13px] font-bold text-background outline-none [appearance:textfield] focus:border-signal [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
          ))}
        </div>

        {/* Option exclusivité */}
        <label className="mt-3.5 flex cursor-pointer items-center gap-2.5 select-none">
          <span
            className={
              "grid h-[18px] w-[18px] place-items-center rounded-md text-[10px] font-bold transition-colors " +
              (excl
                ? "bg-signal text-signaltext"
                : "border-[1.5px] border-faint text-transparent")
            }
          >
            ✓
          </span>
          <span className="text-[11px] font-medium text-background">
            + Exclusivité (moy. + {avgPct}%)
          </span>
          <input
            type="checkbox"
            checked={excl}
            onChange={(e) => setExcl(e.target.checked)}
            className="sr-only"
          />
        </label>

        {/* Détail des lignes sélectionnées */}
        {hasLines && (
          <div className="mt-4 flex flex-col gap-1.5 border-t border-white/10 pt-3">
            {rows.map((r, i) =>
              (qty[i] || 0) > 0 ? (
                <div
                  key={`l-${i}`}
                  className="flex justify-between text-[10px] font-medium text-faint"
                >
                  <span>
                    {r.format} · ×{qty[i]}
                  </span>
                  <span className="text-background">
                    {formatEuro((qty[i] || 0) * parseAmount(r.base))}
                  </span>
                </div>
              ) : null,
            )}
          </div>
        )}

        {/* Total */}
        <div className="mt-4 rounded-2xl bg-white/[0.06] p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">
              Total estimé
            </span>
            <span className="whitespace-nowrap text-3xl font-bold tracking-tight text-signal">
              {formatEuro(total)}
            </span>
          </div>
          {excl && subtotal > 0 && (
            <div className="mt-2.5 flex justify-between text-[11px] font-medium">
              <span className="text-faint">Base hors exclusivité</span>
              <span className="text-background">{formatEuro(subtotal)}</span>
            </div>
          )}
          <div className="mt-2 text-[9px] font-normal text-faint">
            {hasLines
              ? "Estimation indicative — à ajuster selon la marque."
              : "Renseigne des quantités pour estimer le tarif."}
          </div>
        </div>
      </div>
    </div>
  );
}
