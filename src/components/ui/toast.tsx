import { useEffect, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { Alert, type AlertVariant } from "@/components/ui/alert";

/*
 * Notifications du bas (agence + créateur) au design « Alert » :
 * carte bordée, icône à gauche, croix pour fermer. Le type est déduit du message
 * (✓ → réussi, « erreur / impossible / échec… » → erreur, « attention / aucun… » →
 * avertissement), ou forcé via toast(message, { variant }).
 */
type ToastOpts = { variant?: AlertVariant; duration?: number };

/** Affiche une notification. Utilisable depuis n'importe où (pas de contexte requis). */
export function toast(message: string, opts?: ToastOpts) {
  window.dispatchEvent(new CustomEvent("ttp-toast", { detail: { message, ...opts } }));
}

type Item = { id: number; message: string; variant: AlertVariant };
let seq = 0;

const ERROR_RE = /erreur|impossible|échou|échec|indisponible|refus|invalide|introuvable|bloqu|non enregistr|n'a pas (pu|été)/i;
const WARN_RE = /attention|d'abord|aucun|déjà|trop lourd|max\b|requis|manquant|choisis|ajoute au moins/i;

function inferVariant(message: string): AlertVariant {
  if (ERROR_RE.test(message)) return "error";
  if (/✓|✅/.test(message)) return "success";
  if (WARN_RE.test(message)) return "warning";
  return "info";
}

const ICONS: Record<AlertVariant, ReactNode> = {
  success: <CircleCheck className="text-emerald-500" size={16} strokeWidth={2} />,
  error: <CircleAlert className="text-red-500" size={16} strokeWidth={2} />,
  warning: <TriangleAlert className="text-muted-foreground" size={16} strokeWidth={2} />,
  info: <Info className="text-muted-foreground" size={16} strokeWidth={2} />,
  default: <Info className="text-muted-foreground" size={16} strokeWidth={2} />,
};

export function Toaster() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const d = (e as CustomEvent<string | ({ message: string } & ToastOpts)>).detail;
      const raw = typeof d === "string" ? d : d.message;
      const variant = (typeof d === "object" && d.variant) || inferVariant(raw);
      // La coche est portée par l'icône : on la retire du texte.
      const message = raw.replace(/\s*[✓✅]\s*$/, "").trim();
      const id = ++seq;
      // 3 notifications max à l'écran : la plus ancienne laisse sa place.
      setItems((l) => [...l, { id, message, variant }].slice(-3));
      const duration = (typeof d === "object" && d.duration) || (variant === "error" ? 5000 : 3200);
      window.setTimeout(() => setItems((l) => l.filter((i) => i.id !== id)), duration);
    };
    window.addEventListener("ttp-toast", onToast);
    return () => window.removeEventListener("ttp-toast", onToast);
  }, []);

  const close = (id: number) => setItems((l) => l.filter((i) => i.id !== id));

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-[200] flex flex-col items-center gap-2 px-4 md:bottom-6"
    >
      {items.map((i) => (
        <Alert
          key={i.id}
          isNotification
          variant={i.variant}
          layout="row"
          icon={ICONS[i.variant]}
          className="pointer-events-auto w-full animate-[ttp-toast-in_.2s_ease] sm:w-auto sm:min-w-[300px]"
          action={
            <button
              type="button"
              onClick={() => close(i.id)}
              aria-label="Fermer la notification"
              className="-my-1 -me-1 grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          }
        >
          <p className="text-sm">{i.message}</p>
        </Alert>
      ))}
    </div>
  );
}
