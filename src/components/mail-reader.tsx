import { fmtDay, fmtDayTime } from "@/lib/dates";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown, ChevronUp, Copy, Paperclip, type LucideIcon } from "@/components/icons";
import { toast } from "@/components/ui/toast";
import { MailAvatar } from "@/components/mail-avatar";
import { translate, useLang, useLocale, useT, type Lang } from "@/lib/i18n";
import { addressParts } from "@/lib/mailRecipients";
import { mailDocument, hasQuote, mailSnippet, fmtSize, downloadAttachment, type MailAttachment, type MailMessage } from "@/lib/creatorMail";

/*
 * Lecteur de mails partagé (page Mails agence + section Mails des créatrices) :
 * photo de profil, corps isolé dans une iframe sans scripts, message replié
 * ou déplié façon Gmail (historique cité masqué, pièces jointes en cartes).
 */

/** Date d'une ligne de liste, comme Gmail : « 14:32 » aujourd'hui, sinon la date commune (« 3 oct. », « 3 oct. 2025 »).
 *  `locale` : celle de useLocale() dans l'espace créateur (français par défaut). */
export const fmtWhen = (ts: number, locale = "fr-FR") => {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return fmtDay(d, locale, now);
};
export const fmtFull = (ts: number, locale = "fr-FR") => (ts ? fmtDayTime(ts, locale) : "");
/** « il y a 15 min », « il y a 3 h », « il y a 2 j » ; rien au-delà d'une semaine. */
export const fmtAgo = (ts: number, lang: Lang = "fr") => {
  if (!ts) return "";
  const min = Math.round((Date.now() - ts) / 60_000);
  if (min < 1) return translate(lang, "à l'instant");
  if (min < 60) return translate(lang, "il y a {n} min", { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return translate(lang, "il y a {n} h", { n: h });
  const d = Math.round(h / 24);
  return d < 7 ? translate(lang, "il y a {n} j", { n: d }) : "";
};

/** Photo de profil (marque ou expéditeur), comme dans Gmail. L'agence = logo TTP. */
export function Initial({ name, agency, size = "md", email }: { name: string; agency?: boolean; size?: "sm" | "md" | "lg"; email?: string | null }) {
  return <MailAvatar name={agency ? "TTP" : name} email={email} agency={agency} size={size} />;
}

/** Pastille du type de fichier (PDF rouge, tableur vert…), comme dans les clients mail. */
const FILE_TONE: [RegExp, string][] = [
  [/^pdf$/, "bg-danger"],
  [/^(docx?|odt|rtf|pages)$/, "bg-blue-500"],
  [/^(xlsx?|csv|ods|numbers)$/, "bg-signal"],
  [/^(pptx?|key|odp)$/, "bg-orange-500"],
  [/^(zip|rar|7z|tar|gz)$/, "bg-violet-500"],
  [/^(png|jpe?g|gif|webp|heic|svg)$/, "bg-pink-500"],
  [/^(mp4|mov|webm|avi)$/, "bg-zinc-700"],
];
/** Tuile de pièce jointe (maquette) : carré arrondi de la couleur du type, trombone blanc. */
function FileBadge({ name }: { name: string }) {
  const ext = (name.includes(".") ? name.split(".").pop() ?? "" : "").toLowerCase().slice(0, 4);
  const tone = FILE_TONE.find(([re]) => re.test(ext))?.[1] ?? "bg-zinc-500";
  return (
    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[10px] text-white shadow-sm ${tone}`}>
      <Paperclip className="h-[18px] w-[18px]" strokeWidth={2} />
    </span>
  );
}

/** Corps d'un mail : iframe isolée (aucun script), hauteur suivie en continu. */
export function MailBody({ m, showQuoted, fontPx }: { m: MailMessage; showQuoted: boolean; fontPx?: number }) {
  const t = useT();
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(80);
  const doc = useMemo(() => mailDocument(m.html, m.text, showQuoted, fontPx ? { fontPx } : {}), [m.html, m.text, showQuoted, fontPx]);
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
      title={t("Message de {from}", { from: m.from })}
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

/** Pièces « intégrées » (images du corps du mail) : pas listées comme pièces jointes. */
const isInline = (a: MailAttachment) => !!(a as MailAttachment & { inline?: boolean }).inline;

/** Bouton « Afficher / Masquer l'historique » (réponses précédentes citées dans le mail). */
function QuoteToggle({ shown, onClick, className }: { shown: boolean; onClick: () => void; className?: string }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={shown}
      className={`mt-2 self-start rounded-full bg-muted px-2.5 py-1 text-[11.5px] font-medium leading-none text-muted-foreground transition-colors hover:text-foreground ${className ?? ""}`}
    >
      {shown ? t("Masquer l'historique") : t("Afficher l'historique")}
    </button>
  );
}

/** Bouton chevron « Replier » d'un message déplié. */
function FoldButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("Replier")}
      title={t("Replier")}
      className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-rowhover hover:text-foreground"
    >
      <ChevronUp className="h-4 w-4" />
    </button>
  );
}

/**
 * Ligne « à … · cc … · cci … » : la liste complète (une adresse par ligne, À, Cc puis Cci)
 * est dépliée d'office dès qu'il y a des copies ; chaque adresse se copie d'un clic, et
 * « Copier les adresses » les copie toutes (pour les mettre dans un CRM).
 */
function Recipients({ m, className }: { m: MailMessage; className: string }) {
  const t = useT();
  const groups = [
    { label: t("À"), list: addressParts(m.to ?? "") },
    { label: "Cc", list: addressParts(m.cc ?? "") },
    { label: t("Cci"), list: addressParts(m.bcc ?? "") },
  ].filter((g) => g.list.length);
  const [open, setOpen] = useState(() => !!(m.cc || m.bcc));
  if (!groups.length) return null;
  const all = [...new Set(groups.flatMap((g) => g.list.map((a) => a.email)))];
  const copyAll = () => {
    void navigator.clipboard
      ?.writeText(all.join(", "))
      .then(() => toast(all.length > 1 ? t("{n} adresses copiées", { n: all.length }) : t("Adresse copiée")))
      .catch(() => toast(all.join(", ")));
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? t("Masquer les destinataires") : t("Voir tous les destinataires")}
        className={`flex min-w-0 max-w-full items-center gap-1 text-left transition-colors hover:text-foreground ${className}`}
      >
        <span className="min-w-0 truncate">
          {t("à {to}", { to: cleanAddr(m.to) })}{m.cc ? ` · cc ${cleanAddr(m.cc)}` : ""}{m.bcc ? ` · cci ${cleanAddr(m.bcc)}` : ""}
        </span>
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <span data-sel className="mt-1.5 grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg bg-muted/60 px-3 py-2 text-[12px]">
          {groups.map((g) => (
            <span key={g.label} className="contents">
              <span className="pt-px text-muted-foreground">{g.label}</span>
              <span className="flex min-w-0 flex-col gap-0.5">
                {g.list.map((a) => (
                  <span key={a.email} className="flex min-w-0 items-baseline gap-1.5">
                    {a.name && <span className="shrink-0 font-medium text-foreground">{a.name}</span>}
                    <CopyAddress email={a.email} className="min-w-0 text-muted-foreground" />
                  </span>
                ))}
              </span>
            </span>
          ))}
          {all.length > 1 && (
            <span className="col-span-2 pt-1">
              <button type="button" onClick={copyAll} className="inline-flex items-center gap-1.5 font-medium text-primary transition-opacity hover:opacity-80">
                <Copy className="h-3 w-3" /> {t("Copier les adresses")}
              </button>
            </span>
          )}
        </span>
      )}
    </>
  );
}

/**
 * Adresse de l'expéditeur : un clic la copie (pour l'ajouter aux contacts, la coller
 * dans un mail…). Icône « copier » au survol, coche verte une fois copiée.
 */
function CopyAddress({ email, className }: { email: string; className: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  const copy = () => {
    void navigator.clipboard
      ?.writeText(email)
      .then(() => {
        setDone(true);
        toast(t("Adresse copiée"));
        setTimeout(() => setDone(false), 1500);
      })
      .catch(() => toast(email));
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={t("Copier {address}", { address: email })}
      className={`group/addr flex w-fit max-w-full items-center gap-1.5 text-left transition-colors hover:text-foreground ${className}`}
    >
      <span className="min-w-0 truncate">{email}</span>
      {done ? <Check className="h-3.5 w-3.5 shrink-0 text-ok" /> : <Copy className="h-3 w-3 shrink-0 opacity-50 transition-opacity group-hover/addr:opacity-100" />}
    </button>
  );
}

/**
 * Clic dans l'en-tête d'un message déplié : replie, sauf sur un bouton, un lien,
 * le texte (nom, adresse : sélectionnables) ou pendant une sélection.
 */
function headClick(onToggle: () => void) {
  return (e: MouseEvent<HTMLElement>) => {
    const el = e.target as HTMLElement;
    if (el.closest("button, a, [data-sel]")) return;
    if (window.getSelection()?.toString()) return;
    onToggle();
  };
}

/**
 * Un message du fil, en carte (inspirée d'« email-client-card ») : en-tête avec
 * avatar, nom, adresse, date et actions ; corps du mail ; pied optionnel (réponse).
 * Replié : une ligne compacte (expéditeur, aperçu, date).
 */
export function MailItem({
  m, open, onToggle, threadId, creator, actions = [], footer, extra, index = 0, onDownload, variant = "card",
}: {
  m: MailMessage; open: boolean; onToggle: () => void; threadId?: string; creator?: string;
  /** Téléchargement personnalisé (page Mails agence) ; sinon via creator-mail. */
  onDownload?: (a: MailAttachment) => Promise<void> | void;
  actions?: MailAction[]; footer?: ReactNode; index?: number;
  /** Sous le corps du message, avant le pied (ex. réactions emoji). */
  extra?: ReactNode;
  /** « plain » : sans cadre, façon client mail (page Mails agence).
   *  « conversation » : bulles arrondies façon app Mail iOS, texte en 16 px (espace créateur). */
  variant?: "card" | "plain" | "conversation";
}) {
  const [showQuoted, setShowQuoted] = useState(false);
  const snippet = useMemo(() => mailSnippet(m.html, m.text), [m.html, m.text]);
  const files = useMemo(() => m.attachments.filter((a) => !isInline(a)), [m.attachments]);
  const name = m.fromAgency ? "TTP Creators" : m.from;
  const reduce = useReducedMotion();
  const t = useT();
  const lang = useLang();
  const locale = useLocale();
  const enter = reduce ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25, delay: Math.min(index, 6) * 0.04 } };
  const download = (a: MailAttachment) => {
    const run = onDownload ? Promise.resolve(onDownload(a)) : threadId ? downloadAttachment(threadId, a, creator) : null;
    return run?.catch((e) => toast((e as Error).message));
  };

  if (variant === "conversation") {
    if (!open) {
      return (
        <motion.button
          {...enter}
          type="button"
          onClick={onToggle}
          className="flex w-full items-center gap-3 rounded-2xl bg-surface px-3.5 py-3 text-left transition-colors hover:bg-rowhover"
        >
          <Initial name={m.from} email={m.fromEmail} agency={m.fromAgency} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 truncate text-[15px] font-semibold text-foreground">{name}</span>
              <span className="ml-auto shrink-0 text-[13px] tabular-nums text-faint">{fmtWhen(m.ts, locale)}</span>
            </span>
            <span className="block truncate text-[14px] text-muted-foreground">{snippet}</span>
          </span>
        </motion.button>
      );
    }
    return (
      <motion.article {...enter} className="flex flex-col rounded-2xl bg-surface p-3.5 sm:p-4">
        <div className="flex cursor-pointer items-start gap-3" onClick={headClick(onToggle)}>
          <Initial name={m.from} email={m.fromEmail} agency={m.fromAgency} size="md" />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline gap-2">
              <span data-sel className="min-w-0 cursor-text select-text truncate text-[15px] font-semibold text-foreground">{name}</span>
              <span className="ml-auto shrink-0 text-[13px] tabular-nums text-faint">{fmtWhen(m.ts, locale)}</span>
            </span>
            <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-[13px] text-faint">
              {!m.fromAgency && m.fromEmail && <CopyAddress email={m.fromEmail} className="text-[13px] text-muted-foreground" />}
              <Recipients m={m} className="" />
            </span>
          </span>
        </div>
        <div className="mt-3 overflow-hidden rounded-xl bg-white dark:p-3">
          <MailBody m={m} showQuoted={showQuoted} fontPx={16} />
        </div>
        {hasQuote(m.html) && <QuoteToggle shown={showQuoted} onClick={() => setShowQuoted((v) => !v)} />}
        {files.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {files.map((a) => (
              <button
                key={a.attachmentId}
                type="button"
                onClick={() => void download(a)}
                title={t("Télécharger {name}", { name: a.filename })}
                className="flex min-h-11 max-w-full items-center gap-2.5 rounded-full bg-field py-1.5 pl-1.5 pr-3.5 text-left transition-colors hover:bg-rowhover"
              >
                <FileBadge name={a.filename} />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-medium text-foreground">{a.filename}</span>
                  <span className="block text-[12px] text-muted-foreground">{fmtSize(a.size)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {extra}
        {footer && <div className="mt-4">{footer}</div>}
      </motion.article>
    );
  }

  if (variant === "plain") {
    if (!open) {
      return (
        <motion.button
          {...enter}
          type="button"
          onClick={onToggle}
          className="-mx-3 flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-rowhover"
        >
          <Initial name={m.from} email={m.fromEmail} agency={m.fromAgency} size="sm" />
          <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center">
            <span className="truncate text-[13px] font-medium text-foreground">{name}</span>
            <span className="col-span-2 row-start-2 truncate text-[13px] text-muted-foreground sm:col-span-1 sm:col-start-2 sm:row-start-1">{snippet}</span>
            <span className="col-start-2 row-start-1 shrink-0 text-[11px] tabular-nums text-faint sm:col-start-3">{fmtWhen(m.ts, locale)}</span>
          </span>
        </motion.button>
      );
    }
    const ago = fmtAgo(m.ts, lang);
    return (
      <motion.article {...enter} className="flex flex-col py-5">
        {/* En-tête : le nom prend toute la largeur (avant : écrasé par la date, « Al… aly… »),
            la date passe sous l'adresse, les actions restent à droite du nom. */}
        <div className="flex cursor-pointer items-start gap-3" onClick={headClick(onToggle)}>
          <Initial name={m.from} email={m.fromEmail} agency={m.fromAgency} size="lg" />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span data-sel className="min-w-0 cursor-text select-text truncate text-[14.5px] font-semibold text-foreground">{name}</span>
              <span className="min-w-0 flex-1" />
              <span className="-my-1.5 flex shrink-0 items-center gap-0.5 text-muted-foreground">
                {actions.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    onClick={a.onClick}
                    title={a.label}
                    aria-label={a.label}
                    className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-rowhover hover:text-foreground"
                  >
                    <a.icon className="h-4 w-4" />
                  </button>
                ))}
                <FoldButton onClick={onToggle} />
              </span>
            </span>
            {m.fromAgency || !m.fromEmail ? (
              <span data-sel className="block w-fit max-w-full cursor-text select-text truncate text-[12.5px] text-muted-foreground">{m.fromAgency ? m.from : m.fromEmail}</span>
            ) : (
              <CopyAddress email={m.fromEmail} className="text-[12.5px] text-muted-foreground" />
            )}
            <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11.5px] text-faint">
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {fmtFull(m.ts, locale)}{ago && <span className="text-faint"> ({ago})</span>}
              </span>
              <span aria-hidden>·</span>
              <Recipients m={m} className="text-faint" />
            </span>
          </span>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg bg-white dark:p-4">
          <MailBody m={m} showQuoted={showQuoted} />
        </div>
        {hasQuote(m.html) && <QuoteToggle shown={showQuoted} onClick={() => setShowQuoted((v) => !v)} />}

        {files.length > 0 && (
          <div className="mt-6">
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <span className="text-[13px] font-semibold text-foreground">
                {files.length > 1 ? t("{n} pièces jointes", { n: files.length }) : t("{n} pièce jointe", { n: files.length })}
              </span>
              {files.length > 1 && (
                <button
                  type="button"
                  onClick={() => void files.reduce<Promise<unknown>>((p, a) => p.then(() => download(a)), Promise.resolve())}
                  className="text-[12.5px] font-medium text-primary hover:underline"
                >
                  {t("Tout télécharger")}
                </button>
              )}
            </div>
            <div className="-mx-2 flex flex-col gap-1 sm:flex-row sm:flex-wrap">
              {files.map((a) => (
                <button
                  key={a.attachmentId}
                  type="button"
                  onClick={() => void download(a)}
                  title={t("Télécharger {name}", { name: a.filename })}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-rowhover sm:w-[280px]"
                >
                  <FileBadge name={a.filename} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-foreground">{a.filename}</span>
                    <span className="block text-[11.5px] text-muted-foreground">{fmtSize(a.size)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {extra}
        {footer && <div className="mt-6">{footer}</div>}
      </motion.article>
    );
  }

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
          <span className="col-start-2 row-start-1 shrink-0 text-[11px] tabular-nums text-faint sm:col-start-3">{fmtWhen(m.ts, locale)}</span>
        </span>
      </motion.button>
    );
  }

  return (
    <motion.article {...enter} className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm shadow-black/[0.03]">
      {/* En-tête */}
      <div className="flex cursor-pointer items-start gap-3 border-b border-border px-4 py-3.5 sm:px-5" onClick={headClick(onToggle)}>
        <Initial name={m.from} email={m.fromEmail} agency={m.fromAgency} />
        <span className="min-w-0 flex-1">
          <span data-sel className="block w-fit max-w-full cursor-text select-text truncate text-[14px] font-semibold text-foreground">{name}</span>
          {m.fromAgency || !m.fromEmail ? (
            <span data-sel className="block w-fit max-w-full cursor-text select-text truncate text-[12px] text-muted-foreground">{m.fromAgency ? m.from : m.fromEmail}</span>
          ) : (
            <CopyAddress email={m.fromEmail} className="text-[12px] text-muted-foreground" />
          )}
          <span className="mt-0.5 flex flex-col items-start text-[11px] text-faint">
            <Recipients m={m} className="" />
          </span>
        </span>
        <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
          <span className="mr-1 hidden text-[11px] tabular-nums text-faint sm:inline">{fmtFull(m.ts, locale)}</span>
          <span className="mr-1 text-[11px] tabular-nums text-faint sm:hidden">{fmtWhen(m.ts, locale)}</span>
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
          <FoldButton onClick={onToggle} />
        </div>
      </div>

      {/* Corps */}
      <div className="px-4 py-4 sm:px-5">
        <div className="overflow-hidden rounded-lg bg-white dark:p-4">
          <MailBody m={m} showQuoted={showQuoted} />
        </div>
        {hasQuote(m.html) && <QuoteToggle shown={showQuoted} onClick={() => setShowQuoted((v) => !v)} className="block" />}
        {files.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {files.map((a) => (
              <button
                key={a.attachmentId}
                type="button"
                onClick={() => {
                  const run = onDownload ? Promise.resolve(onDownload(a)) : threadId ? downloadAttachment(threadId, a, creator) : null;
                  run?.catch((e) => toast((e as Error).message));
                }}
                className="flex max-w-full items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-rowhover"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted">
                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium text-foreground">{a.filename}</span>
                  <span className="block text-[11px] text-faint">{fmtSize(a.size)} · {t("Télécharger")}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {extra}
      </div>

      {/* Pied (réponse) */}
      {footer && <div className="border-t border-border bg-muted/50 px-3 py-3 sm:px-4">{footer}</div>}
    </motion.article>
  );
}
