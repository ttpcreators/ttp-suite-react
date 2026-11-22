import { AlertTriangle, RefreshCw } from "@/components/icons";
import { HelpTip } from "@/components/ui/help-tip";
import { useAppState, type AppState } from "@/lib/appState";
import { cn } from "@/lib/utils";
import { FRAICHEUR_JOURS, SEUILS, type Controle, type Mesure } from "../../supabase/functions/_shared/mediakitControle.ts";

/** Mesures du calculateur d'engagement (blob agence), pour le contrôle des media kits. */
export function useMesures(): Mesure[] {
  const { data } = useAppState<Mesure[]>((s: AppState) => (s["engagementHistory"] as Mesure[] | undefined) ?? []);
  return data ?? [];
}

const Aide = ({ className }: { className?: string }) => (
  <HelpTip title="Chiffres du media kit" className={className}>
    <span>Chaque chiffre du kit est comparé au chiffre réel le plus récent : relevé automatique Instagram, TikTok ou YouTube, ou dernière mesure du calculateur.</span>
    <span>À corriger : plus de {SEUILS.abonnes * 100} % d'écart sur les abonnés, plus de {SEUILS.engagement * 100} % sur l'engagement ou les vues. Alfred ne peut plus l'envoyer en prospection.</span>
    <span>À vérifier : pas de chiffre réel de moins de {FRAICHEUR_JOURS} jours. Rien n'est faux pour autant.</span>
  </HelpTip>
);

/**
 * « Chiffres à mettre à jour : Instagram : kit 210 K, réel 5,9 K », avec le bouton qui met
 * les chiffres réels dans le kit. Rien si le kit est juste. `verifier` : affiche aussi les
 * chiffres sans relevé récent (page Media kit).
 */
export function KitCheckAlert({ controle, onUpdate, busy, verifier, className }: {
  controle: Controle;
  onUpdate?: () => void;
  busy?: boolean;
  verifier?: boolean;
  className?: string;
}) {
  if (controle.aCorriger.length) {
    return (
      <div role="alert" className={cn("flex flex-wrap items-start gap-x-3 gap-y-2 rounded-2xl bg-wait-soft px-4 py-3 text-[13px] text-wait", className)}>
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1 leading-relaxed">
          <span className="font-semibold">Chiffres à mettre à jour : </span>
          {controle.aCorriger.map((l) => l.texte).join(" · ")}
          <Aide className="ml-1.5 align-[-2px]" />
        </div>
        {onUpdate && (
          <button
            type="button"
            onClick={onUpdate}
            disabled={busy}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" /> {busy ? "Mise à jour…" : "Mettre à jour"}
          </button>
        )}
      </div>
    );
  }
  if (verifier && controle.aVerifier.length) {
    return (
      <div role="note" className={cn("flex items-start gap-2 rounded-2xl border border-border bg-surface px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground", className)}>
        <span className="min-w-0 flex-1">
          <span className="font-medium text-foreground">Chiffres à vérifier : </span>
          {controle.aVerifier.map((l) => l.texte).join(" · ")}
        </span>
        <Aide />
      </div>
    );
  }
  return null;
}
