import { Gift, Wallet } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { DealKind } from "@/lib/dealKind";

/** Étiquette « Gifting » / « Rémunéré » d'une collab ou d'un brief (rien si inconnu).
 *  Version douce : fond gris des champs, texte et icône de la couleur du statut. La
 *  pastille pleine (bg-ok-soft, vert fluo dans le thème Studio) criait plus fort que la
 *  marque et le statut de la carte. */
export function DealBadge({ kind, className }: { kind: DealKind | null; className?: string }) {
  if (!kind) return null;
  const gift = kind === "gifting";
  return (
    <span
      title={gift ? "Gifting : produits offerts, pas de cachet" : "Rémunéré : un cachet est prévu"}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-semibold leading-none",
        "bg-field", gift ? "text-info" : "text-ok",
        className,
      )}
    >
      {gift ? <Gift className="h-3 w-3" /> : <Wallet className="h-3 w-3" />}
      {gift ? "Gifting" : "Rémunéré"}
    </span>
  );
}
