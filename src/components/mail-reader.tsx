import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Paperclip, type LucideIcon } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { MailAvatar } from "@/components/mail-avatar";
import { mailDocument, hasQuote, mailSnippet, fmtSize, downloadAttachment, type MailAttachment, type MailMessage } from "@/lib/creatorMail";

/*
 * Lecteur de mails partagé (page Mails agence + section Mails des créatrices) :
 * photo de profil, corps isolé dans une iframe sans scripts, message replié
 * ou déplié façon Gmail (historique cité masqué, pièces jointes en cartes).
 */

/** Date d'une ligne de liste, comme Gmail : « 14:32 » aujourd'hui, « 3 oct. » cette année, « 03/10/2025 » avant. */
export const fmtWhen = (ts: number) => {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
};
export const fmtFull = (ts: number) =>
  ts ? new Date(ts).toLocaleString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

/** Photo de profil (marque ou expéditeur), comme dans Gmail. L'agence = logo TTP. */
export function Initial({ name, agency, size = "md", email }: { name: string; agency?: boolean; size?: "sm" | "md"; email?: string | null }) {
  return <MailAvatar name={agency ? "TTP" : name} email={email} agency={agency} size={size} />;
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

export type MailAction = { icon: LucideIcon; label: string; onClick: () => void };

const cleanAddr = (v: string) => v.replace(/"?([^"<,]+?)"?\s*<[^>]+>/g, "$1");

/**
 * Un message du fil, en carte (inspirée d'« email-client-card ») : en-tête avec
 * avatar, nom, adresse, date et actions ; corps du mail ; pied optionnel (réponse).
 * Replié : une ligne compacte (expéditeur, aperçu, date).
 */
export function MailItem({
  m, open, onToggle, threadId, creator, actions = [], footer, index = 0, onDownload,
}: {
  m: MailMessage; open: boolean; onToggle: () => void; threadId?: string; creator?: string;
  /** Téléchargement personnalisé (page Mails agence) ; sinon via creator-mail. */
  onDownload?: (a: MailAttachment) => Promise<void> | void;
  actions?: MailAction[]; footer?: ReactNode; index?: number;
}) {
  const [showQuoted, setShowQuoted] = useState(false);
  const snippet = useMemo(() => mailSnippet(m.html, m.text), [m.html, m.text]);
  const name = m.fromAgency ? "TTP Creators" : m.from;
  const reduce = useReducedMotion();
  const enter = reduce ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25, delay: Math.min(index, 6) * 0.04 } };

  if (!open) {
    return (
      <motion.button
        {...enter}
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left shadow-sm shadow-black/[0.02] transition-colors hover:bg-rowhover"
      >
        <Initial name={m.from} email={m.fromEmail} agency={m.fromAgency} size="sm" />
        {/* Mobile : nom + date, puis l'aperçu dessous ; ≥ sm : tout sur une ligne. */}
        <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-center">
          <span className="truncate text-[13px] font-medium text-foreground">{name}</span>
          <span className="col-span-2 row-start-2 truncate text-[13px] text-muted-foreground sm:col-span-1 sm:col-start-2 sm:row-start-1">{snippet}</span>
          <span className="col-start-2 row-start-1 shrink-0 text-[11px] tabular-nums text-faint sm:col-start-3">{fmtWhen(m.ts)}</span>
        </span>
      </motion.button>
    );
  }

  return (
    <motion.article {...enter} className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm shadow-black/[0.03]">
      {/* En-tête */}
      <div className="flex items-start gap-3 border-b border-border px-4 py-3.5 sm:px-5">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-start gap-3 text-left" title="Replier">
          <Initial name={m.from} email={m.fromEmail} agency={m.fromAgency} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold text-foreground">{name}</span>
            <span className="block truncate text-[12px] text-muted-foreground">{m.fromAgency ? m.from : m.fromEmail}</span>
            <span className="mt-0.5 block truncate text-[11px] text-faint">
              à {cleanAddr(m.to)}{m.cc ? ` · cc ${cleanAddr(m.cc)}` : ""}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
          <span className="mr-1 hidden text-[11px] tabular-nums text-faint sm:inline">{fmtFull(m.ts)}</span>
          <span className="mr-1 text-[11px] tabular-nums text-faint sm:hidden">{fmtWhen(m.ts)}</span>
          {actions.map((a) => (
            <motion.button
              key={a.label}
              type="button"
              whileHover={reduce ? undefined : { scale: 1.08 }}
              whileTap={reduce ? undefined : { scale: 0.92 }}
              onClick={a.onClick}
              title={a.label}
              aria-label={a.label}
              className="grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-rowhover hover:text-foreground"
            >
              <a.icon className="h-4 w-4" />
            </motion.button>
          ))}
        </div>
      </div>

      {/* Corps */}
      <div className="px-4 py-4 sm:px-5">
        <div className="overflow-hidden rounded-lg bg-white dark:p-4">
          <MailBody m={m} showQuoted={showQuoted} />
        </div>
        {hasQuote(m.html) && (
          <button
            type="button"
            onClick={() => setShowQuoted((v) => !v)}
            title={showQuoted ? "Masquer l'historique" : "Afficher l'historique"}
            className="mt-2 rounded-md bg-muted px-2 py-0.5 text-[12px] font-semibold leading-none tracking-widest text-muted-foreground transition-colors hover:text-foreground"
          >
            {showQuoted ? "Masquer" : "···"}
          </button>
        )}
        {m.attachments.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {m.attachments.map((a) => (
              <button
                key={a.attachmentId}
                type="button"
                onClick={() => {
                  const run = onDownload ? Promise.resolve(onDownload(a)) : threadId ? downloadAttachment(threadId, a, creator) : null;
                  run?.catch((e) => toast((e as Error).message));
                }}
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

      {/* Pied (réponse) */}
      {footer && <div className="border-t border-border bg-muted/50 px-3 py-3 sm:px-4">{footer}</div>}
    </motion.article>
  );
}
