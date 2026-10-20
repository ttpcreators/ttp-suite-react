import { useEffect, useState } from "react";
import { Send, X, ExternalLink, BellRing } from "@/components/icons";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { Overlay } from "@/components/mobile/ios-sheet";
import { BoxPicker } from "@/components/mail-box-chip";
import { useMailSettings } from "@/lib/useMailSettings";
import { buildHtml, parseEmails, scheduleSend, sendErrorText, sendGmail, type MailBox } from "@/lib/mailSend";
import { mailtoHref } from "@/lib/mailTemplates";
import { findBrandContact, relanceDraft, rowName, type ContractRow } from "@/lib/contractRegistry";
import { creatorEmail, loadBrandContacts } from "@/lib/contractRegistryDb";

/*
 * « Relancer » un contrat en attente de signature. Réutilise l'envoi de mails de l'app
 * (gmail-send via sendGmail, délai « Annuler l'envoi », signature des réglages Mails) ;
 * « Ouvrir dans mon app mail » passe par un lien mailto: prérempli.
 * Destinataire proposé : le contact de la marque (page Contacts) ou, pour la
 * représentation, l'e-mail du créateur (sa fiche).
 */

const field = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-faint focus:border-primary";

export function ContractRelanceDialog({ row, onClose }: { row: ContractRow; onClose: () => void }) {
  const settings = useMailSettings();
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(() => relanceDraft(row).subject);
  const [body, setBody] = useState(() => relanceDraft(row).body);
  const [box, setBox] = useState<MailBox>(row.type === "repr" ? "talent" : "partnerships");
  const [looking, setLooking] = useState(true);
  const [found, setFound] = useState<string>("");

  // Destinataire : cherché une fois à l'ouverture, sans écraser ce que l'on a déjà tapé.
  useEffect(() => {
    let alive = true;
    // Prénom connu : salutation personnalisée, seulement si le texte n'a pas encore été retouché.
    const greet = (first: string) => {
      const base = relanceDraft(row).body;
      setBody((b) => (b === base ? relanceDraft(row, first).body : b));
    };
    void (async () => {
      try {
        if (row.type === "repr") {
          const email = row.creator ? await creatorEmail(row.creator) : "";
          if (!alive) return;
          if (row.creatorLabel !== "Externe") greet(row.creatorLabel.split(/\s+/)[0]);
          if (email) {
            setTo((t) => t || email);
            setFound(`Fiche de ${row.creatorLabel}`);
          }
        } else {
          const c = findBrandContact(await loadBrandContacts(), row.brand);
          if (!alive) return;
          if (c?.email) {
            setTo((t) => t || (c.email ?? ""));
            setFound(`Contact ${row.brand}${c.person ? ` : ${c.person}` : ""}`);
            if (c.first_name) greet(c.first_name);
          }
        }
      } finally {
        if (alive) setLooking(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [row]);

  const send = () => {
    const dest = parseEmails(to);
    if (dest.ok.length !== 1 || dest.bad.length) return toast("Indique une adresse de destinataire valide");
    if (!subject.trim() || !body.trim()) return toast("Objet et message requis");
    const html = buildHtml(body, { signature: settings.signatureOn ? settings.signatureHtml : "" });
    const label = `Relance ${rowName(row)}`;
    const params = { to: dest.ok[0], subject: subject.trim(), html, box, source: "manual", contactName: row.type === "repr" ? row.creatorLabel : row.brand };
    scheduleSend(label, settings.delaySec, async () => {
      const r = await sendGmail(params, { label });
      toast(r.ok ? "Relance envoyée ✓" : sendErrorText(r.error));
    });
    onClose();
  };

  const openInMailApp = () => {
    window.open(mailtoHref(to.trim(), subject.trim(), body.trim()), "_self");
    onClose();
  };

  return (
    <Overlay className="fixed inset-0 z-[120] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClose={onClose} label="Relancer">
      <div className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <BellRing className="h-4 w-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">Relancer · {rowName(row)}</span>
          <button type="button" onClick={onClose} aria-label="Fermer" className="grid h-8 w-8 place-items-center rounded-full text-faint hover:bg-rowhover hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-2.5 overflow-y-auto px-5 py-4">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            <span>Envoyer depuis</span>
            <BoxPicker value={box} onChange={setBox} />
          </div>
          <div>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="À : adresse@exemple.com" className={field} inputMode="email" aria-label="Destinataire" />
            <p className="mt-1 text-[11.5px] text-faint">
              {looking ? "Recherche du contact…" : found ? `Adresse trouvée : ${found}` : row.type === "repr" ? "Aucun e-mail sur la fiche du créateur : saisis l'adresse." : `Aucun contact avec e-mail pour ${row.brand || "cette marque"} dans Contacts : saisis l'adresse.`}
            </p>
          </div>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Objet" className={cn(field, "font-medium")} aria-label="Objet" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} aria-label="Message" className={cn(field, "resize-y py-2.5 leading-relaxed")} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={openInMailApp} className="flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-rowhover">
            <ExternalLink className="h-3.5 w-3.5" /> Ouvrir dans mon app mail
          </button>
          <span className="text-[11.5px] text-faint max-sm:hidden">{settings.delaySec ? `Annulable ${settings.delaySec} s` : ""}</span>
          <button type="button" onClick={send} className="ml-auto flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90">
            <Send className="h-4 w-4" /> Envoyer
          </button>
        </div>
      </div>
    </Overlay>
  );
}
