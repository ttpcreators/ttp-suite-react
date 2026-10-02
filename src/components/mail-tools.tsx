import { useEffect, useRef, useState } from "react";
import { Loader2, PenLine, Send, Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { useMailSettings } from "@/lib/useMailSettings";
import {
  BOX_LABEL, DELAYS, buildHtml, parseEmails, saveMailSettings, scheduleSend, sendErrorText, sendGmail,
  type MailBox, type OutAttachment,
} from "@/lib/mailSend";
import { useAttachments } from "@/lib/useAttachments";
import { AttachButton, AttachChips } from "@/components/mail-attach";
import { BoxChip, BoxPicker } from "@/components/mail-box-chip";
import { cleanSignature } from "@/lib/mailSignature";
import type { MailMessage } from "@/lib/creatorMail";

/*
 * Outils d'écriture des mails (agence) : réglages (signature collée, délai
 * d'annulation), zone de réponse avec copie, fenêtre de transfert.
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
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1 text-[14px] font-semibold text-foreground">Réglages des mails</span>
          <button type="button" onClick={onClose} aria-label="Fermer" className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-rowhover hover:text-foreground">
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
            <div className="flex flex-wrap gap-1">
              {DELAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDelay(d)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors",
                    delay === d ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {d === 0 ? "Aucun" : `${d} s`}
                </button>
              ))}
            </div>
          </section>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={onClose} className="h-9 rounded-lg px-3 text-[13px] text-muted-foreground hover:text-foreground">Annuler</button>
          <button type="button" onClick={() => void save()} disabled={saving} className="h-9 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40">
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Réponse dans le fil ─────────────────────────────────────────────────────
export function ReplyBox({
  placeholder, box, focusKey, onSend,
}: {
  placeholder: string; box: MailBox; focusKey?: number;
  /** Appelé au moment de l'envoi réel (après le délai d'annulation). */
  onSend: (p: { text: string; cc: string[]; bcc: string[]; html: string; attachments: OutAttachment[] }) => Promise<boolean>;
}) {
  const settings = useMailSettings();
  const [text, setText] = useState("");
  const [ccOpen, setCcOpen] = useState(false);
  const [cc, setCc] = useState("");
  const [bccOpen, setBccOpen] = useState(false);
  const [bcc, setBcc] = useState("");
  const att = useAttachments();
  const [sig, setSig] = useState(settings.signatureOn);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setSig(settings.signatureOn), [settings.signatureOn]);
  useEffect(() => {
    if (focusKey) ref.current?.focus();
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
    setText("");
    setCc("");
    setCcOpen(false);
    setBcc("");
    setBccOpen(false);
    att.clear();
    scheduleSend(`Réponse depuis ${BOX_LABEL[box]}`, settings.delaySec, async () => {
      const done = await onSend({ text: body, cc: copy.ok, bcc: hidden.ok, html, attachments: files });
      if (!done) {
        // échec : on rend le texte et les fichiers pour réessayer
        setText((t) => t || body);
        att.setFiles((cur) => (cur.length ? cur : files));
      }
    });
  };

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
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
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
        <AttachButton onFiles={(f) => void att.add(f)} />
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

export function ForwardDialog({
  message, subject, defaultBox, sourceBox, onClose,
}: {
  message: MailMessage | null; subject: string; defaultBox: MailBox;
  /** Boîte où se trouve le mail d'origine (pour en joindre les pièces jointes). */
  sourceBox?: MailBox;
  onClose: () => void;
}) {
  const settings = useMailSettings();
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [keepOriginal, setKeepOriginal] = useState(true);
  const att = useAttachments();
  const [note, setNote] = useState("");
  const [box, setBox] = useState<MailBox>(defaultBox);
  const [sig, setSig] = useState(settings.signatureOn);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!message) return;
    setTo("");
    setCc("");
    setBcc("");
    setKeepOriginal(true);
    att.clear();
    setNote("");
    setBox(defaultBox);
    setSig(settings.signatureOn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  if (!message) return null;
  // Les pièces jointes d'origine ne sont jointes que si on connaît la boîte du mail.
  const canKeep = !!sourceBox && message.attachments.length > 0;
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
    setBusy(true);
    const forward = withOriginal ? { box: sourceBox ?? box, messageId: message.id } : undefined;
    const files = att.files;
    scheduleSend(`Transfert à ${dest.ok[0]}`, settings.delaySec, async () => {
      const r = await sendGmail({ to: dest.ok[0], cc: copy.ok, bcc: hidden.ok, subject: fwdSubject, html, box, source: "manual", attachments: files, forward });
      toast(r.ok ? "Mail transféré ✓" : sendErrorText(r.error));
    });
    setBusy(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <PenLine className="h-4 w-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">{fwdSubject}</span>
          <button type="button" onClick={onClose} aria-label="Fermer" className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-rowhover hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-2.5 overflow-y-auto px-5 py-4">
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="À : adresse@exemple.com" className={field} autoFocus inputMode="email" />
          <div className="grid gap-2.5 sm:grid-cols-2">
            <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Cc (facultatif)" className={field} inputMode="email" />
            <input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="Cci (facultatif)" className={field} inputMode="email" />
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder="Ajoute un mot (facultatif)…"
            className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-faint focus:border-primary"
          />
          <div className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-[12px] text-muted-foreground">
            Message transféré : <span className="font-medium text-foreground">{message.from}</span>, {new Date(message.ts).toLocaleDateString("fr-FR")}
            {canKeep ? (
              <label className="mt-1.5 flex cursor-pointer select-none items-center gap-1.5">
                <input type="checkbox" checked={keepOriginal} onChange={(e) => setKeepOriginal(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-primary)]" />
                Joindre ses pièces jointes ({message.attachments.map((a) => a.filename).join(", ")})
              </label>
            ) : message.attachments.length > 0 ? (
              <span className="block text-faint">Les pièces jointes d'origine ne sont pas transférées.</span>
            ) : null}
          </div>
          <AttachChips files={att.files} onRemove={att.remove} />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-3">
          <BoxPicker value={box} onChange={setBox} />
          <AttachButton onFiles={(f) => void att.add(f)} className="text-[12px] text-muted-foreground" />
          <SignatureToggle on={sig} onChange={setSig} has={!!settings.signatureHtml} />
          <button type="button" onClick={send} disabled={busy}
            className="ml-auto flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Transférer
          </button>
        </div>
      </div>
    </div>
  );
}
