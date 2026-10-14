import { useEffect, useState } from "react";
import { CircleAlert, Copy, Loader2, RotateCw, Send, Undo2, X } from "lucide-react";
import {
  cancelSend, dismissFailedSend, flushSend, retryFailedSend, sendErrorText, subscribeFailed, subscribePending,
  type FailedSend, type PendingSend,
} from "@/lib/mailSend";
import { toast } from "@/components/ui/toast";

/** Texte lisible d'un corps HTML (pour « Copier le texte »). */
function htmlToText(html: string): string {
  const spaced = html.replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)\b[^>]*>/gi, "$&\n");
  const d = new DOMParser().parseFromString(spaced, "text/html");
  d.querySelectorAll("style, script").forEach((n) => n.remove());
  return (d.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

const card = "pointer-events-auto flex w-full max-w-[440px] items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 shadow-lg shadow-black/5";
const ghost = "flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[12px] font-semibold text-foreground transition-colors hover:bg-rowhover";

/**
 * Barre « Annuler l'envoi » (bas de l'écran, au-dessus des notifications) :
 * compte à rebours de chaque mail programmé, avec Annuler et Envoyer maintenant.
 * Dessous, les envois échoués (gardés même après rechargement) : Réessayer,
 * Copier le texte, ou fermer. Prévient si on quitte la page alors qu'un envoi
 * est encore en attente.
 */
export function UndoSendBar() {
  const [items, setItems] = useState<PendingSend[]>([]);
  const [failed, setFailed] = useState<FailedSend[]>([]);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => subscribePending(setItems), []);
  useEffect(() => subscribeFailed(setFailed), []);
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

  const retry = async (f: FailedSend) => {
    if (retrying) return;
    setRetrying(f.id);
    const r = await retryFailedSend(f.id);
    setRetrying(null);
    toast(r.ok ? "Mail envoyé ✓" : sendErrorText(r.error));
  };
  const copy = async (f: FailedSend) => {
    try {
      await navigator.clipboard.writeText(htmlToText(f.params.html));
      toast("Texte copié ✓");
    } catch {
      toast("Copie impossible");
    }
  };

  const shownFailed = failed.slice(0, 3);
  if (!items.length && !shownFailed.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(10rem+env(safe-area-inset-bottom))] z-[1301] flex flex-col items-center gap-2 px-4 md:bottom-24">
      {items.map((p) => {
        const left = Math.max(0, Math.ceil((p.until - Date.now()) / 1000));
        return (
          <div key={p.id} role="status" className={card}>
            <Send className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
              {p.label} <span className="tabular-nums text-muted-foreground">dans {left} s</span>
            </span>
            <button type="button" onClick={() => cancelSend(p.id) && toast(p.onCancel ? "Envoi annulé, brouillon rendu" : "Envoi annulé", { variant: "info" })} className={ghost}>
              <Undo2 className="h-3.5 w-3.5" /> Annuler
            </button>
            <button
              type="button"
              onClick={() => flushSend(p.id)}
              className="shrink-0 rounded-full px-2 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
            >
              Envoyer
            </button>
          </div>
        );
      })}
      {shownFailed.map((f) => (
        <div key={f.id} role="alert" className={card}>
          <CircleAlert className="h-4 w-4 shrink-0 text-red-500" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-foreground">Envoi échoué · {f.label}</span>
            <span className="block truncate text-[11.5px] text-muted-foreground" title={sendErrorText(f.error)}>
              {f.lostFiles?.length ? `Sans ses pièces jointes (${f.lostFiles.join(", ")})` : sendErrorText(f.error)}
            </span>
          </span>
          <button type="button" onClick={() => void retry(f)} disabled={!!retrying} className={ghost} aria-label={`Réessayer : ${f.label}`}>
            {retrying === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
            <span className="max-sm:hidden">Réessayer</span>
          </button>
          <button type="button" onClick={() => void copy(f)} className={ghost} aria-label={`Copier le texte : ${f.label}`}>
            <Copy className="h-3.5 w-3.5" /> <span className="max-sm:hidden">Copier le texte</span>
          </button>
          <button
            type="button"
            onClick={() => dismissFailedSend(f.id)}
            aria-label="Fermer"
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {failed.length > shownFailed.length && (
        <span className="pointer-events-auto rounded-full bg-surface px-2.5 py-0.5 text-[11px] text-muted-foreground shadow-sm">
          + {failed.length - shownFailed.length} autre{failed.length - shownFailed.length > 1 ? "s" : ""} envoi{failed.length - shownFailed.length > 1 ? "s" : ""} échoué{failed.length - shownFailed.length > 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}
