import { useEffect, useRef, useState } from "react";
import { Upload, FileText, ExternalLink, Trash2, Image as ImageIcon, Link2, Mail, X, Send, Pencil, Plus, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { dbInsert, dbDelete } from "@/lib/db";
import { notifyCreator } from "@/lib/push";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { useCreators } from "@/lib/useCreators";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { cn, titleCase } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { RecipientPicker } from "@/components/ui/recipient-picker";
import { SignaturePicker } from "@/components/ui/signature-picker";
import { renderSignatureHtml, type MailSignature } from "@/lib/useMailSignatures";
import { MediakitEditor } from "@/views/MediakitEditor";
import { AgencyTab } from "@/views/MediakitAgence";
import { useNavSub } from "@/lib/navSub";

/**
 * Media kit = bibliothèque de fichiers. L'agence dépose les media kits qu'elle a
 * créés, rangés PAR CRÉATEUR et PAR MOIS, visibles par le créateur (bucket privé
 * `documents`, type "mediakit"). Deux modes de dépôt :
 *  - UPLOAD : petit fichier (PDF/image) stocké dans Supabase.
 *  - LIEN : gros fichier hébergé ailleurs (Drive/Canva…) → on stocke juste l'URL
 *           (zéro stockage/egress Supabase). Le `path` contient alors l'URL http.
 * Envoi possible par mail (fonction serveur Resend) avec un lien de partage.
 */

type ArchiveRow = {
  id: string;
  creator: string | null;
  name: string;
  type: string | null;
  size: string | null;
  path: string;
  created_at: string | null;
};

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp";
const MAX_MB = 25;
const isLink = (p: string) => /^https?:\/\//i.test(p);

/** Template d'email — corps HTML léger avec variables {{creator}} {{lien}} {{message}}. */
type MailTemplate = { id: string; name: string; subject: string; body: string };
const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
const DEFAULT_TEMPLATES: MailTemplate[] = [
  {
    id: "tpl-presentation",
    name: "Présentation créateur",
    subject: "Media kit — {{creator}} · TTP Creators",
    body: "Bonjour,\n\nJe vous partage le media kit de {{creator}}, créateur représenté par TTP Creators.\n{{message}}\nVous y trouverez son audience, ses formats et ses tarifs.\n\nBien à vous,\nTTP Creators",
  },
  {
    id: "tpl-relance",
    name: "Relance",
    subject: "Toujours dispo pour une collab avec {{creator}} ?",
    body: "Bonjour,\n\nJe reviens vers vous concernant {{creator}}. {{message}}\nVoici son media kit à jour si besoin.\n\nBelle journée,\nTTP Creators",
  },
];
/** Rend un template en remplaçant les variables (message : sauts de ligne → <br>). */
function renderTemplate(tpl: MailTemplate, vars: { creator: string; lien: string; message: string }) {
  const sub = tpl.subject.replace(/\{\{creator\}\}/g, vars.creator);
  const btn = `<p style="margin:14px 0"><a href="${vars.lien}" style="color:#0069FE;text-decoration:underline;font-weight:600">Ouvrir le media kit →</a></p>`;
  let text = tpl.body
    .replace(/\{\{creator\}\}/g, escapeHtml(vars.creator))
    .replace(/\{\{message\}\}/g, vars.message ? escapeHtml(vars.message) + "\n" : "");
  const withLink = text.includes("{{lien}}");
  text = text.replace(/\{\{lien\}\}/g, "");
  const html = `<div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:560px;white-space:pre-line;font-size:14px;line-height:1.55">${text}${withLink ? "" : btn}</div>`;
  return { subject: sub, html: withLink ? html.replace("</div>", btn + "</div>") : html };
}

function monthKey(iso: string | null): string {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : "?";
}
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const s = new Date(y, (m || 1) - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function MediakitFiles() {
  const creators = useCreators();
  const [selected, setSelected] = useState<string>("");
  const [archives, setArchives] = useState<ArchiveRow[] | null>(null);
  const [filterMonth, setFilterMonth] = useState("all");
  const [uploading, setUploading] = useState(false);
  const [del, setDel] = useState<ArchiveRow | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Modales : ajout par lien + envoi par mail
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [sendRow, setSendRow] = useState<ArchiveRow | null>(null);
  const [sendRecipients, setSendRecipients] = useState<string[]>([]);
  const [sendSubject, setSendSubject] = useState("");
  const [sendMsg, setSendMsg] = useState("");
  const [sendSig, setSendSig] = useState<MailSignature | null>(null);
  const [sending, setSending] = useState(false);

  // Templates de mail (blob agence `mailTemplates`)
  const { data: tplData } = useAppState<MailTemplate[]>((s: AppState) => (s["mailTemplates"] as MailTemplate[]) ?? []);
  const templates = tplData && tplData.length > 0 ? tplData : DEFAULT_TEMPLATES;
  const [tplId, setTplId] = useState<string>("");
  const activeTpl = templates.find((t) => t.id === tplId) ?? templates[0];
  const [tplMgr, setTplMgr] = useState(false);
  const [tplDraft, setTplDraft] = useState<MailTemplate | null>(null);

  // Contacts (pour ajouter des destinataires groupés)
  const [contacts, setContacts] = useState<{ email: string; label: string; tag?: string }[]>([]);
  useEffect(() => {
    supabase
      .from("contacts")
      .select("*")
      .then(({ data }) => {
        const rows = (data as Record<string, unknown>[]) ?? [];
        setContacts(
          rows
            .map((r) => {
              const person = [r.first_name, r.last_name].filter(Boolean).join(" ") || String(r.person ?? "");
              const label = [String(r.brand ?? ""), person].filter((x) => x && x !== "—").join(" · ") || String(r.email ?? "");
              return { email: String(r.email ?? "").trim(), label, tag: String(r.tag ?? "").trim() };
            })
            .filter((c) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)),
        );
      });
  }, []);

  // Upsert/suppression d'un template sur l'état FRAIS (préserve les templates
  // créés/modifiés depuis un autre poste — pas de merge jeté).
  const upsertTemplate = async (tpl: MailTemplate): Promise<boolean> => {
    invalidateAppState();
    const fresh = ((await getAppState())["mailTemplates"] as MailTemplate[]) ?? [];
    const base = fresh.length ? fresh : DEFAULT_TEMPLATES;
    const next = base.some((t) => t.id === tpl.id) ? base.map((t) => (t.id === tpl.id ? tpl : t)) : [...base, tpl];
    const ok = await saveAppStateKey("mailTemplates", next);
    if (!ok) toast("Template non enregistré — réessaie");
    return ok;
  };
  const removeTemplate = async (id: string): Promise<boolean> => {
    invalidateAppState();
    const fresh = ((await getAppState())["mailTemplates"] as MailTemplate[]) ?? [];
    const base = fresh.length ? fresh : DEFAULT_TEMPLATES;
    const next = base.filter((t) => t.id !== id);
    const ok = await saveAppStateKey("mailTemplates", next.length ? next : DEFAULT_TEMPLATES);
    if (!ok) toast("Template non enregistré — réessaie");
    return ok;
  };

  useEffect(() => {
    let alive = true;
    supabase
      .from("documents")
      .select("id,creator,name,type,size,path,created_at")
      .eq("type", "mediakit")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!alive) return;
        setArchives(error ? [] : ((data as ArchiveRow[]) ?? []));
      });
    return () => {
      alive = false;
    };
  }, []);

  const monthName = () => new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  const upload = async (file: File) => {
    if (!selected) return toast("Choisis d'abord un créateur");
    if (file.size > MAX_MB * 1024 * 1024) return toast(`Fichier trop lourd (max ${MAX_MB} Mo) — passe par « Ajouter par lien »`);
    setUploading(true);
    try {
      const ext = (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? "pdf").toLowerCase();
      const slug = selected.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const path = `mediakits/${slug}-${Date.now()}.${ext}`;
      const up = await supabase.storage.from("documents").upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (up.error) return toast("Échec de l'upload — réessaie");
      await addRow(path, `${Math.max(1, Math.round(file.size / 1024))} Ko`);
    } finally {
      setUploading(false);
    }
  };

  const addLink = async () => {
    if (!selected) return toast("Choisis d'abord un créateur");
    const url = linkUrl.trim();
    if (!isLink(url)) return toast("Lien invalide (doit commencer par https://)");
    await addRow(url, "Lien");
    setLinkOpen(false);
    setLinkUrl("");
  };

  const addRow = async (path: string, size: string) => {
    const row = {
      creator: selected,
      name: `Media kit — ${titleCase(selected)} — ${monthName()}`,
      type: "mediakit",
      size,
      path,
      sort_order: 0,
    };
    const created = await dbInsert("documents", row);
    if (!created) return toast("Erreur — réessaie");
    setArchives((prev) => [created as unknown as ArchiveRow, ...(prev ?? [])]);
    if (selected) notifyCreator("mediakit", selected, row.name); // push au créateur
    toast("Media kit ajouté ✓ — visible par le créateur");
  };

  /** URL ouvrable : lien direct, ou URL signée pour un fichier stocké (durée en secondes). */
  const resolveUrl = async (row: ArchiveRow, seconds: number): Promise<string | null> => {
    if (isLink(row.path)) return row.path;
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(row.path, seconds);
    return error || !data?.signedUrl ? null : data.signedUrl;
  };

  const open = async (row: ArchiveRow) => {
    const url = await resolveUrl(row, 3600);
    if (!url) return toast("Lien indisponible — réessaie");
    window.open(url, "_blank");
  };

  const remove = async (row: ArchiveRow) => {
    if (!(await dbDelete("documents", row.id))) return toast("Erreur — réessaie");
    if (!isLink(row.path)) await supabase.storage.from("documents").remove([row.path]).catch(() => {});
    setArchives((prev) => (prev ?? []).filter((x) => x.id !== row.id));
    toast("Media kit supprimé");
  };

  // Objet par défaut d'un envoi = sujet du template avec {{creator}} résolu.
  const subjectFor = (row: ArchiveRow, tpl: MailTemplate | undefined) =>
    (tpl?.subject ?? "").replace(/\{\{creator\}\}/g, titleCase(row.creator ?? ""));

  const openSend = (row: ArchiveRow) => {
    setSendRow(row);
    setSendRecipients([]);
    setSendSubject(subjectFor(row, activeTpl));
    setSendMsg("");
    setSendSig(null);
  };

  const sendEmail = async () => {
    if (!sendRow || sending) return;
    const recipients = [...new Set(sendRecipients.map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
    if (recipients.length === 0) return toast("Ajoute au moins un destinataire");
    if (!activeTpl) return toast("Choisis un template");
    const subject = sendSubject.trim();
    if (!subject) return toast("Ajoute un objet");
    setSending(true);
    try {
      const link = await resolveUrl(sendRow, 60 * 60 * 24 * 7); // lien valable 7 jours
      if (!link) return toast("Lien indisponible — réessaie");
      const who = titleCase(sendRow.creator ?? "");
      const { html } = renderTemplate(activeTpl, { creator: who, lien: link, message: sendMsg.trim() });
      const finalHtml = sendSig ? html + renderSignatureHtml(sendSig) : html;
      const { data, error } = await supabase.functions.invoke("send-email", { body: { to: recipients, subject, html: finalHtml, source: "mediakit" } });
      let res = data as { ok?: boolean; sent?: number; total?: number; detail?: string } | null;
      if (error && (error as { context?: { json?: () => Promise<unknown> } }).context?.json)
        res = (await (error as { context: { json: () => Promise<unknown> } }).context.json().catch(() => null)) as typeof res;
      if (!res?.ok) {
        const d = (res?.detail ?? "").toLowerCase();
        if (d.includes("domain") || d.includes("verif") || d.includes("testing"))
          toast("Domaine non vérifié dans Resend — envoi possible seulement à ton adresse pour l'instant.");
        else toast(res?.detail ? `Échec : ${res.detail}` : "Envoi échoué — réessaie");
        return;
      }
      toast(`Envoyé ✓ (${res.sent}/${res.total} destinataire${(res.total ?? 0) > 1 ? "s" : ""})`);
      setSendRow(null);
      setSendRecipients([]);
      setSendSubject("");
      setSendMsg("");
      setSendSig(null);
    } finally {
      setSending(false);
    }
  };

  const all = archives ?? [];
  const forCreator = selected ? all.filter((a) => (a.creator ?? "").toLowerCase() === selected.toLowerCase()) : all;
  const months = [...new Set(forCreator.map((a) => monthKey(a.created_at)))].filter((k) => k !== "?");
  const shown = forCreator.filter((a) => filterMonth === "all" || monthKey(a.created_at) === filterMonth);

  return (
    <div className="space-y-4">
      {/* Barre : créateur + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select
          value={selected}
          onValueChange={(v) => {
            setSelected(v);
            setFilterMonth("all");
          }}
        >
          <SelectTrigger className="h-10 w-auto min-w-[220px] rounded-xl bg-surface" placeholder="Tous les créateurs" />
          <SelectContent>
            <SelectItem index={0} value="">
              Tous les créateurs
            </SelectItem>
            {creators.map((c, i) => (
              <SelectItem key={c.id} index={i + 1} value={c.name}>
                {titleCase(c.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex flex-wrap items-center gap-2">
          {months.length > 0 && (
            <Select value={filterMonth} onValueChange={setFilterMonth}>
              <SelectTrigger className="h-10 w-auto min-w-[150px] rounded-xl bg-surface" placeholder="Tous les mois" />
              <SelectContent>
                <SelectItem index={0} value="all">
                  Tous les mois
                </SelectItem>
                {months.map((k, i) => (
                  <SelectItem key={k} index={i + 1} value={k}>
                    {monthLabel(k)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => (selected ? setLinkOpen(true) : toast("Choisis d'abord un créateur"))}
            className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
          >
            <Link2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Par lien</span>
          </button>
          <button
            type="button"
            onClick={() => (selected ? fileRef.current?.click() : toast("Choisis d'abord un créateur"))}
            disabled={uploading}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" /> {uploading ? "Ajout…" : "Ajouter"}
          </button>
        </div>
      </div>

      <p className="text-[11px] leading-snug text-faint">
        Petit fichier (PDF/image, max {MAX_MB} Mo) → <span className="font-medium text-foreground">Ajouter</span>. Gros fichier
        (vidéo, PDF lourd) → héberge-le sur Drive/Canva et colle son lien via <span className="font-medium text-foreground">Par lien</span>{" "}
        (zéro stockage). Tout est daté et visible par le créateur dans son espace.
      </p>

      {/* Liste */}
      {archives === null ? (
        <div className="rounded-2xl border border-border bg-surface px-4 py-6 text-sm text-muted-foreground shadow-sm">Chargement…</div>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center shadow-sm">
          <ImageIcon className="mx-auto h-8 w-8 text-faint" />
          <div className="mt-3 text-sm font-medium text-foreground">Aucun media kit{selected ? ` pour ${titleCase(selected)}` : ""}</div>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            {selected ? "Dépose le premier via « Ajouter » ou « Par lien »." : "Choisis un créateur puis dépose son media kit."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((row) => (
            <div key={row.id} className="flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo/15 text-indigo">
                  {isLink(row.path) ? <Link2 className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-foreground">{titleCase(row.creator ?? "—")}</div>
                  <div className="mt-0.5 text-[11px] text-faint">
                    {row.created_at ? new Date(row.created_at).toLocaleDateString("fr-FR") : "—"}
                    {row.size ? ` · ${row.size}` : ""}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => open(row)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Ouvrir
                </button>
                <button
                  type="button"
                  onClick={() => openSend(row)}
                  title="Envoyer par mail"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-primary"
                >
                  <Mail className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setDel(row)}
                  title="Supprimer"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-[#E5484D]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modale : ajout par lien */}
      {linkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setLinkOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm font-semibold">Ajouter un media kit par lien</div>
              <button type="button" onClick={() => setLinkOpen(false)} className="grid h-9 w-9 place-items-center rounded-lg text-faint hover:bg-rowhover hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-[11px] leading-snug text-faint">
              Colle le lien de partage (Google Drive, Canva, Dropbox…) pour {titleCase(selected)}. Idéal pour les gros fichiers.
            </p>
            <input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              autoFocus
              placeholder="https://drive.google.com/…"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setLinkOpen(false)} className="rounded-lg border border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-rowhover">
                Annuler
              </button>
              <button type="button" onClick={addLink} className="rounded-lg bg-primary px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground hover:opacity-90">
                Ajouter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale : envoi par mail (multi-destinataires + template) */}
      {sendRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSendRow(null)}>
          <div onClick={(e) => e.stopPropagation()} className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm font-semibold">Envoyer le media kit de {titleCase(sendRow.creator ?? "")}</div>
              <button type="button" onClick={() => setSendRow(null)} className="grid h-9 w-9 place-items-center rounded-lg text-faint hover:bg-rowhover hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {/* Destinataires : recherche dans les contacts + « tout le monde » + emails libres */}
              <div>
                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">Destinataires</div>
                <RecipientPicker value={sendRecipients} onChange={setSendRecipients} contacts={contacts} />
              </div>

              {/* Template */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Template</span>
                  <button
                    type="button"
                    onClick={() => {
                      setTplMgr(true);
                      setTplDraft(null);
                    }}
                    className="flex items-center gap-1 text-[10px] font-semibold text-primary transition-opacity hover:opacity-80"
                  >
                    <Pencil className="h-3 w-3" /> Gérer les templates
                  </button>
                </div>
                <Select
                  value={activeTpl?.id ?? ""}
                  onValueChange={(id) => {
                    setTplId(id);
                    const t = templates.find((x) => x.id === id);
                    if (t && sendRow) setSendSubject(subjectFor(sendRow, t));
                  }}
                >
                  <SelectTrigger className="h-10 w-full rounded-lg bg-surface" placeholder="Choisir un template" />
                  <SelectContent>
                    {templates.map((t, i) => (
                      <SelectItem key={t.id} index={i} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Objet (éditable, pré-rempli depuis le template) */}
              <div>
                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">Objet</div>
                <input
                  value={sendSubject}
                  onChange={(e) => setSendSubject(e.target.value)}
                  placeholder="Objet de l'email"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </div>

              {/* Message perso ({{message}}) */}
              <div>
                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">Message (remplace {"{{message}}"})</div>
                <textarea
                  value={sendMsg}
                  onChange={(e) => setSendMsg(e.target.value)}
                  rows={2}
                  placeholder="Un mot personnalisé (optionnel)…"
                  className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </div>

              {/* Signature image (optionnelle) */}
              <div>
                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">Signature</div>
                <SignaturePicker key={sendRow.id} value={sendSig} onChange={setSendSig} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setSendRow(null)} className="rounded-lg border border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-rowhover">
                Annuler
              </button>
              <button
                type="button"
                onClick={sendEmail}
                disabled={sending}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" /> {sending ? "Envoi…" : "Envoyer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale : gérer les templates de mail */}
      {tplMgr && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setTplMgr(false)}>
          <div onClick={(e) => e.stopPropagation()} className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm font-semibold">Templates de mail</div>
              <button type="button" onClick={() => setTplMgr(false)} className="grid h-9 w-9 place-items-center rounded-lg text-faint hover:bg-rowhover hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {tplDraft ? (
              <div className="flex flex-col gap-3">
                <div>
                  <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">Nom</div>
                  <input value={tplDraft.name} onChange={(e) => setTplDraft({ ...tplDraft, name: e.target.value })} className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
                </div>
                <div>
                  <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">Objet</div>
                  <input value={tplDraft.subject} onChange={(e) => setTplDraft({ ...tplDraft, subject: e.target.value })} className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
                </div>
                <div>
                  <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">Corps</div>
                  <textarea value={tplDraft.body} onChange={(e) => setTplDraft({ ...tplDraft, body: e.target.value })} rows={7} className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
                  <p className="mt-1 text-[10px] text-faint">Variables : <code>{"{{creator}}"}</code> (nom), <code>{"{{message}}"}</code> (ton mot), <code>{"{{lien}}"}</code> (bouton du media kit — ajouté auto en bas si absent).</p>
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setTplDraft(null)} className="rounded-lg border border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-rowhover">
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!tplDraft.name.trim() || !tplDraft.subject.trim()) return toast("Nom et objet requis");
                      if (!(await upsertTemplate(tplDraft))) return;
                      setTplId(tplDraft.id);
                      setTplDraft(null);
                      toast("Template enregistré ✓");
                    }}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground hover:opacity-90"
                  >
                    <Check className="h-3.5 w-3.5" /> Enregistrer
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {templates.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-foreground">{t.name}</div>
                      <div className="truncate text-[10px] text-faint">{t.subject}</div>
                    </div>
                    <button type="button" onClick={() => setTplDraft({ ...t })} title="Modifier" className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-rowhover hover:text-foreground">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (await removeTemplate(t.id)) toast("Template supprimé");
                      }}
                      title="Supprimer"
                      className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-rowhover hover:text-[#E5484D]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setTplDraft({ id: uid(), name: "", subject: "Media kit — {{creator}}", body: "Bonjour,\n\n{{message}}\n\n— TTP Creators" })}
                  className="mt-1 flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" /> Nouveau template
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {del && (
        <ConfirmDialog
          title="Supprimer le media kit"
          message={`Supprimer « ${del.name} » ? Le créateur ne le verra plus. Cette action est irréversible.`}
          confirmLabel="Supprimer"
          danger
          onCancel={() => setDel(null)}
          onConfirm={() => {
            remove(del);
            setDel(null);
          }}
        />
      )}
    </div>
  );
}

type MkTab = "creatrices" | "ugc" | "agence" | "files";

/**
 * Page « Media kit » UNIFIÉE = 3 onglets (fusion de l'ancienne « Media kit » et de
 * « Media kit agence », qui faisaient doublon sur l'éditeur par créatrice) :
 *  - CRÉATRICES : éditeur en ligne du media kit de chaque créatrice
 *                 (→ ttpcreators.pro/mediakit/<lien>, alimente aussi le deck agence).
 *  - AGENCE     : contenu de cadrage du deck agence (→ /mediakit/agence/).
 *  - FICHIERS   : bibliothèque des media kits déposés (PDF/liens) + envoi par mail.
 */
export function Mediakit() {
  const [tab, setTab] = useState<MkTab>("creatrices");
  // Sous-page demandée depuis la sidebar (Media kit → Créatrices / Agence / Fichiers).
  const sub = useNavSub();
  useEffect(() => {
    if (sub === "creatrices" || sub === "ugc" || sub === "agence" || sub === "files") setTab(sub);
  }, [sub]);
  const tabBtn = (id: MkTab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={cn(
        "rounded-lg px-4 py-2 transition-colors",
        tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl border border-border bg-surface p-1 text-[11px] font-semibold uppercase tracking-wide">
        {tabBtn("creatrices", "Créatrices")}
        {tabBtn("ugc", "UGC")}
        {tabBtn("agence", "Agence")}
        {tabBtn("files", "Fichiers")}
      </div>
      {tab === "creatrices" ? (
        <div>
          <p className="mb-3 text-xs text-muted-foreground">
            Édite le media kit de chaque créatrice ici — ça met à jour <strong>à la fois</strong> sa page perso
            <span className="text-faint"> (ttpcreators.pro/mediakit/&lt;lien&gt;)</span> et le deck agence.
          </p>
          <MediakitEditor />
        </div>
      ) : tab === "ugc" ? (
        <div>
          <p className="mb-3 text-xs text-muted-foreground">
            Media kit <strong>UGC</strong> — format orienté personne (personnalité, quotidien, matériel, portfolio),
            page séparée <span className="text-faint">(/mediakit/&lt;lien&gt;/ugc/)</span>. Choisis une créatrice puis active-le.
          </p>
          <MediakitEditor mode="ugc" />
        </div>
      ) : tab === "agence" ? (
        <AgencyTab />
      ) : (
        <MediakitFiles />
      )}
    </div>
  );
}

/** Échappe le texte utilisateur inséré dans le HTML de l'email. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
