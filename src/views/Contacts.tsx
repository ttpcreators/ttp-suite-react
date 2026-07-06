import { supabase } from "@/lib/supabase";
import { Copy, X, Download, Upload, Trash2, Pencil, Mail, Send, ArrowDownLeft, ArrowUpRight, Paperclip } from "lucide-react";
import { ActionMenu, ConfirmDialog } from "@/components/ui/action-menu";
import { cn, initials } from "@/lib/utils";
import { useSearch, matchQuery } from "@/lib/search";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { dbInsert, dbUpdate, nextOrder } from "@/lib/db";
import { dbTrash } from "@/lib/trash";
import { toast } from "@/components/ui/toast";
import {
  AddButton,
  InlineForm,
  TextField,
  SelectField,
} from "@/components/ui/form";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";
import { RecipientPicker, type PickContact } from "@/components/ui/recipient-picker";
import { SignaturePicker } from "@/components/ui/signature-picker";
import { renderSignatureHtml, type MailSignature } from "@/lib/useMailSignatures";

type Row = {
  id: string;
  brand: string;
  person: string;
  first_name?: string | null;
  last_name?: string | null;
  role: string;
  tone: string;
  tag: string;
  email: string;
  phone: string;
  sort_order: number;
};

/** Un message Gmail de l'historique avec un contact. */
type MailMsg = { id: string; from: string; to?: string; subject: string; date: string; snippet: string; direction: "in" | "out" };

/** En-tête Date Gmail (RFC 2822) → "06 juil." (ou "" si illisible). */
function fmtMailDate(d: string): string {
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? "" : t.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

/** Pièce jointe d'un email (contenu en base64). */
type Att = { filename: string; mimeType: string; contentBase64: string; size: number };
const MAX_ATT = 8 * 1024 * 1024; // 8 Mo au total
function fmtSize(b: number): string {
  return b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(b / 1024))} Ko`;
}

/** Logo Gmail officiel (multicolore). */
function GmailLogo({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 193" className={className} aria-hidden="true">
      <path fill="#4285F4" d="M58.182 192.05V93.14L27.507 65.077 0 49.504v125.091c0 9.658 7.825 17.455 17.455 17.455z" />
      <path fill="#34A853" d="M197.818 192.05h40.727c9.659 0 17.455-7.826 17.455-17.455V49.505l-31.156 17.837-27.026 25.798z" />
      <path fill="#EA4335" d="M58.182 93.14l-4.174-38.647 4.174-36.989L128 69.868l69.818-52.364 4.669 34.992-4.669 40.644L128 145.504z" />
      <path fill="#FBBC04" d="M197.818 17.504V93.14L256 49.504V26.231c0-21.585-24.64-33.89-41.89-20.945z" />
      <path fill="#C5221F" d="M0 49.504l26.759 20.07L58.182 93.14V17.504L41.89 5.286C24.61-7.66 0 4.646 0 26.231z" />
    </svg>
  );
}

const TAG_OPTIONS = [
  { value: "Marque", label: "Marque" },
  { value: "Agence", label: "Agence" },
  { value: "Média", label: "Média" },
  { value: "PME", label: "PME" },
  { value: "Autre", label: "Autre" },
];

const ALL_TAGS = "__all__";

// ─── CSV : export + import réels ─────────────────────────────────────────────

const CSV_HEADERS = ["Marque", "Personne", "Rôle", "Tag", "Email", "Téléphone"] as const;
type CsvField = "brand" | "person" | "role" | "tag" | "email" | "phone";
const CSV_FIELDS: CsvField[] = ["brand", "person", "role", "tag", "email", "phone"];

function normHeader(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
const FIELD_ALIASES: Record<CsvField, string[]> = {
  brand: ["marque", "entreprise", "marque / entreprise", "brand", "company", "societe"],
  person: ["personne", "person", "nom", "contact", "name"],
  role: ["role", "poste", "fonction", "title", "titre"],
  tag: ["tag", "type", "categorie", "category"],
  email: ["email", "e-mail", "mail", "courriel"],
  phone: ["telephone", "phone", "tel", "mobile", "numero"],
};

/** Échappe une valeur pour une cellule CSV. */
function csvCell(v: string): string {
  const s = v ?? "";
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Génère le contenu CSV (avec BOM UTF-8 pour Excel). */
function buildCsv(rows: Row[]): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push([r.brand, r.person, r.role, r.tag, r.email, r.phone].map((v) => csvCell(v ?? "")).join(","));
  }
  return "﻿" + lines.join("\r\n");
}

/** Parse un CSV en lignes de cellules (gère guillemets, virgules, points-virgules, sauts de ligne). */
function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  // Détection du séparateur sur la 1re ligne (virgule / point-virgule / tabulation).
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const counts: [string, number][] = [
    [",", (firstLine.match(/,/g) || []).length],
    [";", (firstLine.match(/;/g) || []).length],
    ["\t", (firstLine.match(/\t/g) || []).length],
  ];
  const delim = counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ",";

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Transforme les lignes CSV en objets contact (mappe l'entête si présent, sinon positionnel). */
function csvToContacts(text: string): Partial<Record<CsvField, string>>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map(normHeader);
  // L'entête correspond-il à des champs connus ?
  const colMap: (CsvField | null)[] = header.map((h) => {
    for (const f of CSV_FIELDS) if (FIELD_ALIASES[f].includes(h)) return f;
    return null;
  });
  const hasHeader = colMap.some((c) => c !== null);
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const map = hasHeader ? colMap : CSV_FIELDS.map((f) => f); // positionnel

  return dataRows.map((cells) => {
    const obj: Partial<Record<CsvField, string>> = {};
    cells.forEach((cell, i) => {
      const f = map[i];
      if (f) obj[f] = cell.trim();
    });
    return obj;
  });
}

/** Échappe le HTML — empêche toute injection dans le corps du mail. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
/** Corps d'email HTML propre depuis un message texte (sauts de ligne préservés + signature). */
function composeEmailHtml(message: string, sig?: MailSignature | null): string {
  const footer = sig
    ? renderSignatureHtml(sig)
    : `<div style="margin-top:28px;padding-top:16px;border-top:1px solid #ececec;color:#8a8a8a;font-size:12px;white-space:normal">TTP Creators · <a href="https://ttpcreators.pro" style="color:#8a8a8a">ttpcreators.pro</a></div>`;
  return (
    `<div style="font-family:system-ui,-apple-system,Arial,sans-serif;color:#111;max-width:560px;font-size:14px;line-height:1.6;white-space:pre-line">` +
    escapeHtml(message) +
    footer +
    `</div>`
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const v = value && value.trim() ? value.trim() : "";
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-panel px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[9px] font-semibold uppercase tracking-wide text-faint">{label}</div>
        <div className="truncate text-sm text-foreground">{v || "—"}</div>
      </div>
      {v && (
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(v);
            toast(`${label} copié ✓`);
          }}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
          title={`Copier ${label.toLowerCase()}`}
        >
          <Copy className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function Contacts() {
  const [rows, setRows] = useState<Row[] | null>(() => getCache<Row[]>("contacts"));
  const [error, setError] = useState(false);
  const { query } = useSearch();
  const live = useLiveKey();

  const [selected, setSelected] = useState<Row | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [brand, setBrand] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState("");
  const [tag, setTag] = useState("Marque");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [tagFilter, setTagFilter] = useState<string>(ALL_TAGS);
  const [importing, setImporting] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Composeur d'email (envoi direct via la fonction serveur Resend `send-email`).
  const [mailOpen, setMailOpen] = useState(false);
  const [mailRecipients, setMailRecipients] = useState<string[]>([]);
  const [mailSubject, setMailSubject] = useState("");
  const [mailBody, setMailBody] = useState("");
  const [mailSig, setMailSig] = useState<MailSignature | null>(null);
  const [mailSeed, setMailSeed] = useState(0); // change → remonte le SignaturePicker (re-présélection du défaut)
  const [sending, setSending] = useState(false);
  const [sendVia, setSendVia] = useState<"gmail" | "resend">("gmail"); // Gmail = ta vraie boîte ; Resend = domaine TTP
  const [confirmSend, setConfirmSend] = useState(false); // confirmation avant envoi (anti-mauvais clic)
  const [attachments, setAttachments] = useState<Att[]>([]);
  const attachRef = useRef<HTMLInputElement>(null);

  // Lit des fichiers en base64 (data URL) et les ajoute (limite de taille totale).
  const addFiles = async (files: FileList) => {
    let total = attachments.reduce((a, x) => a + x.size, 0);
    const next = [...attachments];
    for (const f of Array.from(files)) {
      if (total + f.size > MAX_ATT) {
        toast("Pièces jointes trop lourdes (8 Mo max au total)");
        break;
      }
      const b64 = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1] ?? "");
        r.onerror = () => res("");
        r.readAsDataURL(f);
      });
      if (!b64) continue;
      next.push({ filename: f.name, mimeType: f.type || "application/octet-stream", contentBase64: b64, size: f.size });
      total += f.size;
    }
    setAttachments(next);
  };

  // Historique des mails Gmail avec le contact ouvert (fiche détail).
  const [history, setHistory] = useState<MailMsg[] | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  useEffect(() => {
    setHistory(null);
    const email = selected?.email?.trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
    let alive = true;
    setHistoryBusy(true);
    (async () => {
      const { data, error } = await supabase.functions.invoke("gmail-history", { body: { contact: email } });
      let res = data as { ok?: boolean; messages?: MailMsg[] } | null;
      if (error && (error as { context?: { json?: () => Promise<unknown> } }).context?.json)
        res = (await (error as { context: { json: () => Promise<unknown> } }).context.json().catch(() => null)) as typeof res;
      if (!alive) return;
      setHistory(res?.ok ? res.messages ?? [] : []);
      setHistoryBusy(false);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("contacts")
          .select("*")
          .order("sort_order");
        if (!active) return;
        if (error) {
          setError(true);
          setRows([]);
          return;
        }
        const list = (data as Row[]) ?? [];
        setCache("contacts", list);
        setRows(list);
      } catch {
        if (active) {
          setError(true);
          setRows([]);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [live]);

  // Liste dynamique des tags réellement présents (préserve l'ordre des TAG_OPTIONS,
  // puis ajoute les tags custom découverts dans les rows).
  const tagList = useMemo(() => {
    const present = new Set(
      (rows ?? [])
        .map((r) => (r.tag ?? "").trim())
        .filter((t) => t.length > 0)
    );
    const ordered: string[] = [];
    for (const opt of TAG_OPTIONS) {
      if (present.has(opt.value)) {
        ordered.push(opt.value);
        present.delete(opt.value);
      }
    }
    for (const extra of present) ordered.push(extra);
    return ordered;
  }, [rows]);

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-sm px-4 py-3">
        <AnimatedBadge status="danger" size="sm">
          Erreur de chargement
        </AnimatedBadge>
      </div>
    );
  }

  if (rows === null) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-sm px-4 py-3">
        <AnimatedBadge status="loading" size="sm">
          Chargement…
        </AnimatedBadge>
      </div>
    );
  }

  const currentRows = rows;

  const resetForm = () => {
    setEditId(null);
    setBrand("");
    setFirstName("");
    setLastName("");
    setRole("");
    setTag("Marque");
    setEmail("");
    setPhone("");
  };
  const openAdd = () => {
    resetForm();
    setFormOpen(true);
  };
  const startEdit = (r: Row) => {
    setEditId(r.id);
    setBrand(r.brand === "—" ? "" : r.brand);
    const p = r.person && r.person !== "—" ? r.person : "";
    const parts = p.split(" ");
    setFirstName(r.first_name ?? parts[0] ?? "");
    setLastName(r.last_name ?? parts.slice(1).join(" "));
    setRole(r.role ?? "");
    setTag(r.tag || "Marque");
    setEmail(r.email ?? "");
    setPhone(r.phone ?? "");
    setFormOpen(true);
  };

  // Ouvre le composeur. Avec un contact → destinataire + « Bonjour Prénom » pré-remplis ;
  // sans contact (bouton global) → composeur vierge pour choisir librement les destinataires.
  const openMail = (r?: Row) => {
    const fn = r?.first_name || (r?.person && r.person !== "—" ? r.person.split(" ")[0] : "");
    setMailRecipients(r?.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email) ? [r.email.toLowerCase()] : []);
    setMailSubject("");
    setMailBody(`Bonjour${fn ? " " + fn : ""},\n\n`);
    setMailSig(null);
    setAttachments([]);
    setMailSeed((n) => n + 1);
    setMailOpen(true);
    setSelected(null);
  };

  // Valide les champs puis ouvre la confirmation (anti-envoi par mégarde).
  const requestSend = () => {
    if (sending) return;
    const recipients = mailRecipients.map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (recipients.length === 0) return toast("Ajoute au moins un destinataire");
    if (!mailSubject.trim()) return toast("Ajoute un objet");
    if (!mailBody.trim()) return toast("Écris un message");
    setConfirmSend(true);
  };

  const sendMail = async () => {
    if (sending) return;
    const recipients = [...new Set(mailRecipients.map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
    if (recipients.length === 0) {
      toast("Ajoute au moins un destinataire");
      return;
    }
    const subject = mailSubject.trim();
    if (!subject) {
      toast("Ajoute un objet");
      return;
    }
    if (!mailBody.trim()) {
      toast("Écris un message");
      return;
    }
    setSending(true);
    try {
      const html = composeEmailHtml(mailBody.trim(), mailSig);
      const jsonOf = async (error: unknown, data: unknown) => {
        if (error && (error as { context?: { json?: () => Promise<unknown> } }).context?.json)
          return (await (error as { context: { json: () => Promise<unknown> } }).context.json().catch(() => null));
        return data;
      };

      if (sendVia === "gmail") {
        // L'API Gmail envoie 1:1 depuis ta boîte → un appel par destinataire.
        const nameOf = (email: string) => pickContacts.find((c) => c.email.toLowerCase() === email)?.label;
        let sent = 0;
        let firstErr = "";
        for (const to of recipients) {
          const { data, error } = await supabase.functions.invoke("gmail-send", {
            body: {
              to, subject, html, source: "manual", contactName: nameOf(to),
              attachments: attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType, contentBase64: a.contentBase64 })),
            },
          });
          const res = (await jsonOf(error, data)) as { ok?: boolean; error?: string } | null;
          if (res?.ok) sent++;
          else if (!firstErr) firstErr = res?.error ?? "";
        }
        if (sent === 0) {
          if (firstErr === "google_non_connecte" || firstErr === "gmail_scope_manquant")
            toast("Reconnecte Google (avec les droits Gmail) dans l'app.");
          else toast("Envoi Gmail échoué — réessaie");
          return;
        }
        toast(`Envoyé depuis Gmail ✓ (${sent}/${recipients.length} destinataire${recipients.length > 1 ? "s" : ""})`);
      } else {
        const { data, error } = await supabase.functions.invoke("send-email", {
          body: { to: recipients, subject, html, attachments: attachments.map((a) => ({ filename: a.filename, contentBase64: a.contentBase64 })) },
        });
        const res = (await jsonOf(error, data)) as { ok?: boolean; sent?: number; total?: number; detail?: string } | null;
        if (!res?.ok) {
          const d = (res?.detail ?? "").toLowerCase();
          if (d.includes("domain") || d.includes("verif") || d.includes("testing"))
            toast("Domaine non vérifié dans Resend — vérifie ttpcreators.pro.");
          else toast(res?.detail ? `Échec : ${res.detail}` : "Envoi échoué — réessaie");
          return;
        }
        toast(`Email envoyé ✓ (${res.sent}/${res.total} destinataire${(res.total ?? 0) > 1 ? "s" : ""})`);
      }
      setMailOpen(false);
      setMailRecipients([]);
      setMailSubject("");
      setMailBody("");
      setMailSig(null);
      setAttachments([]);
    } finally {
      setSending(false);
    }
  };

  // Contacts avec un email valide, pour le sélecteur de destinataires.
  const pickContacts: PickContact[] = (rows ?? [])
    .filter((r) => r.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email))
    .map((r) => ({ email: r.email, label: [r.brand, r.person].filter((x) => x && x !== "—").join(" · ") || r.email, tag: r.tag }));

  const submit = async () => {
    if (!brand.trim()) {
      toast("Renseigne la marque / entreprise");
      return;
    }
    const first = firstName.trim();
    const last = lastName.trim();
    const person = [first, last].filter(Boolean).join(" ");
    const payload = {
      brand: brand.trim(),
      person: person || "—",
      first_name: first || null,
      last_name: last || null,
      role: role.trim(),
      tag,
      email: email.trim(),
      phone: phone.trim(),
    };
    if (editId) {
      const ok = await dbUpdate("contacts", editId, payload);
      if (!ok) {
        toast("Erreur — réessaie");
        return;
      }
      const next = currentRows.map((r) => (r.id === editId ? ({ ...r, ...payload } as Row) : r));
      setRows(next);
      setCache("contacts", next);
      toast("Contact modifié ✓");
    } else {
      const created = await dbInsert("contacts", { ...payload, tone: "indigo", sort_order: nextOrder(currentRows) });
      if (!created) {
        toast("Erreur — réessaie");
        return;
      }
      const next = [created as unknown as Row, ...currentRows];
      setRows(next);
      setCache("contacts", next);
      toast("Contact ajouté ✓");
    }
    setFormOpen(false);
    resetForm();
  };

  // Export : télécharge un vrai fichier .csv (respecte le filtre/recherche courants).
  const exportCsv = () => {
    const toExport = filtered.length ? filtered : currentRows;
    if (toExport.length === 0) {
      toast("Aucun contact à exporter");
      return;
    }
    const csv = buildCsv(toExport);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contacts-ttp-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(`${toExport.length} contact${toExport.length > 1 ? "s" : ""} exporté${toExport.length > 1 ? "s" : ""} ✓`);
  };

  // Import : lit un fichier .csv, crée réellement les contacts en base.
  const importCsv = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = csvToContacts(text).filter((c) => (c.brand ?? "").trim() || (c.person ?? "").trim());
      if (parsed.length === 0) {
        toast("Aucune ligne exploitable dans ce CSV");
        return;
      }
      let order = nextOrder(currentRows);
      const validTags = new Set(TAG_OPTIONS.map((t) => t.value));
      const payload = parsed.map((c) => {
        const rawTag = (c.tag ?? "").trim();
        return {
          brand: (c.brand ?? "").trim() || (c.person ?? "").trim() || "—",
          person: (c.person ?? "").trim() || "—",
          role: (c.role ?? "").trim(),
          tag: validTags.has(rawTag) ? rawTag : rawTag || "Autre",
          email: (c.email ?? "").trim(),
          phone: (c.phone ?? "").trim(),
          tone: "indigo",
          sort_order: order++,
        };
      });
      const { data, error } = await supabase
        .from("contacts")
        .insert(payload)
        .select("*");
      if (error) {
        toast("Échec de l'import — vérifie le fichier");
        return;
      }
      const inserted = (data as Row[]) ?? [];
      const merged = [...inserted, ...currentRows];
      setCache("contacts", merged);
      setRows(merged);
      toast(`${inserted.length} contact${inserted.length > 1 ? "s" : ""} importé${inserted.length > 1 ? "s" : ""} ✓`);
    } catch {
      toast("Fichier illisible");
    } finally {
      setImporting(false);
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
  };

  // Le filtre par tag se combine avec la recherche existante.
  const filtered = currentRows.filter((row) => {
    const tagOk = tagFilter === ALL_TAGS || (row.tag ?? "").trim() === tagFilter;
    if (!tagOk) return false;
    return matchQuery(query, row.brand, row.person, row.role, row.email, row.tag);
  });

  const pillBase =
    "rounded-full px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors";
  const pillActive = "bg-primary text-primary-foreground";
  const pillInactive = "border border-border bg-surface text-muted-foreground hover:bg-rowhover hover:text-foreground";

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {filtered.length} contact{filtered.length > 1 ? "s" : ""}
          {(tagFilter !== ALL_TAGS || query.trim()) && (
            <span className="text-faint"> / {currentRows.length}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importCsv(f);
            }}
          />
          <button
            type="button"
            onClick={() => csvInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50"
            title="Importer un fichier CSV"
          >
            <Upload className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{importing ? "Import…" : "Importer"}</span>
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
            title="Exporter en CSV"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Exporter</span>
          </button>
          <button
            type="button"
            onClick={() => openMail()}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
            title="Écrire un email (choisir les destinataires)"
          >
            <Mail className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Email</span>
          </button>
          <AddButton label="Contact" onClick={openAdd} />
        </div>
      </div>

      {/* Barre de filtres par tag */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTagFilter(ALL_TAGS)}
          className={cn(pillBase, tagFilter === ALL_TAGS ? pillActive : pillInactive)}
        >
          Tous
        </button>
        {tagList.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTagFilter(t)}
            className={cn(pillBase, tagFilter === t ? pillActive : pillInactive)}
          >
            {t}
          </button>
        ))}
      </div>

      <InlineForm
        open={formOpen}
        title={editId ? "Modifier le contact" : "Nouveau contact"}
        onClose={() => {
          setFormOpen(false);
          setEditId(null);
        }}
        onSubmit={submit}
        submitLabel={editId ? "Enregistrer" : "Ajouter"}
      >
        <TextField
          label="Marque / Entreprise"
          value={brand}
          onChange={setBrand}
        />
        <TextField label="Prénom" value={firstName} onChange={setFirstName} className="sm:min-w-[130px]" />
        <TextField label="Nom de famille" value={lastName} onChange={setLastName} className="sm:min-w-[130px]" />
        <TextField label="Rôle" value={role} onChange={setRole} />
        <SelectField
          label="Tag"
          value={tag}
          onChange={setTag}
          options={TAG_OPTIONS}
        />
        <TextField label="Email" value={email} onChange={setEmail} type="email" />
        <TextField label="Téléphone" value={phone} onChange={setPhone} />
      </InlineForm>

      <div className="rounded-xl border border-border bg-card px-5 shadow-sm">
        {currentRows.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            Aucun contact
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {query.trim()
              ? `Aucun résultat pour « ${query} »`
              : "Aucun contact pour ce filtre"}
          </div>
        ) : (
          filtered.map((row) => (
            <div
              key={row.id}
              onClick={() => setSelected(row)}
              className="flex cursor-pointer items-center gap-3.5 border-b border-border py-3.5 last:border-b-0 hover:bg-rowhover"
            >
              {/* Avatar */}
              <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[9px] bg-surface text-[11px] font-bold text-foreground">
                {initials(row.person)}
              </div>

              {/* Marque + person · role */}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-foreground">
                  {row.brand}
                </div>
                <div className="mt-0.5 truncate text-[11px] font-normal text-faint">
                  {row.person} · {row.role}
                </div>
              </div>

              {/* Email — masqué sur mobile */}
              <div className="hidden max-w-[200px] truncate text-[11px] font-medium text-muted-foreground sm:block">
                {row.email}
              </div>

              {/* Pastille tag */}
              <span className="shrink-0 whitespace-nowrap rounded-full bg-rowhover px-2.5 py-1 text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">
                {row.tag}
              </span>

              {/* Actions */}
              <ActionMenu
                items={[
                  ...(row.email
                    ? [
                        { key: "email", label: "Envoyer un email", icon: Mail, onClick: () => openMail(row) },
                        { key: "copy", label: "Copier l'email", icon: Copy, onClick: () => { navigator.clipboard?.writeText(row.email); toast("Email copié ✓"); } },
                      ]
                    : []),
                  { key: "edit", label: "Modifier", icon: Pencil, onClick: () => startEdit(row) },
                  {
                    key: "delete",
                    label: "Supprimer",
                    icon: Trash2,
                    danger: true,
                    onClick: async () => {
                      if (await dbTrash("contacts", row.id, row.brand, row.person)) {
                        setRows(currentRows.filter((r) => r.id !== row.id));
                        toast("Déplacé dans la corbeille");
                      }
                    },
                    confirm: { title: "Supprimer le contact", message: `Supprimer « ${row.brand} » ? Tu pourras le restaurer depuis la corbeille.` },
                  },
                ]}
              />
            </div>
          ))
        )}
      </div>

      {/* Fiche détail contact */}
      {selected && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-muted text-sm font-bold text-foreground">
                {initials(selected.person)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-semibold">{selected.brand}</div>
                <div className="truncate text-xs text-faint">
                  {selected.person} · {selected.role}
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-rowhover px-2.5 py-1 text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">
                {selected.tag}
              </span>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="shrink-0 text-faint transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <CopyField label="Marque / Entreprise" value={selected.brand} />
              {selected.first_name || selected.last_name ? (
                <>
                  {selected.first_name && <CopyField label="Prénom" value={selected.first_name} />}
                  {selected.last_name && <CopyField label="Nom de famille" value={selected.last_name} />}
                </>
              ) : (
                <CopyField label="Personne" value={selected.person} />
              )}
              <CopyField label="Rôle" value={selected.role} />
              <CopyField label="Email" value={selected.email} />
              <CopyField label="Téléphone" value={selected.phone} />
            </div>

            {selected.email && (
              <div className="mt-4">
                <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                  <Mail className="h-3 w-3" /> Historique email
                </div>
                {historyBusy ? (
                  <div className="text-[11px] text-faint">Chargement des mails…</div>
                ) : !history ? null : history.length === 0 ? (
                  <div className="text-[11px] text-faint">Aucun échange trouvé dans Gmail.</div>
                ) : (
                  <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                    {history.map((m) => (
                      <div key={m.id} className="rounded-lg border border-border bg-panel px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 text-[10px] font-semibold",
                              m.direction === "in" ? "text-signaltext" : "text-primary",
                            )}
                          >
                            {m.direction === "in" ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                            {m.direction === "in" ? "Reçu" : "Envoyé"}
                          </span>
                          <span className="shrink-0 text-[10px] text-faint">{fmtMailDate(m.date)}</span>
                        </div>
                        <div className="mt-0.5 truncate text-[12px] font-medium text-foreground">{m.subject || "(sans objet)"}</div>
                        <div className="truncate text-[11px] text-faint">{m.snippet}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              {selected.email && (
                <button
                  type="button"
                  onClick={() => openMail(selected)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary py-2.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
                >
                  <Mail className="h-3.5 w-3.5" /> Envoyer un email
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const text = [
                    selected.brand,
                    `${selected.person} · ${selected.role}`,
                    selected.email,
                    selected.phone,
                  ]
                    .filter((s) => s && s.trim() && s.trim() !== "·")
                    .join("\n");
                  navigator.clipboard?.writeText(text);
                  toast("Fiche copiée ✓");
                }}
                className={cn(
                  "flex flex-1 items-center justify-center rounded-lg py-2.5 text-[11px] font-semibold uppercase tracking-wide transition-colors",
                  selected.email
                    ? "border border-border bg-surface text-muted-foreground hover:bg-rowhover hover:text-foreground"
                    : "bg-primary text-primary-foreground hover:opacity-90",
                )}
              >
                Copier {selected.email ? "la fiche" : "toute la fiche"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Composeur d'email (envoi direct via Resend) */}
      {mailOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" onClick={() => !sending && setMailOpen(false)}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">Envoyer un email</div>
              <button
                type="button"
                onClick={() => setMailOpen(false)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-faint hover:bg-rowhover hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">Destinataires</div>
                <RecipientPicker value={mailRecipients} onChange={setMailRecipients} contacts={pickContacts} />
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Objet</span>
                <input
                  value={mailSubject}
                  onChange={(e) => setMailSubject(e.target.value)}
                  placeholder="Ex : Proposition de collaboration avec TTP Creators"
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Message</span>
                <textarea
                  value={mailBody}
                  onChange={(e) => setMailBody(e.target.value)}
                  rows={8}
                  className="resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm leading-relaxed outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </label>

              <div>
                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">Signature</div>
                <SignaturePicker key={mailSeed} value={mailSig} onChange={setMailSig} />
              </div>

              {/* Pièces jointes */}
              <div>
                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">Pièces jointes</div>
                <div className="flex flex-wrap items-center gap-2">
                  {attachments.map((a, i) => (
                    <span key={`${a.filename}-${i}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-panel px-2.5 py-1 text-[11px] text-foreground">
                      <Paperclip className="h-3 w-3 text-faint" />
                      <span className="max-w-[160px] truncate">{a.filename}</span>
                      <span className="text-faint">{fmtSize(a.size)}</span>
                      <button
                        type="button"
                        onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                        className="text-faint transition-colors hover:text-[#E5484D]"
                        aria-label={`Retirer ${a.filename}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => attachRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
                  >
                    <Paperclip className="h-3.5 w-3.5" /> Joindre un fichier
                  </button>
                  <input
                    ref={attachRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.length) addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-col gap-1">
                <div className="inline-flex overflow-hidden rounded-lg border border-border">
                  <button
                    type="button"
                    onClick={() => setSendVia("gmail")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold transition-colors",
                      sendVia === "gmail" ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground hover:bg-rowhover",
                    )}
                  >
                    <GmailLogo className="h-3.5 w-3.5" /> Gmail
                  </button>
                  <button
                    type="button"
                    onClick={() => setSendVia("resend")}
                    className={cn(
                      "flex items-center gap-1.5 border-l border-border px-3 py-1.5 text-[11px] font-semibold transition-colors",
                      sendVia === "resend" ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground hover:bg-rowhover",
                    )}
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                      <path d="M4 3h8.6c3 0 5 1.8 5 4.6 0 2-1 3.4-2.8 4.1L18.9 21h-4.3l-2.7-7.7H8.1V21H4V3zm4.1 3.3v4.1h4c1.3 0 2.2-.8 2.2-2s-.9-2.1-2.2-2.1H8.1z" />
                    </svg>
                    Resend
                  </button>
                </div>
                <span className="text-[10px] text-faint">
                  {sendVia === "gmail" ? "Depuis ta boîte Gmail — réponses dans tes fils" : "Depuis ton domaine TTP (Resend)"}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMailOpen(false)}
                  disabled={sending}
                  className="rounded-lg border border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-rowhover disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={requestSend}
                  disabled={sending}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" /> {sending ? "Envoi…" : "Envoyer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmSend && (
        <ConfirmDialog
          title="Confirmer l'envoi"
          message={`Envoyer à ${[...new Set(mailRecipients.map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))].length} destinataire(s) via ${sendVia === "gmail" ? "ta boîte Gmail" : "Resend"} ? Objet : « ${mailSubject.trim()} ».`}
          confirmLabel="Envoyer"
          cancelLabel="Revenir"
          onCancel={() => setConfirmSend(false)}
          onConfirm={() => {
            setConfirmSend(false);
            sendMail();
          }}
        />
      )}
    </>
  );
}
