import { useEffect, useMemo, useRef, useState } from "react";
import { X, Send, Loader2, Settings2, Plus, Trash2, ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, initials, titleCase } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { useAppState, saveAppStateKey, type AppState } from "@/lib/appState";
import {
  DEFAULT_TEMPLATES,
  KIND_LABEL,
  TEMPLATE_VARS,
  renderTemplate,
  suggestedKind,
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
  onSent?: () => void;
};

async function invokeJson<T>(fn: string, body: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error && (error as { context?: { json?: () => Promise<unknown> } }).context?.json)
    return (await (error as { context: { json: () => Promise<unknown> } }).context.json().catch(() => null)) as T | null;
  return (data as T) ?? null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
}

export function MailComposer({ open, contact, onClose, onSent }: Props) {
  const { data: stored } = useAppState<MailTemplate[] | undefined>(
    (s: AppState) => s["mailTemplates"] as MailTemplate[] | undefined,
  );
  const templates = useMemo<MailTemplate[]>(
    () => (Array.isArray(stored) && stored.length > 0 ? stored : DEFAULT_TEMPLATES),
    [stored],
  );

  const [manage, setManage] = useState(false);
  const [tplId, setTplId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  // Gestionnaire : copie de travail éditable.
  const [draftList, setDraftList] = useState<MailTemplate[]>(templates);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // À l'ouverture : présélectionne le modèle suggéré (relance si déjà touché).
  useEffect(() => {
    if (!open) return;
    setManage(contact === null);
    setDraftList(templates);
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

  const send = async () => {
    if (!contact || sending) return;
    if (!subject.trim() || !body.trim()) {
      toast("Objet et message requis");
      return;
    }
    setSending(true);
    const html = `<div style="font-family:system-ui,Arial,sans-serif;font-size:14px;line-height:1.6;white-space:pre-line">${escapeHtml(body.trim())}</div>`;
    const res = await invokeJson<{ ok?: boolean; error?: string }>("gmail-send", {
      to: contact.email,
      subject: subject.trim(),
      html,
      source: "prospection",
      contactName: contact.label,
    });
    setSending(false);
    if (!res?.ok) {
      toast(
        res?.error === "google_non_connecte" || res?.error === "gmail_scope_manquant"
          ? "Reconnecte Google (droits Gmail) dans l'app."
          : "Envoi échoué — réessaie",
      );
      return;
    }
    toast("Mail envoyé ✓");
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
    setSaving(true);
    const ok = await saveAppStateKey("mailTemplates", cleaned);
    setSaving(false);
    if (!ok) {
      toast("Sauvegarde échouée — réessaie");
      return;
    }
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
                      ? "bg-primary text-primary-foreground"
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
                    ? "bg-primary text-primary-foreground"
                    : "bg-panel text-muted-foreground hover:bg-rowhover hover:text-foreground",
                )}
              >
                Page blanche
              </button>
            </div>

            {/* Mail éditable */}
            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
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

            <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
              <p className="text-[10px] text-faint">Part depuis ta boîte Gmail · la prise de contact est notée toute seule.</p>
              <button
                type="button"
                onClick={send}
                disabled={sending || !subject.trim() || !body.trim()}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {sending ? "Envoi…" : "Envoyer"}
              </button>
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
                      <span className="text-[10px] uppercase tracking-wide text-faint">{KIND_LABEL[t.kind]}</span>
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
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">Insérer :</span>
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
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
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
