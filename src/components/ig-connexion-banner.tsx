import { X } from "@/components/icons";
import { Spin } from "@/components/ui/loader";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { useT } from "@/lib/i18n";
import { MESSAGES_RAISON, type EtatConnexion, type Raison } from "@/lib/instagram";

/**
 * Espace créatrice : bandeau Instagram. Deux cas, avec la reconnexion en un clic :
 *  • retour d'Instagram en échec (raison lue dans l'adresse ou dans ig_connexions) :
 *    ce qui s'est passé, quoi faire, « Réessayer » ;
 *  • jeton expiré, ou qui expire dans moins de 7 jours sans avoir pu être prolongé :
 *    « Reconnecte ton Instagram ».
 * Rien sinon. Règles dans supabase/functions/_shared/igConnexion.ts.
 */
export function IgConnexionBanner({ etat, joursRestants, raison, busy, onRetry, onClose }: {
  etat: EtatConnexion;
  joursRestants: number | null;
  /** Échec à montrer (retour d'Instagram) ; null = pas d'échec à montrer. */
  raison: Raison | null;
  busy: boolean;
  onRetry: () => void;
  onClose?: () => void;
}) {
  const t = useT();
  const reconnecter = etat === "expire" || etat === "bientot_expire";
  if (!reconnecter && !raison) return null;
  const titre = reconnecter ? t("Reconnecte ton Instagram") : t(MESSAGES_RAISON[raison!].titre);
  const texte = reconnecter
    ? etat === "expire"
      ? t("Ton lien avec Instagram a expiré : tes stats ne se mettent plus à jour. Ça prend une minute.")
      : t("Ton lien avec Instagram expire dans {n} j. Reconnecte-le pour que tes stats continuent d'arriver.", { n: joursRestants ?? 0 })
    : t(MESSAGES_RAISON[raison!].texte);
  // Un lien expiré ou un problème de l'agence : réessayer tout de suite ne sert à rien.
  const retry = reconnecter || (raison !== "agence" && raison !== "pas_autorise");
  return (
    <div role="status" className="mb-4 flex items-start gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <PlatformIcon platform="instagram" className="mt-0.5 h-5 w-5 shrink-0 text-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold leading-snug text-foreground">{titre}</div>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{texte}</p>
        {retry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={busy}
            className="mt-2.5 flex min-h-11 items-center gap-1.5 rounded-full bg-foreground px-4 text-[13px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Spin size={14} /> : <PlatformIcon platform="instagram" className="h-3.5 w-3.5" />}
            {reconnecter ? t("Reconnecter mon Instagram") : t("Réessayer")}
          </button>
        )}
      </div>
      {onClose && !reconnecter && (
        <button type="button" onClick={onClose} aria-label={t("Fermer")} className="-m-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-faint hover:bg-rowhover hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
