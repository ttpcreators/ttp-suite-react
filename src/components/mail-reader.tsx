import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { mailDocument, hasQuote, mailSnippet, fmtSize, downloadAttachment, type MailMessage } from "@/lib/creatorMail";

/*
 * Lecteur de mails partagé (page Mails agence + section Mails des créatrices) :
 * pastille d'initiale, corps isolé dans une iframe sans scripts, message replié
 * ou déplié façon Gmail (historique cité masqué, pièces jointes en cartes).
 */

export const fmtWhen = (ts: number) => {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
};
export const fmtFull = (ts: number) =>
  ts ? new Date(ts).toLocaleString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

/** Pastille d'initiale (marque ou expéditeur). L'agence = pastille pleine. */
export function Initial({ name, agency, size = "md" }: { name: string; agency?: boolean; size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold uppercase",
        size === "md" ? "h-9 w-9 text-[13px]" : "h-8 w-8 text-[12px]",
        agency ? "bg-foreground text-background" : "bg-foreground/[0.07] text-foreground",
      )}
    >
      {agency ? "T" : (name.trim().charAt(0) || "?")}
    </span>
  );
}

/** Corps d'un mail : iframe isolée (aucun script), hauteur suivie en continu. */
export function MailBody({ m, showQuoted }: { m: MailMessage; showQuoted: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(80);
  const doc = useMemo(() => mailDocument(m.html, m.text, showQuoted), [m.html, m.text, showQuoted]);
  const obs = useRef<ResizeObserver | null>(null);
  const onLoad = useCallback(() => {
    const d = ref.current?.contentDocument;
    if (!d?.documentElement) return;
    const fit = () => setH(Math.min(6000, Math.max(24, d.documentElement.scrollHeight)));
    fit();
    // Les images (logos, signatures) arrivent après coup : on suit la hauteur.
    obs.current?.disconnect();
    obs.current = new ResizeObserver(fit);
    obs.current.observe(d.body);
  }, []);
  useEffect(() => () => obs.current?.disconnect(), []);
  return (
    <iframe
      ref={ref}
      title={`Message de ${m.from}`}
      srcDoc={doc}
      // Pas de allow-scripts : aucun code du mail ne peut s'exécuter. allow-same-origin
      // sert uniquement à mesurer la hauteur ; les liens s'ouvrent dans un nouvel onglet.
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      onLoad={onLoad}
      style={{ height: h }}
      className="block w-full border-0 bg-white"
    />
  );
}

/** Un message du fil : replié (une ligne) ou déplié (corps + pièces jointes). */
export function MailItem({
  m, open, onToggle, threadId, creator,
}: { m: MailMessage; open: boolean; onToggle: () => void; threadId?: string; creator?: string }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const snippet = useMemo(() => mailSnippet(m.html, m.text), [m.html, m.text]);
  const name = m.fromAgency ? "TTP Creators" : m.from;
  if (!open) {
    return (
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-rowhover sm:px-6">
        <Initial name={m.from} agency={m.fromAgency} size="sm" />
        {/* Mobile : nom + date, puis l'aperçu dessous ; ≥ sm : tout sur une ligne. */}
        <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-center">
          <span className="truncate text-[13px] font-medium text-foreground">{name}</span>
          <span className="col-span-2 row-start-2 truncate text-[13px] text-muted-foreground sm:col-span-1 sm:col-start-2 sm:row-start-1">{snippet}</span>
          <span className="col-start-2 row-start-1 shrink-0 text-[11px] tabular-nums text-faint sm:col-start-3">{fmtWhen(m.ts)}</span>
        </span>
      </button>
    );
  }
  return (
    <div className="px-4 py-4 sm:px-6">
      <button type="button" onClick={onToggle} className="mb-3 flex w-full items-start gap-3 text-left">
        <Initial name={m.from} agency={m.fromAgency} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="truncate text-[13px] font-semibold text-foreground">{name}</span>
            <span className="truncate text-[12px] text-faint">{m.fromAgency ? m.from : m.fromEmail}</span>
          </span>
          <span className="block truncate text-[12px] text-faint">à {m.to.replace(/"?([^"<,]+?)"?\s*<[^>]+>/g, "$1")}{m.cc ? ` · cc ${m.cc.replace(/"?([^"<,]+?)"?\s*<[^>]+>/g, "$1")}` : ""}</span>
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-faint">
          <span className="sm:hidden">{fmtWhen(m.ts)}</span>
          <span className="hidden sm:inline">{fmtFull(m.ts)}</span>
        </span>
      </button>
      <div className="overflow-hidden rounded-xl bg-white sm:ml-11 dark:p-4">
        <MailBody m={m} showQuoted={showQuoted} />
      </div>
      {hasQuote(m.html) && (
        <button
          type="button"
          onClick={() => setShowQuoted((v) => !v)}
          title={showQuoted ? "Masquer l'historique" : "Afficher l'historique"}
          className="mt-2 rounded-md bg-muted px-2 py-0.5 text-[12px] font-semibold leading-none tracking-widest text-muted-foreground transition-colors hover:text-foreground sm:ml-11"
        >
          {showQuoted ? "Masquer" : "···"}
        </button>
      )}
      {m.attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 sm:ml-11">
          {m.attachments.map((a) => (
            <button
              key={a.attachmentId}
              type="button"
              onClick={() => threadId && downloadAttachment(threadId, a, creator).catch((e) => toast((e as Error).message))}
              className="flex max-w-full items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-rowhover"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted">
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-medium text-foreground">{a.filename}</span>
                <span className="block text-[11px] text-faint">{fmtSize(a.size)} · Télécharger</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

