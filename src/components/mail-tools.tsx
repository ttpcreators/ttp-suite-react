import { useEffect, useRef, useState } from "react";
import { PenLine, Reply, Send, Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { Tabs } from "@/components/ui/animated-tabs";
import { useMailSettings } from "@/lib/useMailSettings";
import {
  BOX_LABEL, DELAYS, buildHtml, clearSentDraft, draftKeys, getDraftFiles, markDraftSending, parseEmails, readDraft, readDraftRaw,
  restoreDraft, saveMailSettings, scheduleSend, sendFailText, sendGmail, setDraftFiles, subscribeDrafts, writeDraft,
  type DraftBase, type MailBox, type OutAttachment,
} from "@/lib/mailSend";
import { useAttachments } from "@/lib/useAttachments";
import { AttachButton, AttachChips } from "@/components/mail-attach";
import { BoxChip, BoxPicker } from "@/components/mail-box-chip";
import { cleanSignature } from "@/lib/mailSignature";
import type { MailMessage } from "@/lib/creatorMail";
import { Overlay } from "@/components/mobile/ios-sheet";
import { ClaudeConsigne, ClaudeReadyBanner, ClaudeReplyButton, useClaudeReply } from "@/components/mail-claude";

/*
 * Outils d'écriture des mails (agence) : réglages (signature collée, délai
 * d'annulation), zone de réponse avec copie (et « Répondre à tous »), fenêtres de
 * transfert et de nouveau mail. Tout ce qui est écrit est gardé en brouillon sur
 * cet appareil jusqu'à l'envoi confirmé (échec ou annulation : le texte revient).
 */


const field = "h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] text-foreground outline-none placeholder:text-faint focus:border-primary";

/** Case « Ajouter ma signature » (désactivée si aucune signature enregistrée). */
function SignatureToggle({ on, onChange, has }: { on: boolean; onChange: (v: boolean) => void; has: boolean }) {
  return (
    <label className={cn("flex cursor-pointer select-none items-center gap-1.5 text-[12px] text-muted-foreground", !has && "opacity-50")}>
      <input type="checkbox" checked={on && has} disabled={!has} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-primary)]" />
      Signature
    </label>
  );
}

// ── Réglages ────────────────────────────────────────────────────────────────
export function MailSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cur = useMailSettings();
  const [sig, setSig] = useState("");
  const [delay, setDelay] = useState(10);
  const [on, setOn] = useState(true);
  const [saving, setSaving] = useState(false);
  const zone = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setSig(cur.signatureHtml);
    if (zone.current) zone.current.innerHTML = cur.signatureHtml;
    setDelay(cur.delaySec);
    setOn(cur.signatureOn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    const next = html ? cleanSignature(html) : text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c).replace(/\n/g, "<br>");
    // Un collage remplace toute la signature (HTML déjà assaini).
    if (zone.current) zone.current.innerHTML = next;
    setSig(next);
  };

  const save = async () => {
    const html = cleanSignature(sig);
    // Logo collé comme image intégrée : trop lourd pour être ajouté à chaque mail.
    if (html.length > 400_000) return toast("Signature trop lourde : copie-la depuis un mail envoyé (logo en lien), pas depuis une capture.");
    setSaving(true);
    const ok = await saveMailSettings({ signatureHtml: html, signatureOn: on, delaySec: delay });
    setSaving(false);
    if (!ok) return toast("Réglages non enregistrés");
    toast("Réglages des mails enregistrés ✓");
    onClose();
  };

  return (
    <Overlay className="fixed inset-0 z-[120] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClose={onClose}>
      <div className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1 text-[14px] font-semibold text-foreground">Réglages des mails</span>
          <button type="button" onClick={onClose} aria-label="Fermer" className="grid h-8 w-8 place-items-center rounded-full text-faint hover:bg-rowhover hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section>
            <div className="mb-1 text-[13px] font-semibold text-foreground">Ma signature</div>
            <p className="mb-2 text-[12px] text-muted-foreground">
              Ouvre un mail que tu as envoyé depuis Gmail, sélectionne ta signature (logo compris), copie-la (⌘C) puis colle-la (⌘V) dans le cadre ci-dessous.
            </p>
            <div className="relative">
              {/* Zone éditable : sans contentEditable, le navigateur bloque ⌘V. Le contenu
                  collé est intercepté, assaini (DOMPurify) puis réinjecté. */}
              <div
                ref={zone}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-label="Ma signature"
                onPaste={onPaste}
                onInput={(e) => setSig(cleanSignature((e.target as HTMLDivElement).innerHTML))}
                onDrop={(e) => e.preventDefault()}
                className="min-h-[120px] rounded-xl border border-dashed border-border bg-white p-3 text-[13px] text-zinc-900 outline-none focus:border-primary"
              />
              {!sig && (
                <span className="pointer-events-none absolute left-3 top-3 text-[13px] text-zinc-400">Clique ici puis colle ta signature (⌘V)…</span>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-primary)]" />
                Ajouter ma signature par défaut
              </label>
              {sig && (
                <button type="button" onClick={() => { setSig(""); if (zone.current) zone.current.innerHTML = ""; }} className="text-[12px] font-medium text-muted-foreground hover:text-foreground">Effacer</button>
              )}
            </div>
          </section>
          <section>
            <div className="mb-1 text-[13px] font-semibold text-foreground">Délai d'annulation</div>
            <p className="mb-2 text-[12px] text-muted-foreground">Le mail part après ce délai : tu as le temps de cliquer sur « Annuler » si tu as fait une erreur. Garde l'app ouverte pendant ce temps.</p>
            <Tabs
              size="sm"
              label="Délai d'annulation"
              value={String(delay)}
              onValueChange={(v) => setDelay(Number(v))}
              items={DELAYS.map((d) => ({ value: String(d), label: d === 0 ? "Aucun" : `${d} s` }))}
            />
          </section>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={onClose} className="h-9 rounded-lg px-3 text-[13px] text-muted-foreground hover:text-foreground">Annuler</button>
          <button type="button" onClick={() => void save()} disabled={saving} className="h-9 rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40">
            Enregistrer
          </button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Brouillons ──────────────────────────────────────────────────────────────
type ReplyDraft = DraftBase & { text: string; cc: string; bcc: string; replyAll: boolean };
type FwdDraft = DraftBase & { to: string; cc: string; bcc: string; note: string; box: MailBox; keepOriginal: boolean; sig: boolean };
type NewDraft = DraftBase & { to: string; cc: string; bcc: string; subject: string; body: string; box: MailBox; sig: boolean };

/** Fils qui ont un brouillon de réponse (clés `replyDraftKey`), mis à jour en direct. */
export function useReplyDraftKeys(): Set<string> {
  const [keys, setKeys] = useState<Set<string>>(() => new Set(draftKeys("reply:")));
  useEffect(
    () =>
      subscribeDrafts((k) => {
        if (!k.startsWith("reply:")) return;
        const has = !!readDraft<ReplyDraft>(k)?.text?.trim();
        setKeys((cur) => {
          if (cur.has(k) === has) return cur;
          const n = new Set(cur);
          if (has) n.add(k);
          else n.delete(k);
          return n;
        });
      }),
    [],
  );
  return keys;
}

/** Fermer une fenêtre qui contient un mail en cours : le garder en brouillon ou le supprimer. */
function KeepDraftBar({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  return (
    <div role="alertdialog" aria-label="Garder ce mail en brouillon ?" className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/60 px-5 py-3">
      <span className="min-w-0 flex-1 text-[13px] font-medium text-foreground">Garder ce mail en brouillon ?</span>
      <button type="button" onClick={onDiscard} className="h-8 rounded-full px-3 text-[12.5px] font-semibold text-dangertext transition-colors hover:bg-danger/10">
        Supprimer
      </button>
      <button type="button" onClick={onKeep} autoFocus className="h-8 rounded-full bg-primary px-3.5 text-[12.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">
        Garder en brouillon
      </button>
    </div>
  );
}

/** Échap ferme la fenêtre (avec la même question que le bouton ✕). */
function useEscape(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        ref.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

// ── Réponse dans le fil ─────────────────────────────────────────────────────
export function ReplyBox({
  placeholder, box, focusKey, focusMode, onSend, variant = "bar", to, toTitle, draftKey, replyAllCc = [], sendLabel, claude,
}: {
  /** « Rédiger avec Claude » (connecteur, sans clé API) : fil concerné. */
  claude?: { threadId: string; subject: string };
  placeholder: string; box: MailBox; focusKey?: number;
  /** Mode demandé avec le focus (raccourcis r / a). */
  focusMode?: "reply" | "all";
  /** Appelé au moment de l'envoi réel (après le délai d'annulation). */
  onSend: (p: { text: string; cc: string[]; bcc: string[]; html: string; attachments: OutAttachment[]; replyAll: boolean; draftKey?: string }) => Promise<boolean>;
  /** « card » : cadre complet façon client mail (destinataire, zone haute, bouton Envoyer). */
  variant?: "bar" | "card";
  /** Destinataire affiché en tête du cadre (variante « card »). */
  to?: string;
  /** Adresse complète du destinataire (bulle au survol). */
  toTitle?: string;
  /** Brouillon gardé sur cet appareil (clé `replyDraftKey(boîte, fil)`) ; le composant est à remonter (key) à chaque fil. */
  draftKey?: string;
  /** « Répondre à tous » : adresses ajoutées en copie (liste vide = pas de bascule). */
  replyAllCc?: string[];
  /** Libellé de l'envoi programmé (barre « Annuler l'envoi »). */
  sendLabel?: string;
}) {
  const settings = useMailSettings();
  const [initial] = useState(() => (draftKey ? readDraft<ReplyDraft>(draftKey) : null));
  const [text, setText] = useState(initial?.text ?? "");
  const [ccOpen, setCcOpen] = useState(!!initial?.cc);
  const [cc, setCc] = useState(initial?.cc ?? "");
  const [bccOpen, setBccOpen] = useState(!!initial?.bcc);
  const [bcc, setBcc] = useState(initial?.bcc ?? "");
  const [replyAll, setReplyAll] = useState(!!initial?.replyAll && replyAllCc.length > 0);
  const att = useAttachments();
  const [sig, setSig] = useState(settings.signatureOn);
  const ref = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const ai = useClaudeReply(claude ? { ...claude, box } : undefined, text, (t) => {
    setText(t);
    requestAnimationFrame(() => ref.current?.focus());
  });
  const [aiOpen, setAiOpen] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    if (draftKey) {
      const files = getDraftFiles(draftKey);
      if (files.length) att.setFiles(files);
    }
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => setSig(settings.signatureOn), [settings.signatureOn]);

  // Brouillon : gardé à chaque frappe, effacé quand la zone est vidée (pas pendant un envoi).
  useEffect(() => {
    if (!draftKey) return;
    if (text.trim()) {
      writeDraft(draftKey, { text, cc, bcc, replyAll, at: Date.now() } satisfies ReplyDraft);
      return;
    }
    const cur = readDraftRaw<ReplyDraft>(draftKey);
    if (cur && !cur.sendingAt) writeDraft(draftKey, null);
  }, [draftKey, text, cc, bcc, replyAll]);
  useEffect(() => {
    if (!draftKey) return;
    // Envoi en cours (zone vidée) : on garde les fichiers envoyés, rendus en cas d'échec.
    if (!att.files.length && readDraftRaw<ReplyDraft>(draftKey)?.sendingAt) return;
    setDraftFiles(draftKey, att.files);
  }, [draftKey, att.files]);

  // Envoi échoué ou annulé : le brouillon revient dans la zone (si elle est restée vide).
  useEffect(() => {
    if (!draftKey) return;
    return subscribeDrafts((k) => {
      if (k !== draftKey || textRef.current.trim()) return;
      const d = readDraft<ReplyDraft>(k);
      if (!d?.text) return;
      setText(d.text);
      setCc(d.cc);
      setCcOpen(!!d.cc);
      setBcc(d.bcc);
      setBccOpen(!!d.bcc);
      setReplyAll(!!d.replyAll);
      const files = getDraftFiles(k);
      if (files.length) att.setFiles(files);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // Répondre ↔ Répondre à tous : les autres destinataires passent en copie (ou en sortent).
  const setMode = (all: boolean) => {
    if (all === replyAll || !replyAllCc.length) return;
    const cur = parseEmails(cc).ok;
    const next = all ? [...new Set([...replyAllCc, ...cur])] : cur.filter((a) => !replyAllCc.includes(a));
    setCc(next.join(", "));
    setCcOpen(next.length > 0);
    setReplyAll(all);
  };

  useEffect(() => {
    if (!focusKey) return;
    if (focusMode) setMode(focusMode === "all");
    ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    const copy = parseEmails(cc);
    const hidden = parseEmails(bcc);
    if (copy.bad.length) return toast(`Adresse en copie invalide : ${copy.bad[0]}`);
    if (hidden.bad.length) return toast(`Adresse en copie cachée invalide : ${hidden.bad[0]}`);
    const html = buildHtml(body, { signature: sig ? settings.signatureHtml : "" });
    const files = att.files;
    const snap = { text, cc, bcc, replyAll };
    if (draftKey) {
      writeDraft(draftKey, { ...snap, at: Date.now() } satisfies ReplyDraft);
      setDraftFiles(draftKey, files);
      markDraftSending(draftKey);
    }
    setText("");
    setCc("");
    setCcOpen(false);
    setBcc("");
    setBccOpen(false);
    att.clear();
    // Échec ou annulation : le texte et les fichiers reviennent (brouillon).
    const restore = () => {
      if (draftKey) restoreDraft(draftKey);
      else if (mounted.current) {
        setText((t) => t || snap.text);
        att.setFiles((cur) => (cur.length ? cur : files));
      }
    };
    scheduleSend(sendLabel ?? `Réponse depuis ${BOX_LABEL[box]}`, settings.delaySec, async () => {
      const done = await onSend({ text: body, cc: copy.ok, bcc: hidden.ok, html, attachments: files, replyAll: snap.replyAll, draftKey });
      if (!done) restore();
      else if (draftKey) clearSentDraft(draftKey);
    }, { onCancel: restore });
  };

  if (variant === "card") {
    const line = "flex items-center gap-2 border-b border-border px-3.5 py-1.5";
    const addr = "h-7 min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-faint";
    const seg = (on: boolean) =>
      cn("rounded-full px-2 py-0.5 text-[11.5px] font-semibold transition-colors", on ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground");
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-surface transition-colors focus-within:border-primary">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2 text-[12.5px]">
          <Reply className="h-4 w-4 shrink-0 text-muted-foreground" />
          {replyAllCc.length > 0 && (
            <div role="group" aria-label="Destinataires" className="flex shrink-0 rounded-full bg-muted p-0.5">
              <button type="button" aria-pressed={!replyAll} onClick={() => setMode(false)} className={seg(!replyAll)}>Répondre</button>
              <button type="button" aria-pressed={replyAll} onClick={() => setMode(true)} className={seg(replyAll)}>
                <span className="max-sm:hidden">Répondre à tous</span><span className="sm:hidden">À tous</span>
              </button>
            </div>
          )}
          <span className="shrink-0 text-muted-foreground">À :</span>
          {to && <span title={toTitle} className="min-w-0 truncate rounded-md bg-muted px-2 py-0.5 font-medium text-foreground">{to}</span>}
          <span className="flex-1" />
          <button type="button" onClick={() => setCcOpen((v) => !v)} className={cn("shrink-0 rounded px-1 font-medium text-muted-foreground hover:text-foreground", ccOpen && "text-foreground")}>Cc</button>
          <button type="button" onClick={() => setBccOpen((v) => !v)} className={cn("shrink-0 rounded px-1 font-medium text-muted-foreground hover:text-foreground", bccOpen && "text-foreground")}>Cci</button>
        </div>
        {ccOpen && (
          <div className={line}>
            <span className="w-8 shrink-0 text-[12px] text-muted-foreground">Cc</span>
            <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="adresse@exemple.com, autre@exemple.com" className={addr} inputMode="email" aria-label="Copie" />
          </div>
        )}
        {bccOpen && (
          <div className={line}>
            <span className="w-8 shrink-0 text-[12px] text-muted-foreground">Cci</span>
            <input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="Invisible pour les autres : adresse@exemple.com" className={addr} autoFocus inputMode="email" aria-label="Copie cachée" />
          </div>
        )}
        {ai.ready && <ClaudeReadyBanner onInsert={ai.insert} onDismiss={ai.dismiss} />}
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          rows={3}
          placeholder={placeholder}
          aria-label="Ta réponse"
          className="block max-h-80 min-h-[96px] w-full resize-none bg-transparent px-4 py-3 text-[13px] leading-relaxed text-foreground outline-none [field-sizing:content] placeholder:text-faint"
        />
        {att.files.length > 0 && <div className="px-3.5 pb-2.5"><AttachChips files={att.files} onRemove={att.remove} /></div>}
        {claude && aiOpen && !ai.waiting && <ClaudeConsigne onStart={(c) => void ai.start(c)} onClose={() => setAiOpen(false)} />}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-3.5 py-2 text-[12px] text-muted-foreground">
          <AttachButton onFiles={(f) => void att.add(f)} total={att.total} />
          <SignatureToggle on={sig} onChange={setSig} has={!!settings.signatureHtml} />
          <BoxChip box={box} prefix="Depuis" />
          {claude && <ClaudeReplyButton open={aiOpen} onToggle={() => setAiOpen((v) => !v)} waiting={ai.waiting} onCancel={ai.cancelWait} />}
          <span className="flex-1" />
          <span className="text-faint max-sm:hidden">
            {settings.delaySec ? `annulable ${settings.delaySec} s · ` : ""}⌘↵
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim()}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[12.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-35"
          >
            <Send className="h-3.5 w-3.5" /> Envoyer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {ccOpen && (
        <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Cc : adresse@exemple.com, autre@exemple.com" className={field} autoFocus inputMode="email" />
      )}
      {bccOpen && (
        <input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="Cci (invisible pour les autres) : adresse@exemple.com" className={field} autoFocus inputMode="email" />
      )}
      <AttachChips files={att.files} onRemove={att.remove} />
      <div className="flex items-end gap-2 rounded-xl border border-border bg-surface p-1.5 pl-3.5 focus-within:border-primary">
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          rows={1}
          placeholder={placeholder}
          className="max-h-48 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[13px] text-foreground outline-none [field-sizing:content] placeholder:text-faint"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          aria-label="Envoyer la réponse"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[12px] text-muted-foreground">
        <button type="button" onClick={() => setCcOpen((v) => !v)} className={cn("font-medium hover:text-foreground", ccOpen && "text-foreground")}>
          Cc
        </button>
        <button type="button" onClick={() => setBccOpen((v) => !v)} className={cn("font-medium hover:text-foreground", bccOpen && "text-foreground")}>
          Cci
        </button>
        <AttachButton onFiles={(f) => void att.add(f)} total={att.total} />
        <SignatureToggle on={sig} onChange={setSig} has={!!settings.signatureHtml} />
        <BoxChip box={box} prefix="Depuis" />
        <span className="text-faint">
          {settings.delaySec ? `annulable ${settings.delaySec} s · ` : ""}⌘↵ pour envoyer
        </span>
      </div>
    </div>
  );
}

// ── Transfert ───────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
const notInline = (a: MailMessage["attachments"][number]) => !(a as typeof a & { inline?: boolean }).inline;

export type ForwardReopen = { message: MailMessage; subject: string; sourceBox?: MailBox; defaultBox: MailBox };

export function ForwardDialog({
  message, subject, defaultBox, sourceBox, onClose, onReopen,
}: {
  message: MailMessage | null; subject: string; defaultBox: MailBox;
  /** Boîte où se trouve le mail d'origine (pour en joindre les pièces jointes). */
  sourceBox?: MailBox;
  onClose: () => void;
  /** Envoi échoué ou annulé : rouvrir la fenêtre avec son contenu. */
  onReopen?: (p: ForwardReopen) => void;
}) {
  if (!message) return null;
  return (
    <ForwardPanel key={message.id} message={message} subject={subject} defaultBox={defaultBox} sourceBox={sourceBox} onClose={onClose} onReopen={onReopen} />
  );
}

function ForwardPanel({
  message, subject, defaultBox, sourceBox, onClose, onReopen,
}: {
  message: MailMessage; subject: string; defaultBox: MailBox; sourceBox?: MailBox;
  onClose: () => void; onReopen?: (p: ForwardReopen) => void;
}) {
  const settings = useMailSettings();
  const key = `fwd:${message.id}`;
  const [d] = useState(() => readDraft<FwdDraft>(key));
  const [to, setTo] = useState(d?.to ?? "");
  const [cc, setCc] = useState(d?.cc ?? "");
  const [bcc, setBcc] = useState(d?.bcc ?? "");
  const [keepOriginal, setKeepOriginal] = useState(d?.keepOriginal ?? true);
  const att = useAttachments();
  const [note, setNote] = useState(d?.note ?? "");
  const [box, setBox] = useState<MailBox>(d?.box ?? defaultBox);
  const [sig, setSig] = useState(d?.sig ?? settings.signatureOn);
  const [ask, setAsk] = useState(false);
  useEffect(() => {
    const files = getDraftFiles(key);
    if (files.length) att.setFiles(files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasContent = !!(to.trim() || cc.trim() || bcc.trim() || note.trim() || att.files.length);
  // Brouillon gardé tant que la fenêtre est ouverte.
  useEffect(() => {
    if (hasContent) writeDraft(key, { to, cc, bcc, note, box, keepOriginal, sig, at: Date.now() } satisfies FwdDraft);
    else if (readDraftRaw<FwdDraft>(key) && !readDraftRaw<FwdDraft>(key)?.sendingAt) writeDraft(key, null);
    setDraftFiles(key, att.files);
  }, [key, hasContent, to, cc, bcc, note, box, keepOriginal, sig, att.files]);

  const requestClose = () => {
    if (!hasContent) {
      writeDraft(key, null);
      return onClose();
    }
    if (ask) return onClose(); // 2ᵉ demande : on garde le brouillon
    setAsk(true);
  };
  useEscape(requestClose);

  // Les pièces jointes d'origine ne sont jointes que si on connaît la boîte du mail.
  const originals = message.attachments.filter(notInline);
  const canKeep = !!sourceBox && originals.length > 0;
  const withOriginal = canKeep && keepOriginal;
  const fwdSubject = /^(tr|fwd?)\s*:/i.test(subject) ? subject : `Tr: ${subject}`;

  const send = () => {
    const dest = parseEmails(to);
    const copy = parseEmails(cc);
    const hidden = parseEmails(bcc);
    if (dest.ok.length !== 1 || dest.bad.length) return toast("Indique une adresse de destinataire valide");
    if (copy.bad.length) return toast(`Adresse en copie invalide : ${copy.bad[0]}`);
    if (hidden.bad.length) return toast(`Adresse en copie cachée invalide : ${hidden.bad[0]}`);
    const header = `<p style="color:#71717a;font-size:12px">---------- Message transféré ----------<br>De : ${esc(message.from)} &lt;${esc(message.fromEmail)}&gt;<br>Date : ${esc(new Date(message.ts).toLocaleString("fr-FR"))}<br>Objet : ${esc(subject)}<br>À : ${esc(message.to)}</p>`;
    const original = message.html || `<pre style="white-space:pre-wrap;font:inherit">${esc(message.text)}</pre>`;
    const html = buildHtml(note, { signature: sig ? settings.signatureHtml : "", quoted: header + original });
    const forward = withOriginal ? { box: sourceBox ?? box, messageId: message.id } : undefined;
    const files = att.files;
    writeDraft(key, { to, cc, bcc, note, box, keepOriginal, sig, at: Date.now() } satisfies FwdDraft);
    setDraftFiles(key, files);
    markDraftSending(key);
    const label = `Transfert à ${dest.ok[0]}`;
    const reopen = () => {
      restoreDraft(key);
      onReopen?.({ message, subject, sourceBox, defaultBox });
    };
    scheduleSend(label, settings.delaySec, async () => {
      const r = await sendGmail({ to: dest.ok[0], cc: copy.ok, bcc: hidden.ok, subject: fwdSubject, html, box, source: "manual", attachments: files, forward }, { label });
      if (r.ok) {
        clearSentDraft(key);
        toast("Mail transféré ✓");
      } else {
        toast(sendFailText(r.error));
        reopen();
      }
    }, { onCancel: reopen });
    onClose();
  };

  return (
    <Overlay className="fixed inset-0 z-[120] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClose={requestClose} label="Transférer">
      <div className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <PenLine className="h-4 w-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">{fwdSubject}</span>
          <button type="button" onClick={requestClose} aria-label="Fermer" className="grid h-8 w-8 place-items-center rounded-full text-faint hover:bg-rowhover hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-2.5 overflow-y-auto px-5 py-4">
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="À : adresse@exemple.com" className={field} autoFocus inputMode="email" aria-label="Destinataire" />
          <div className="grid gap-2.5 sm:grid-cols-2">
            <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Cc (facultatif)" className={field} inputMode="email" aria-label="Copie" />
            <input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="Cci (facultatif)" className={field} inputMode="email" aria-label="Copie cachée" />
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
            }}
            rows={4}
            placeholder="Ajoute un mot (facultatif)…"
            aria-label="Message"
            className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-faint focus:border-primary"
          />
          <div className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-[12px] text-muted-foreground">
            Message transféré : <span className="font-medium text-foreground">{message.from}</span>, {new Date(message.ts).toLocaleDateString("fr-FR")}
            {canKeep ? (
              <label className="mt-1.5 flex cursor-pointer select-none items-center gap-1.5">
                <input type="checkbox" checked={keepOriginal} onChange={(e) => setKeepOriginal(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-primary)]" />
                Joindre ses pièces jointes ({originals.map((a) => a.filename).join(", ")})
              </label>
            ) : originals.length > 0 ? (
              <span className="block text-faint">Les pièces jointes d'origine ne sont pas transférées.</span>
            ) : null}
          </div>
          <AttachChips files={att.files} onRemove={att.remove} />
        </div>
        {ask ? (
          <KeepDraftBar onKeep={onClose} onDiscard={() => { writeDraft(key, null); onClose(); }} />
        ) : (
          <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-3">
            <BoxPicker value={box} onChange={setBox} />
            <AttachButton onFiles={(f) => void att.add(f)} total={att.total} className="text-[12px] text-muted-foreground" />
            <SignatureToggle on={sig} onChange={setSig} has={!!settings.signatureHtml} />
            <button type="button" onClick={send}
              className="ml-auto flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40">
              <Send className="h-4 w-4" /> Transférer
            </button>
          </div>
        )}
      </div>
    </Overlay>
  );
}

// ── Nouveau mail libre (n'importe quelle adresse, boîte au choix) ────────────
export function NewMailDialog({
  open, defaultBox, onClose, onSent, onReopen,
}: {
  open: boolean; defaultBox: MailBox; onClose: () => void; onSent?: () => void;
  /** Envoi échoué ou annulé : rouvrir la fenêtre avec son contenu. */
  onReopen?: () => void;
}) {
  if (!open) return null;
  return <NewMailPanel defaultBox={defaultBox} onClose={onClose} onSent={onSent} onReopen={onReopen} />;
}

const NEW_KEY = "new";

function NewMailPanel({ defaultBox, onClose, onSent, onReopen }: { defaultBox: MailBox; onClose: () => void; onSent?: () => void; onReopen?: () => void }) {
  const settings = useMailSettings();
  const [d] = useState(() => readDraft<NewDraft>(NEW_KEY));
  const [to, setTo] = useState(d?.to ?? "");
  const [cc, setCc] = useState(d?.cc ?? "");
  const [bcc, setBcc] = useState(d?.bcc ?? "");
  const [subject, setSubject] = useState(d?.subject ?? "");
  const [body, setBody] = useState(d?.body ?? "");
  const [box, setBox] = useState<MailBox>(d?.box ?? defaultBox);
  const [sig, setSig] = useState(d?.sig ?? settings.signatureOn);
  const [ask, setAsk] = useState(false);
  const att = useAttachments();
  useEffect(() => {
    const files = getDraftFiles(NEW_KEY);
    if (files.length) att.setFiles(files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasContent = !!(to.trim() || cc.trim() || bcc.trim() || subject.trim() || body.trim() || att.files.length);
  // Brouillon gardé tant que la fenêtre est ouverte.
  useEffect(() => {
    if (hasContent) writeDraft(NEW_KEY, { to, cc, bcc, subject, body, box, sig, at: Date.now() } satisfies NewDraft);
    else if (readDraftRaw<NewDraft>(NEW_KEY) && !readDraftRaw<NewDraft>(NEW_KEY)?.sendingAt) writeDraft(NEW_KEY, null);
    setDraftFiles(NEW_KEY, att.files);
  }, [hasContent, to, cc, bcc, subject, body, box, sig, att.files]);

  const requestClose = () => {
    if (!hasContent) {
      writeDraft(NEW_KEY, null);
      return onClose();
    }
    if (ask) return onClose(); // 2ᵉ demande : on garde le brouillon
    setAsk(true);
  };
  useEscape(requestClose);

  const send = () => {
    const dest = parseEmails(to);
    const copy = parseEmails(cc);
    const hidden = parseEmails(bcc);
    if (dest.ok.length !== 1 || dest.bad.length) return toast("Indique une adresse de destinataire valide (une seule, les autres en Cc)");
    if (copy.bad.length) return toast(`Adresse en copie invalide : ${copy.bad[0]}`);
    if (hidden.bad.length) return toast(`Adresse en copie cachée invalide : ${hidden.bad[0]}`);
    if (!subject.trim() || !body.trim()) return toast("Objet et message requis");
    const html = buildHtml(body, { signature: sig ? settings.signatureHtml : "" });
    const params = {
      to: dest.ok[0], cc: copy.ok, bcc: hidden.ok, subject: subject.trim(), html, box,
      attachments: att.files, source: "manual",
    };
    writeDraft(NEW_KEY, { to, cc, bcc, subject, body, box, sig, at: Date.now() } satisfies NewDraft);
    setDraftFiles(NEW_KEY, att.files);
    markDraftSending(NEW_KEY);
    const label = `Mail à ${dest.ok[0]}`;
    const reopen = () => {
      restoreDraft(NEW_KEY);
      onReopen?.();
    };
    scheduleSend(label, settings.delaySec, async () => {
      const r = await sendGmail(params, { label });
      if (!r.ok) {
        toast(sendFailText(r.error));
        return reopen();
      }
      clearSentDraft(NEW_KEY);
      toast(`Mail envoyé depuis ${BOX_LABEL[box]} ✓`);
      onSent?.();
    }, { onCancel: reopen });
    onClose();
  };

  return (
    <Overlay className="fixed inset-0 z-[120] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClose={requestClose} label="Nouveau mail">
      <div className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <PenLine className="h-4 w-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">{d ? "Nouveau mail · brouillon" : "Nouveau mail"}</span>
          <button type="button" onClick={requestClose} aria-label="Fermer" className="grid h-8 w-8 place-items-center rounded-full text-faint hover:bg-rowhover hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-2.5 overflow-y-auto px-5 py-4">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            <span>Envoyer depuis</span>
            <BoxPicker value={box} onChange={setBox} />
          </div>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="À : adresse@exemple.com" className={field} autoFocus inputMode="email" aria-label="Destinataire" />
          <div className="grid gap-2.5 sm:grid-cols-2">
            <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Cc (facultatif)" className={field} inputMode="email" aria-label="Copie" />
            <input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="Cci (facultatif)" className={field} inputMode="email" aria-label="Copie cachée" />
          </div>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Objet" className={cn(field, "font-medium")} aria-label="Objet" />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
            }}
            rows={10}
            placeholder="Ton message…"
            aria-label="Message"
            className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2.5 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-faint focus:border-primary"
          />
          <AttachChips files={att.files} onRemove={att.remove} />
        </div>
        {ask ? (
          <KeepDraftBar onKeep={onClose} onDiscard={() => { writeDraft(NEW_KEY, null); onClose(); }} />
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-5 py-3 text-[12px] text-muted-foreground">
            <AttachButton onFiles={(f) => void att.add(f)} total={att.total} label="Joindre un fichier" />
            <SignatureToggle on={sig} onChange={setSig} has={!!settings.signatureHtml} />
            <span className="text-faint max-sm:hidden">{settings.delaySec ? `Annulable ${settings.delaySec} s · ` : ""}⌘↵</span>
            <button type="button" onClick={send}
              className="ml-auto flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40">
              <Send className="h-4 w-4" /> Envoyer
            </button>
          </div>
        )}
      </div>
    </Overlay>
  );
}
