import { X } from "@/components/icons";
import { Overlay } from "@/components/mobile/ios-sheet";
import { formatEuro } from "@/lib/money";
import type { RatesMerge } from "@/lib/mediakitRates";

/** Prix du kit (« 1200 ») lisible (« 1 200 € ») ; texte libre (« Sur devis ») gardé tel quel. */
const price = (p: string) => (/^\d+$/.test(p.trim()) ? formatEuro(Number(p)) : p);

/**
 * Aperçu avant d'écrire des tarifs calculés dans un media kit : lignes ajoutées, prix
 * remplacés (ancien → nouveau), rappel si les prix sont masqués sur le kit public.
 */
export function KitRatesDialog({ title, merge, hideRates, missing, confirmLabel, busy, onConfirm, onClose }: {
  title: string;
  merge: RatesMerge;
  hideRates: boolean;
  missing?: string[];
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const row = "flex items-baseline justify-between gap-3 py-2 text-[14px]";
  return (
    <Overlay className="fixed inset-0 z-[120] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClose={onClose} label={title}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[88dvh] w-full flex-col gap-4 overflow-y-auto rounded-t-[22px] bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-[460px] sm:rounded-[22px]">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[16px] font-semibold text-foreground">{title}</div>
            <div className="text-[13px] text-muted-foreground">Prix HT d'un contenu, selon le barème de l'agence.</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="divide-y divide-border rounded-[14px] bg-panel px-3.5">
          {merge.replaced.map((r) => (
            <div key={`r-${r.label}`} className={row}>
              <span className="min-w-0 text-foreground">{r.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                <s>{price(r.from) || "—"}</s> <span className="font-semibold text-foreground">{price(r.price)}</span>
              </span>
            </div>
          ))}
          {merge.added.map((r) => (
            <div key={`a-${r.label}`} className={row}>
              <span className="min-w-0 text-foreground">{r.label} <span className="text-[12px] text-ok">· nouveau</span></span>
              <span className="shrink-0 font-semibold tabular-nums text-foreground">{price(r.price)}</span>
            </div>
          ))}
        </div>
        {missing && missing.length > 0 && <p className="text-[13px] text-wait">Il manque les abonnés {missing.join(", ")} : pas de prix pour {missing.length > 1 ? "ces plateformes" : "cette plateforme"}.</p>}
        {hideRates && <p className="text-[13px] text-muted-foreground">Les prix sont masqués sur le media kit public : ils restent visibles seulement ici.</p>}
        <button type="button" onClick={onConfirm} disabled={busy} className="flex h-11 items-center justify-center rounded-full bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
          {confirmLabel}
        </button>
      </div>
    </Overlay>
  );
}
