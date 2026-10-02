import { useEffect, useMemo, useRef, useState } from "react";
import { X, Send, Loader2, Settings2, Plus, Trash2, ArrowLeft, ExternalLink } from "lucide-react";
import { cn, initials, titleCase } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import {
  BOX_LABEL, buildHtml, parseEmails, readMailSettings, scheduleSend, sendErrorText, sendGmail, type MailBox,
} from "@/lib/mailSend";
import {
  DEFAULT_TEMPLATES,
  KIND_LABEL,
  TEMPLATE_VARS,
  renderTemplate,
  suggestedKind,
  mailtoHref,
  readProspectTemplates,
  mergeTemplateEdits,
  PROSPECT_TEMPLATES_KEY,
  type MailTemplate,
  type MailTemplateKind,
  type TemplateContact,
} from "@/lib/mailTemplates";

/**
 * Composeur de mails de prospection : choisit un modèle (prospection /
 * relance), résout les variables pour le contact ({{destinataire}} = prénom
 * sinon marque), laisse tout éditer, puis envoie via Gmail (gmail-send).
 * Inclut le gestionnaire de modèles (CRUD, stocké en app state).
 *
 * `contact` null → ouvre directement le gestionnaire de modèles seul.
 */

export type ComposerContact = TemplateContact & {
  email: string;
  label: string;
  hasBeenContacted: boolean;
};

type Props = {
  open: boolean;
  contact: ComposerContact | null;
  onClose: () => void;
  /** Appelé après un envoi réussi (pour journaliser la touche côté page). */
  /** Appelé après envoi. `gmailId` = id du message Gmail (envoi via Gmail) : la touche
   *  prend l'id « gm<id> », le même que le scan horaire → jamais comptée deux fois. */
  onSent?: (gmailId?: string) => void;
  /** Boîte d'envoi proposée par défaut (la page Mails transmet la boîte affichée). */
  defaultBox?: MailBox;
};

export function MailComposer({ open, contact, onClose, onSent, defaultBox = "partnerships" }: Props) {
  const { data: stored } = useAppState<MailTemplate[] | undefined>(
    (s: AppState) => readProspectTemplates(s),
  );
  // Après une sauvegarde, la liste enregistrée s'affiche tout de suite (sans
  // attendre le prochain tick live) ; elle cède dès que la donnée live change.
  const [saved, setSaved] = useState<{ from: unknown; list: MailTemplate[] } | null>(null);
  const templates = useMemo<MailTemplate[]>(() => {
    if (saved && saved.from === stored) return saved.list;
    return Array.isArray(stored) && stored.length > 0 ? stored : DEFAULT_TEMPLATES;
  }, [stored, saved]);

  const [manage, setManage] = useState(false);
  const [tplId, setTplId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [box, setBox] = useState<MailBox>(defaultBox);
  const [cc, setCc] = useState("");
  const { data: mailSettings } = useAppState((s: AppState) => readMailSettings(s));
  const [withSig, setWithSig] = useState(true);

  // Gestionnaire : copie de travail éditable.
  const [draftList, setDraftList] = useState<MailTemplate[]>(templates);
  // Liste de référence à l'ouverture du gestionnaire : sert à distinguer, à la
  // sauvegarde, ce qui a été modifié/supprimé ICI de ce qui a bougé ailleurs.
  const baseListRef = useRef<MailTemplate[]>(templates);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // À l'ouverture : présélectionne le modèle suggéré (relance si déjà touché).
  useEffect(() => {
    if (!open) return;
    setManage(contact === null);
    setBox(defaultBox);
    setCc("");
    setWithSig(mailSettings?.signatureOn ?? true);
    setDraftList(templates);
    baseListRef.current = templates;
    setEditId(null);
    if (!contact) return;
    const kind = suggestedKind(contact.hasBeenContacted);
    const tpl = templates.find((t) => t.kind === kind) ?? templates[0] ?? null;
    applyTemplate(tpl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const applyTemplate = (tpl: MailTemplate | null) => {
    setTplId(tpl?.id ?? null);
    if (!tpl || !contact) {
      if (!tpl) {
        setSubject("");
        setBody("");
      }
      return;
    }
    setSubject(renderTemplate(tpl.subject, contact));
    setBody(renderTemplate(tpl.body, contact));
  };

  const send = () => {
    if (!contact || sending) return;
    if (!subject.trim() || !body.trim()) {
      toast("Objet et message requis");
      return;
    }
    const copy = parseEmails(cc);
    if (copy.bad.length) {
      toast(`Adresse en copie invalide : ${copy.bad[0]}`);
      return;
    }
    const settings = mailSettings ?? readMailSettings({} as AppState);
    const html = buildHtml(body, { signature: withSig ? settings.signatureHtml : "" });
    const params = { to: contact.email, cc: copy.ok, subject: subject.trim(), html, source: "prospection", contactName: contact.label, box };
    // Délai d'annulation : le mail part après N s (barre « Annuler » en bas de l'écran).
    scheduleSend(`Mail à ${contact.label}`, settings.delaySec, async () => {
      setSending(true);
      const res = await sendGmail(params);
      setSending(false);
      if (!res.ok) {
        toast(sendErrorText(res.error));
        return;
      }
      toast("Mail envoyé ✓");
      onSent?.(res.id);
    });
    onClose();
  };

  // Ouvre le mail pré-rempli dans l'app mail par défaut (Spark) via mailto:
  // — même journalisation de la prise de contact que l'ancien bouton mail.
  const openInMailApp = () => {
    if (!contact) return;
    const url = mailtoHref(contact.email, subject.trim(), body.trim());
    window.open(url, "_self");
    toast("Ouvert dans ton app mail ✓");
    onSent?.();
    onClose();
  };

  // ── Gestionnaire de modèles ──
  const editing = draftList.find((t) => t.id === editId) ?? null;
  const patchEditing = (patch: Partial<MailTemplate>) => {
    if (!editId) return;
    setDraftList((list) => list.map((t) => (t.id === editId ? { ...t, ...patch } : t)));
  };
  const addTemplate = () => {
    const t: MailTemplate = {
      id: `tpl-${Date.now().toString(36)}`,
      name: "Nouveau modèle",
      kind: "prospection",
      subject: "",
      body: "Bonjour {{destinataire}},\n\n",
    };
    setDraftList((list) => [...list, t]);
    setEditId(t.id);
  };
  const removeTemplate = (id: string) => {
    setDraftList((list) => list.filter((t) => t.id !== id));
    if (editId === id) setEditId(null);
  };
  const insertVar = (token: string) => {
    if (!editId) return;
    const el = bodyRef.current;
    const current = editing?.body ?? "";
    if (!el) {
      patchEditing({ body: current + token });
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    patchEditing({ body: current.slice(0, start) + token + current.slice(end) });
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  };
  const saveTemplates = async () => {
    const cleaned = draftList.filter((t) => t.name.trim());
    if (cleaned.length === 0) {
      toast("Garde au moins un modèle");
      return;
    }
    if (saving) return;
    setSaving(true);
    let ok = false;
    let merged: MailTemplate[] = cleaned;
    try {
      // Relit l'état frais puis fusionne (par id, suppressions explicites) au
      // lieu d'écraser à l'aveugle avec l'instantané local.
      invalidateAppState();
      const freshState = await getAppState();
      const fresh = readProspectTemplates(freshState);
      const freshList = Array.isArray(fresh) && fresh.length > 0 ? fresh : DEFAULT_TEMPLATES;
      merged = mergeTemplateEdits(freshList, baseListRef.current, cleaned);
      if (merged.length === 0) merged = cleaned;
      ok = await saveAppStateKey(PROSPECT_TEMPLATES_KEY, merged);
    } catch (e) {
      console.warn("[mailTemplates] relecture avant sauvegarde", e);
      ok = false;
    }
    setSaving(false);
    if (!ok) {
      toast("Sauvegarde échouée, réessaie");
      return;
    }
    baseListRef.current = merged;
    setDraftList(merged);
    setSaved({ from: stored, list: merged });
    toast("Modèles enregistrés ✓");
    if (contact) setManage(false);
    else onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
          {manage && contact && (
            <button
              type="button"
              onClick={() => setManage(false)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
              title="Retour au mail"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          {!manage && contact && (
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-panel text-[11px] font-bold text-foreground">
              {initials(contact.label)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">
              {manage ? "Modèles de mails" : `Écrire à ${titleCase(contact?.label ?? "")}`}
            </div>
            <div className="truncate text-[11px] text-faint">
              {manage ? "Variables : prénom si connu, sinon marque" : contact?.email}
            </div>
          </div>
          {!manage && (
            <button
              type="button"
              onClick={() => setManage(true)}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
            >
              <Settings2 className="h-3.5 w-3.5" /> Modèles
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!manage && contact ? (
          <>
            {/* Choix du modèle */}
            <div className="flex flex-wrap gap-1.5 border-b border-border px-5 py-3">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors",
                    tplId === t.id
                      ? "bg-foreground text-background"
                      : "bg-panel text-muted-foreground hover:bg-rowhover hover:text-foreground",
                  )}
                  title={KIND_LABEL[t.kind]}
                >
                  {t.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => applyTemplate(null)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors",
                  tplId === null
                    ? "bg-foreground text-background"
                    : "bg-panel text-muted-foreground hover:bg-rowhover hover:text-foreground",
                )}
              >
                Page blanche
              </button>
            </div>

            {/* Mail éditable */}
            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {/* Boîte d'envoi : prospection (partnerships@) ou créatrices (talent@) */}
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <span>Envoyer depuis</span>
                <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
                  {(["partnerships", "talent"] as const).map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setBox(b)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
                        box === b ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {BOX_LABEL[b]}
                    </button>
                  ))}
                </div>
              </div>
              <input
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="Cc (facultatif) : adresse@exemple.com"
                inputMode="email"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Objet"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                placeholder="Ton message…"
                className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2.5 text-[13px] leading-relaxed outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
              <label className={cn("flex select-none items-center gap-1.5 text-[12px] text-muted-foreground", !mailSettings?.signatureHtml && "opacity-50")}>
                <input
                  type="checkbox"
                  checked={withSig && !!mailSettings?.signatureHtml}
                  disabled={!mailSettings?.signatureHtml}
                  onChange={(e) => setWithSig(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--color-primary)]"
                />
                {mailSettings?.signatureHtml ? "Ajouter ma signature" : "Signature : à coller dans Mails → Réglages"}
              </label>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={openInMailApp}
                  title="Ouvre le mail pré-rempli dans ton app mail par défaut"
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Ouvrir dans Spark
                </button>
                <button
                  type="button"
                  onClick={send}
                  disabled={sending || !subject.trim() || !body.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {sending ? "Envoi…" : "Envoyer via Gmail"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Gestionnaire de modèles */}
            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <div className="flex flex-col gap-1.5">
                {draftList.map((t) => (
                  <div
                    key={t.id}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border border-border px-3 py-2 transition-colors",
                      editId === t.id ? "border-primary/40 bg-primary/5" : "bg-panel hover:bg-rowhover",
                    )}
                  >
                    <button type="button" onClick={() => setEditId(editId === t.id ? null : t.id)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-[12px] font-semibold text-foreground">{t.name}</span>
                      <span className="text-[12px] text-muted-foreground">{KIND_LABEL[t.kind]}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeTemplate(t.id)}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-signal"
                      title="Supprimer ce modèle"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addTemplate}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" /> Nouveau modèle
              </button>

              {editing && (
                <div className="space-y-2.5 rounded-xl border border-border bg-panel p-3.5">
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_150px]">
                    <input
                      value={editing.name}
                      onChange={(e) => patchEditing({ name: e.target.value })}
                      placeholder="Nom du modèle"
                      className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                    />
                    <select
                      value={editing.kind}
                      onChange={(e) => patchEditing({ kind: e.target.value as MailTemplateKind })}
                      className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                    >
                      <option value="prospection">Prospection</option>
                      <option value="relance">Relance</option>
                    </select>
                  </div>
                  <input
                    value={editing.subject}
                    onChange={(e) => patchEditing({ subject: e.target.value })}
                    placeholder="Objet (variables acceptées)"
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                  />
                  <textarea
                    ref={bodyRef}
                    value={editing.body}
                    onChange={(e) => patchEditing({ body: e.target.value })}
                    rows={9}
                    className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2.5 text-[13px] leading-relaxed outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                  />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[12px] font-medium text-muted-foreground">Insérer :</span>
                    {TEMPLATE_VARS.map((v) => (
                      <button
                        key={v.token}
                        type="button"
                        onClick={() => insertVar(v.token)}
                        title={v.label}
                        className="rounded-full bg-surface px-2.5 py-1 text-[10px] font-semibold text-muted-foreground ring-1 ring-border transition-colors hover:text-foreground"
                      >
                        {v.token}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
              <p className="text-[10px] text-faint">
                {"{{destinataire}}"} devient le prénom du contact, ou la marque si le prénom est inconnu.
              </p>
              <button
                type="button"
                onClick={saveTemplates}
                disabled={saving}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {saving ? "Enregistrement…" : "Enregistrer les modèles"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
