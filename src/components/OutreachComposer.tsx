import { useState } from "react";
import { Spin } from "@/components/ui/loader";
import { Copy, ExternalLink, Mail, Send, X } from "lucide-react";
import { Overlay } from "@/components/mobile/ios-sheet";
import { Tabs } from "@/components/ui/animated-tabs";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { toast } from "@/components/ui/toast";
import { useAppState, type AppState } from "@/lib/appState";
import { BOX_LABEL, BOX_STYLE, buildHtml, parseEmails, readMailSettings, sendErrorText, sendGmail, type MailBox } from "@/lib/mailSend";
import { cn } from "@/lib/utils";

const IN = "rounded-lg border border-border bg-surface px-3 py-2 text-[12px] outline-none focus:border-primary";

/**
 * Premier contact depuis le Sourcing : un mail qui part VRAIMENT de ta boîte Gmail
 * (talent@ ou partnerships@, avec ta signature), ou un message Instagram (le texte
 * est copié et la conversation s'ouvre : Meta ne laisse pas une app écrire en
 * premier en message privé). `onSent` sert à noter le contact (Scouting, radar).
 */
export function OutreachComposer({ title, to: toInit, subject: subjectInit, body: bodyInit, box: boxInit, instagram, contactName, onSent, onClose }: {
  title: string;
  to?: string;
  subject: string;
  body: string;
  box: MailBox;
  /** @ Instagram : propose aussi le message privé. */
  instagram?: string;
  contactName?: string;
  onSent?: (via: "email" | "instagram") => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"email" | "instagram">(toInit || !instagram ? "email" : "instagram");
  const [box, setBox] = useState<MailBox>(boxInit);
  const [to, setTo] = useState(toInit ?? "");
  const [subject, setSubject] = useState(subjectInit);
  const [body, setBody] = useState(bodyInit);
  const [sending, setSending] = useState(false);
  const [dmOpened, setDmOpened] = useState(false);
  const { data: settings } = useAppState((s: AppState) => readMailSettings(s));
  const signature = settings?.signatureOn && settings.signatureHtml.trim() ? settings.signatureHtml : "";

  const send = async () => {
    const { ok, bad } = parseEmails(to);
    if (ok.length !== 1 || bad.length) return toast("Une seule adresse email valide");
    if (!subject.trim() || !body.trim()) return toast("Renseigne l'objet et le message");
    setSending(true);
    const r = await sendGmail({ to: ok[0], subject: subject.trim(), html: buildHtml(body, { signature: signature || undefined }), box, source: "sourcing", contactName });
    setSending(false);
    if (!r.ok) return toast(sendErrorText(r.error));
    toast(`Mail envoyé depuis ${BOX_LABEL[box]} ✓`);
    onSent?.("email");
    onClose();
  };
  const openDm = async () => {
    try {
      await navigator.clipboard?.writeText(body);
      toast("Message copié : colle-le dans la conversation");
    } catch {
      toast("Copie impossible : sélectionne le texte à la main");
    }
    window.open(`https://ig.me/m/${encodeURIComponent(instagram ?? "")}`, "_blank", "noopener");
    setDmOpened(true);
  };

  return (
    <Overlay className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClose={onClose} label={title}>
      <div className="my-auto w-full max-w-lg rounded-2xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-[15px] font-semibold text-foreground">{title}</div>
          <button type="button" onClick={onClose} className="text-faint transition-colors hover:text-foreground" aria-label="Fermer"><X className="h-5 w-5" /></button>
        </div>

        {instagram && (
          <Tabs
            size="sm"
            className="mb-3"
            label="Comment contacter"
            value={mode}
            onValueChange={(v) => setMode(v === "instagram" ? "instagram" : "email")}
            items={[
              { value: "email", label: "Mail", icon: <Mail className="h-3.5 w-3.5" /> },
              { value: "instagram", label: "Message Instagram", icon: <PlatformIcon platform="instagram" className="h-3.5 w-3.5" /> },
            ]}
          />
        )}

        {mode === "email" ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              Envoyer depuis
              {(["talent", "partnerships"] as MailBox[]).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBox(b)}
                  className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors", box === b ? BOX_STYLE[b].chip : "bg-panel text-muted-foreground hover:bg-rowhover")}
                >
                  {BOX_LABEL[b]}
                </button>
              ))}
            </div>
            <input aria-label="Destinataire" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Email (absent de sa bio et de son lien : à trouver)" className={IN} />
            <input aria-label="Objet" value={subject} onChange={(e) => setSubject(e.target.value)} className={IN} />
            <textarea aria-label="Message" value={body} onChange={(e) => setBody(e.target.value)} rows={10} className={cn(IN, "resize-y text-[13px] leading-relaxed")} />
            <div className="text-[11px] text-faint">{signature ? "Ta signature mail sera ajoutée en dessous." : "Pas de signature enregistrée (Mails → réglages)."} Le mail part de ta vraie boîte Gmail.</div>
            <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
              <button type="button" onClick={() => { void navigator.clipboard?.writeText(`${subject}\n\n${body}`); toast("Mail copié ✓"); }} className="flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover">
                <Copy className="h-3.5 w-3.5" /> Copier
              </button>
              <button type="button" onClick={() => void send()} disabled={sending} className="flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                {sending ? <Spin size={14} /> : <Send className="h-3.5 w-3.5" />} Envoyer
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <textarea aria-label="Message Instagram" value={body} onChange={(e) => setBody(e.target.value)} rows={8} className={cn(IN, "resize-y text-[13px] leading-relaxed")} />
            <div className="text-[11px] leading-snug text-faint">
              Instagram ne laisse pas une app écrire en premier : le message est copié, la conversation avec @{instagram} s'ouvre, tu colles et tu envoies.
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
              {dmOpened && (
                <button type="button" onClick={() => { onSent?.("instagram"); onClose(); }} className="rounded-full border border-border px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover">
                  C'est envoyé : noter le contact
                </button>
              )}
              <button type="button" onClick={() => void openDm()} className="flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90">
                <ExternalLink className="h-3.5 w-3.5" /> Copier et ouvrir Instagram
              </button>
            </div>
          </div>
        )}
      </div>
    </Overlay>
  );
}
