import { useEffect, useState } from "react";
import { Send, Undo2 } from "lucide-react";
import { cancelSend, flushSend, subscribePending, type PendingSend } from "@/lib/mailSend";
import { toast } from "@/components/ui/toast";

/**
 * Barre « Annuler l'envoi » (bas de l'écran, au-dessus des notifications) :
 * compte à rebours de chaque mail programmé, avec Annuler et Envoyer maintenant.
 * Prévient si on quitte la page alors qu'un envoi est encore en attente.
 */
export function UndoSendBar() {
  const [items, setItems] = useState<PendingSend[]>([]);
  const [, tick] = useState(0);

  useEffect(() => subscribePending(setItems), []);
  useEffect(() => {
    if (!items.length) return;
    const t = window.setInterval(() => tick((n) => n + 1), 250);
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("beforeunload", warn);
    };
  }, [items.length]);

  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(10rem+env(safe-area-inset-bottom))] z-[201] flex flex-col items-center gap-2 px-4 md:bottom-24">
      {items.map((p) => {
        const left = Math.max(0, Math.ceil((p.until - Date.now()) / 1000));
        return (
          <div
            key={p.id}
            role="status"
            className="pointer-events-auto flex w-full max-w-[440px] items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 shadow-lg shadow-black/5"
          >
            <Send className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
              {p.label} <span className="tabular-nums text-muted-foreground">dans {left} s</span>
            </span>
            <button
              type="button"
              onClick={() => cancelSend(p.id) && toast("Envoi annulé", { variant: "info" })}
              className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold text-foreground transition-colors hover:bg-rowhover"
            >
              <Undo2 className="h-3.5 w-3.5" /> Annuler
            </button>
            <button
              type="button"
              onClick={() => flushSend(p.id)}
              className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
            >
              Envoyer
            </button>
          </div>
        );
      })}
    </div>
  );
}
