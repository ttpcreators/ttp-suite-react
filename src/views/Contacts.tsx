import { useStickyState } from "@/lib/useStickyState";
import { supabase } from "@/lib/supabase";
import { Copy, X, Download, Upload, Trash2, Pencil, Mail, Send, ArrowDownLeft, ArrowUpRight, Paperclip, MapPin, MessageCircle, AtSign, Phone, BriefcaseBusiness, Check, Plus, ChevronDown, ClipboardList, NotebookPen, type LucideIcon } from "@/components/icons";
import {
  parseTouches, sortTouches, lastTouch, needsRelance, nextKind, waLink, waHref, touchId, buildTouchesPatch, typeHandle,
  CANAL_LABELS, KIND_LABELS, RELANCE_DAYS, type Touch, type TouchCanal, type TouchKind, type WaMode, type ProspectSettings,
} from "@/lib/touches";
import { relanceInfo, agoLabel, agoShort, relanceCountdown } from "@/lib/contactRelance";
import { TONE_DOT, TONE_SOFT, TONE_TEXT, type StatusTone } from "@/lib/statusTone";
import { updateTouches, applyTouchChange, type TouchChange } from "@/lib/touchesDb";
import { useAppState, type AppState } from "@/lib/appState";
import { ActionMenu, ConfirmDialog } from "@/components/ui/action-menu";
import { cn, initials, titleCase } from "@/lib/utils";
import { MailAvatar } from "@/components/mail-avatar";
import { brandDomainFrom } from "@/lib/mailAvatar";
import { useSearch, matchQuery, matchWords } from "@/lib/search";
import { PillSearch } from "@/components/ui/pill-search";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { dbInsert, dbUpdate, nextOrder } from "@/lib/db";
import { dbTrash } from "@/lib/trash";
import { toast } from "@/components/ui/toast";
import {
  AddButton,
  InlineForm,
  TextField,
  SelectField,
  Picker,
} from "@/components/ui/form";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";
import { RecipientPicker, type PickContact } from "@/components/ui/recipient-picker";
import { FilterPanel } from "@/components/ui/filter-panel";
import { useIosPhone } from "@/components/mobile/ios-sheet";
import { SignaturePicker } from "@/components/ui/signature-picker";
import { renderSignatureHtml, type MailSignature } from "@/lib/useMailSignatures";
import { PageHeaderRow } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/animated-tabs";
import { NewMailDialog } from "@/components/mail-tools";
import { contactCard } from "@/lib/contactCard";
import { DEFAULT_TEMPLATES, mailtoHref, readProspectTemplates, suggestedMail, type MailTemplate } from "@/lib/mailTemplates";
import { Overlay } from "@/components/mobile/ios-sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BrandIgInline, BrandIgPanel } from "@/components/BrandInstagram";
import type { IgBrand } from "@/lib/instagram";

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
  instagram?: string | null;
  city?: string | null;
  sort_order: number;
  creator?: string | null; // renseigné = contact ajouté par ce créateur
  last_contacted?: string | null; // dernier email SORTANT vers ce contact (ISO)
  touches?: unknown; // journal de contact multi-canal (jsonb, cf. src/lib/touches.ts)
  ig?: IgBrand | null; // chiffres Instagram de la marque (ig-sync, migration 2026-10-13)
};

// Suivi du sur-contact : en-deçà de ce seuil (jours), on alerte de ne pas relancer.
const RECENT_DAYS = 30;

// Écran large (≥ 1024 px) : liste + fiche à droite. En dessous, la fiche s'ouvre en feuille.
const desktopMq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(min-width: 1024px)") : null;
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (fn) => {
      desktopMq?.addEventListener("change", fn);
      return () => desktopMq?.removeEventListener("change", fn);
    },
    () => !!desktopMq?.matches,
    () => true,
  );
}

/** « Personne · rôle » sans les champs vides ni le tiret de remplissage. */
function personRole(r: { person?: string | null; role?: string | null }): string {
  return [r.person, r.role].map((x) => (x ?? "").trim()).filter((x) => x && x !== "—").join(" · ");
}
/** Prénom pour « Écrire à … » (prénom saisi, sinon 1er mot de la personne, sinon la marque). */
function firstNameOf(r: { first_name?: string | null; person?: string | null; brand?: string | null }): string {
  const p = (r.person ?? "").trim();
  const b = (r.brand ?? "").trim();
  return (r.first_name ?? "").trim() || (p && p !== "—" ? p.split(" ")[0] : "") || (b !== "—" ? b : "");
}
/** Initiales de la tuile : la marque d'abord, sinon la personne. */
function tileInitials(r: { brand?: string | null; person?: string | null }): string {
  return initials(r.brand && r.brand !== "—" ? r.brand : r.person) || "?";
}

// Couleur d'un échange dans la frise : envoyé (contact, relance) ou réponse reçue.
const KIND_TONE: Record<TouchKind, StatusTone> = { contact: "progress", relance: "progress", reponse: "ok" };

type ContactFilter = "all" | "contacted" | "never" | "relancer";
const CONTACT_FILTER_LABELS: Record<ContactFilter, string> = {
  all: "tous",
  contacted: "déjà contactés",
  never: "jamais contactés",
  relancer: "à relancer",
};

type MenuOpt = { value: string; label: string };
/** Pilule à menu (filtres « Contact : tous », « Toutes les villes »). */
function PillMenu({ label, icon, value, options, onChange, ariaLabel, active }: {
  label: string; icon?: ReactNode; value: string; options: MenuOpt[]; onChange: (v: string) => void; ariaLabel: string; active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "flex h-9 min-w-0 max-w-full shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors",
            active ? "bg-primary/[0.08] text-primary" : "bg-surface text-foreground hover:bg-rowhover",
          )}
        >
          {icon}
          <span className="truncate">{label}</span>
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 opacity-60 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(16rem,calc(100vw-2rem))] p-1.5">
        <div className="flex flex-col gap-0.5" role="listbox" aria-label={ariaLabel}>
          {options.map((o) => {
            const on = o.value === value;
            return (
              <button
                key={o.value || "__vide"}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={cn("flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] font-medium text-foreground transition-colors hover:bg-rowhover", on && "bg-field")}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {on && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

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
  { value: "Freelance", label: "Freelance" },
  { value: "Autre", label: "Autre" },
];

const ALL_TAGS = "__all__";
const CREATOR_FILTER = "__creator__"; // filtre : contacts ajoutés par un créateur

// ─── CSV : export + import réels ─────────────────────────────────────────────

// Colonnes ajoutées en fin (Prénom…Ville) : un CSV positionnel ancien reste lisible.
const CSV_HEADERS = ["Marque", "Personne", "Rôle", "Tag", "Email", "Téléphone", "Prénom", "Nom", "Instagram", "Ville"] as const;
type CsvField = "brand" | "person" | "role" | "tag" | "email" | "phone" | "first_name" | "last_name" | "instagram" | "city";
const CSV_FIELDS: CsvField[] = ["brand", "person", "role", "tag", "email", "phone", "first_name", "last_name", "instagram", "city"];

function normHeader(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
const FIELD_ALIASES: Record<CsvField, string[]> = {
  brand: ["marque", "entreprise", "marque / entreprise", "brand", "company", "societe"],
  person: ["personne", "person", "nom complet", "contact", "name", "full name"],
  role: ["role", "poste", "fonction", "title", "titre"],
  tag: ["tag", "type", "categorie", "category"],
  email: ["email", "e-mail", "mail", "courriel"],
  phone: ["telephone", "phone", "tel", "mobile", "numero"],
  first_name: ["prenom", "first name", "firstname", "first_name"],
  last_name: ["nom", "nom de famille", "last name", "lastname", "last_name"],
  instagram: ["instagram", "insta", "ig"],
  city: ["ville", "city", "localite"],
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
    lines.push([r.brand, r.person, r.role, r.tag, r.email, r.phone, r.first_name, r.last_name, r.instagram, r.city].map((v) => csvCell(v ?? "")).join(","));
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
  // « — » = champ de remplissage en base : affiché comme vide.
  const v = value && value.trim() && value.trim() !== "—" ? value.trim() : "";
  return (
    <div className="flex items-center justify-between gap-3 rounded-[12px] bg-panel px-3 py-2">
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
        <div className={cn("truncate text-[13px]", v ? "text-foreground" : "text-faint")}>{v || "Non renseigné"}</div>
      </div>
      {v && (
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(v);
            toast(`${label} copié ✓`);
          }}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground"
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
  const [pageQ, setPageQ] = useState("");
  const live = useLiveKey();

  // Réglages prospection (Paramètres → Prospection) : rythme + mode WhatsApp.
  const { data: prospectCfg } = useAppState<ProspectSettings>((s: AppState) => (s["prospectSettings"] as ProspectSettings) ?? {});
  const { data: storedTemplates } = useAppState<MailTemplate[] | undefined>((s: AppState) => readProspectTemplates(s));
  const relanceDays = Math.max(1, Number(prospectCfg?.relanceDays) || RELANCE_DAYS);
  const waMode: WaMode = prospectCfg?.waMode === "web" ? "web" : "app";

  // Sélection : la fiche à droite (grand écran) ou en feuille (téléphone, tablette).
  const isDesktop = useIsDesktop();
  const [selId, setSelId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false); // volet « Noter un échange » de la fiche
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [brand, setBrand] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState("");
  const [tag, setTag] = useState("Marque");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [insta, setInsta] = useState("");
  const [city, setCity] = useState("");

  const [tagFilter, setTagFilter] = useState<string>(ALL_TAGS);
  const [contactFilter, setContactFilter] = useStickyState("contacts:suivi", ["all", "contacted", "never", "relancer"] as const, "all"); // déjà échangé ?
  const [cityFilter, setCityFilter] = useState<string>(""); // "" = toutes les villes
  const iosPhone = useIosPhone(); // mode iPhone : filtres rangés dans une feuille « Filtres »
  const [touchDel, setTouchDel] = useState<string | null>(null); // suppression d'une touche en 2 temps
  const [importing, setImporting] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Composeur d'email (envoi direct via la fonction serveur Resend `send-email`).
  const [mailOpen, setMailOpen] = useState(false);
  // « Écrire » / « Relancer » d'un contact : fenêtre de la page Mails (voir writeTo).
  const [contactMail, setContactMail] = useState<{ key: string; to: string; subject: string; body: string; n: number } | null>(null);
  const lastMail = useRef<{ key: string; to: string; subject: string; body: string; n: number } | null>(null);
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
  // Marque des contacts comme « contactés » (dernier email sortant). Met à jour
  // l'état + la base. Appelé à chaque envoi depuis l'app ET en réconciliation Gmail.
  const markContacted = async (emails: string[], whenISO?: string) => {
    const when = whenISO ?? new Date().toISOString();
    const set = new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean));
    if (!set.size) return;
    setRows((prev) => (prev ? prev.map((r) => (r.email && set.has(r.email.trim().toLowerCase()) ? { ...r, last_contacted: when } : r)) : prev));
    const targets = (rows ?? []).filter((r) => r.email && set.has(r.email.trim().toLowerCase()));
    await Promise.all(targets.map((r) => dbUpdate("contacts", r.id, { last_contacted: when }).catch(() => false)));
  };

  // ── Journal de contact multi-canal (« touches ») : WhatsApp, insta, tél… ──
  // Chaque prise de contact manuelle est datée dans contacts.touches (jsonb) ;
  // last_contacted est synchronisé pour tout l'existant (bento, alerte, Megan).
  // Écrit via updateTouches (relit la ligne avant) : pas d'écrasement des touches
  // ajoutées ailleurs (autre appareil, cron Gmail). Optimiste puis valeurs serveur.
  const saveTouches = async (row: Row, change: TouchChange) => {
    const prevVals = { touches: row.touches, last_contacted: row.last_contacted };
    const local = applyTouchChange(parseTouches(row.touches), change);
    const set = (vals: Partial<Row>) => {
      const apply = (r: Row): Row => (r.id === row.id ? ({ ...r, ...vals } as Row) : r);
      setRows((prev) => (prev ? prev.map(apply) : prev));
    };
    set({ touches: local, ...(buildTouchesPatch(local, row.last_contacted) as Partial<Row>) });
    const res = await updateTouches(row.id, change);
    if (res) set(res);
    else {
      set(prevVals);
      toast("Erreur, la touche n'a pas été enregistrée");
    }
  };
  const logTouch = (row: Row, canal: TouchCanal, kind?: TouchKind) => {
    const list = parseTouches(row.touches);
    const t: Touch = { id: touchId(), date: new Date().toISOString(), canal, kind: kind ?? nextKind(list, row.last_contacted) };
    void saveTouches(row, { add: t });
    toast(`${KIND_LABELS[t.kind]} · ${CANAL_LABELS[canal]} noté ✓`);
  };
  // Mail pré-rempli (modèle premier contact ou relance) ouvert dans Spark,
  // qu'on peut retoucher avant d'envoyer. La prise de contact est notée.
  const openSpark = (row: Row) => {
    const email = row.email?.trim();
    if (!email) {
      toast("Pas d'email pour ce contact");
      return;
    }
    const contacted = parseTouches(row.touches).length > 0 || Boolean(row.last_contacted);
    const tpls = Array.isArray(storedTemplates) && storedTemplates.length > 0 ? storedTemplates : DEFAULT_TEMPLATES;
    const { subject, body } = suggestedMail(tpls, { brand: row.brand === "—" ? "" : row.brand, person: row.person, first_name: row.first_name }, contacted);
    window.open(mailtoHref(email, subject, body), "_self");
    logTouch(row, "email");
  };
  const openWhatsApp = (row: Row) => {
    const url = waHref(row.phone, waMode);
    if (!url) {
      toast("Numéro illisible pour WhatsApp");
      return;
    }
    window.open(url, "_blank", "noopener");
    logTouch(row, "whatsapp");
  };

  // Le filtre par tag se combine avec la recherche existante.
  // NB : calcul simple (pas de hook) placé AVANT les retours anticipés, car la fiche
  // affichée (et donc l'historique Gmail chargé) en dépend.
  const filtered = (rows ?? []).filter((row) => {
    if (tagFilter === CREATOR_FILTER) {
      if (!(row.creator ?? "").trim()) return false;
    } else {
      const tagOk = tagFilter === ALL_TAGS || (row.tag ?? "").trim() === tagFilter;
      if (!tagOk) return false;
    }
    // Filtre « déjà échangé » (dernier mail suivi OU touche manuelle).
    if (contactFilter !== "all") {
      const list = parseTouches(row.touches);
      const contacted = !!row.last_contacted || list.length > 0;
      if (contactFilter === "contacted" && !contacted) return false;
      if (contactFilter === "never" && contacted) return false;
      if (contactFilter === "relancer" && !needsRelance(list, row.last_contacted, relanceDays)) return false;
    }
    // Filtre par ville.
    if (cityFilter && (row.city ?? "").trim().toLowerCase() !== cityFilter.toLowerCase()) return false;
    return matchQuery(query, row.brand, row.person, row.role, row.email, row.tag)
      && matchWords(pageQ, row.brand, row.person, row.first_name, row.last_name, row.role, row.email, row.tag, row.city, row.instagram, row.phone, row.creator);
  });

  // Fiche affichée : grand écran = le contact choisi (sinon le 1er de la liste) ;
  // téléphone / tablette = le contact touché, dans une feuille.
  const showInspector = isDesktop && (rows?.length ?? 0) > 0;
  const inspected = showInspector ? filtered.find((r) => r.id === selId) ?? filtered[0] ?? null : null;
  const sheetRow = !isDesktop && sheetOpen ? (rows ?? []).find((r) => r.id === selId) ?? null : null;
  const selected = inspected ?? sheetRow;

  const [history, setHistory] = useState<MailMsg[] | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  useEffect(() => {
    setHistory(null);
    setHistoryBusy(false);
    const email = selected?.email?.trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
    let alive = true;
    setHistoryBusy(true);
    (async () => {
      const { data, error } = await supabase.functions.invoke("gmail-history", { body: { contact: email, box: "all" } }); // partnerships@ + talent@
      let res = data as { ok?: boolean; messages?: MailMsg[] } | null;
      if (error && (error as { context?: { json?: () => Promise<unknown> } }).context?.json)
        res = (await (error as { context: { json: () => Promise<unknown> } }).context.json().catch(() => null)) as typeof res;
      if (!alive) return;
      const msgs = res?.ok ? res.messages ?? [] : [];
      setHistory(msgs);
      setHistoryBusy(false);
      // Réconcilie « dernier contact » depuis le dernier message SORTANT réel (Gmail).
      const outs = msgs.filter((m) => m.direction === "out").map((m) => new Date(m.date).getTime()).filter((t) => Number.isFinite(t));
      if (outs.length) {
        const lastOut = Math.max(...outs);
        const stored = selected?.last_contacted ? new Date(selected.last_contacted).getTime() : 0;
        if (lastOut > stored + 1000) markContacted([email], new Date(lastOut).toISOString());
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.email]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("contacts")
          .select("*")
          .order("sort_order");
        if (!active) return;
        // Rafraîchissement raté : on garde les contacts déjà affichés (l'erreur
        // ne s'affiche que si rien n'est encore chargé).
        if (error) {
          setError(true);
          return;
        }
        const list = (data as Row[]) ?? [];
        setError(false);
        setCache("contacts", list);
        setRows(list);
      } catch {
        if (active) setError(true);
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
    // On ne montre PAS de puce « Perso » dans le filtre : c'est le tag par défaut des
    // contacts ajoutés par les créateurs (cf. CreatorSpace) ; ils restent visibles via
    // « Tous » et le filtre « ↳ Créateurs ». (demande utilisateur)
    return ordered.filter((t) => t.toLowerCase() !== "perso");
  }, [rows]);

  // Villes présentes (pour le filtre par ville) — dédupliquées (insensible à la casse), triées.
  const cityList = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows ?? []) {
      const c = (r.city ?? "").trim();
      if (c) map.set(c.toLowerCase(), c);
    }
    return [...map.values()].sort((a, b) => a.localeCompare(b, "fr"));
  }, [rows]);

  if (error && rows === null) {
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
    setInsta("");
    setCity("");
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
    setInsta(r.instagram ?? "");
    setCity(r.city ?? "");
    setFormOpen(true);
  };

  // « Écrire » / « Relancer » sur un contact : la même fenêtre que la page Mails
  // (signature des Réglages Mails, @nom pour mettre en copie). « Écrire » ouvre un message
  // VIDE (demande de Marc 2026-10-22 : pas de « Bonjour Prénom » d'office) ; « Relancer »
  // reprend le modèle de relance. La prise de contact est notée à l'envoi.
  const writeTo = (row: Row, template: boolean) => {
    const email = row.email?.trim().toLowerCase() ?? "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast("Pas d'email pour ce contact");
    let subject = "";
    let body = "";
    if (template) {
      const contacted = parseTouches(row.touches).length > 0 || Boolean(row.last_contacted);
      const tpls = Array.isArray(storedTemplates) && storedTemplates.length > 0 ? storedTemplates : DEFAULT_TEMPLATES;
      ({ subject, body } = suggestedMail(tpls, { brand: row.brand === "—" ? "" : row.brand, person: row.person, first_name: row.first_name }, contacted));
    }
    const m = { key: email, to: email, subject, body, n: Date.now() };
    lastMail.current = m;
    setContactMail(m);
    setSheetOpen(false); // la feuille (téléphone) laisse place à la fenêtre
  };
  const mailSent = ({ to, cc }: { to: string; cc: string[] }) => {
    const sent = new Set([to, ...cc].map((e) => e.toLowerCase()));
    for (const r of rows ?? []) if (r.email && sent.has(r.email.trim().toLowerCase())) logTouch(r, "email");
  };

  // Ouvre un mail. Avec un contact → fenêtre de la page Mails (writeTo) ; sans contact
  // (bouton global) → composeur d'envoi groupé, destinataires choisis librement.
  const openMail = (r?: Row) => {
    if (r) return writeTo(r, false);
    setMailRecipients([]);
    setMailSubject("");
    setMailBody("Bonjour,\n\n");
    setMailSig(null);
    setAttachments([]);
    setMailSeed((n) => n + 1);
    setMailOpen(true);
    setSheetOpen(false); // la feuille (téléphone) laisse place au composeur ; la fiche du grand écran reste
  };

  // Bascule le mail rédigé vers Spark (destinataires, objet, texte ; les pièces
  // jointes et la signature se remettent dans Spark). Chaque contact connu est noté.
  const sendViaSpark = () => {
    const recipients = [...new Set(mailRecipients.map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
    if (recipients.length === 0) return toast("Ajoute au moins un destinataire");
    window.open(mailtoHref(recipients.join(","), mailSubject.trim(), mailBody.trim()), "_self");
    for (const r of rows ?? []) if (r.email && recipients.includes(r.email.trim().toLowerCase())) logTouch(r, "email");
    setMailOpen(false);
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
        // Parallélisé par lots de 4 pour rester rapide sans saturer le quota Gmail.
        const nameOf = (email: string) => pickContacts.find((c) => c.email.toLowerCase() === email)?.label;
        const attach = attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType, contentBase64: a.contentBase64 }));
        const okList: string[] = [];
        const failed: string[] = [];
        let firstErr = "";
        const BATCH = 4;
        for (let i = 0; i < recipients.length; i += BATCH) {
          const chunk = recipients.slice(i, i + BATCH);
          const results = await Promise.all(
            chunk.map(async (to) => {
              const { data, error } = await supabase.functions.invoke("gmail-send", {
                body: { to, subject, html, source: "manual", contactName: nameOf(to), attachments: attach },
              });
              return (await jsonOf(error, data)) as { ok?: boolean; error?: string } | null;
            }),
          );
          results.forEach((res, k) => {
            if (res?.ok) okList.push(chunk[k]);
            else {
              failed.push(chunk[k]);
              if (!firstErr) firstErr = res?.error ?? "";
            }
          });
        }
        if (okList.length === 0) {
          if (firstErr === "google_non_connecte" || firstErr === "gmail_scope_manquant")
            toast("Reconnecte Google (avec les droits Gmail) dans l'app.");
          else toast("Envoi Gmail échoué, réessaie");
          return;
        }
        // Seuls les envois réussis comptent comme « contactés ».
        await markContacted(okList);
        if (failed.length > 0) {
          // Envoi partiel : le composeur reste ouvert avec les destinataires en échec.
          setMailRecipients(failed);
          toast(`${okList.length} envoyé${okList.length > 1 ? "s" : ""}, ${failed.length} en échec`);
          return;
        }
        toast(`Envoyé depuis Gmail ✓ (${okList.length}/${recipients.length} destinataire${recipients.length > 1 ? "s" : ""})`);
      } else {
        const { data, error } = await supabase.functions.invoke("send-email", {
          body: { to: recipients, subject, html, attachments: attachments.map((a) => ({ filename: a.filename, contentBase64: a.contentBase64 })) },
        });
        const res = (await jsonOf(error, data)) as { ok?: boolean; sent?: number; total?: number; detail?: string } | null;
        if (!res?.ok) {
          const d = (res?.detail ?? "").toLowerCase();
          if (d.includes("domain") || d.includes("verif") || d.includes("testing"))
            toast("L'envoi automatique TTP n'est pas encore prêt (domaine à vérifier). Envoie via Gmail en attendant.");
          else toast(res?.detail ? `Échec : ${res.detail}` : "Envoi échoué, réessaie");
          return;
        }
        toast(`Email envoyé ✓ (${res.sent}/${res.total} destinataire${(res.total ?? 0) > 1 ? "s" : ""})`);
        await markContacted(recipients);
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
  // NB : calcul simple (PAS de useMemo) — on est APRÈS les early returns
  // `if (error)` / `if (rows === null)`, donc un hook ici changerait le nombre
  // de hooks entre deux rendus → React #310. Ne jamais mettre de hook ici.
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
      instagram: insta.trim() || null,
      city: city.trim() || null,
    };
    if (editId) {
      const ok = await dbUpdate("contacts", editId, payload);
      if (!ok) {
        toast("Erreur, réessaie");
        return;
      }
      const next = currentRows.map((r) => (r.id === editId ? ({ ...r, ...payload } as Row) : r));
      setRows(next);
      setCache("contacts", next);
      toast("Contact modifié ✓");
    } else {
      const created = await dbInsert("contacts", { ...payload, tone: "indigo", sort_order: nextOrder(currentRows) });
      if (!created) {
        toast("Erreur, réessaie");
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
    // Exporte exactement les lignes filtrées (jamais tout l'annuaire par défaut).
    const toExport = filtered;
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
    // Révocation différée : sinon le téléchargement peut être annulé (Safari).
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`${toExport.length} contact${toExport.length > 1 ? "s" : ""} exporté${toExport.length > 1 ? "s" : ""} ✓`);
  };

  // Import : lit un fichier .csv, crée réellement les contacts en base.
  const importCsv = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = csvToContacts(text).filter((c) => (c.brand ?? "").trim() || (c.person ?? "").trim() || (c.first_name ?? "").trim() || (c.last_name ?? "").trim());
      if (parsed.length === 0) {
        toast("Aucune ligne exploitable dans ce CSV");
        return;
      }
      let order = nextOrder(currentRows);
      const validTags = new Set(TAG_OPTIONS.map((t) => t.value));
      const payload = parsed.map((c) => {
        const rawTag = (c.tag ?? "").trim();
        const first = (c.first_name ?? "").trim();
        const last = (c.last_name ?? "").trim();
        const person = (c.person ?? "").trim() || [first, last].filter(Boolean).join(" ");
        return {
          brand: (c.brand ?? "").trim() || person || "—",
          person: person || "—",
          first_name: first || null,
          last_name: last || null,
          instagram: (c.instagram ?? "").trim() || null,
          city: (c.city ?? "").trim() || null,
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
        toast("Échec de l'import, vérifie le fichier");
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

  const hasCreatorContacts = currentRows.some((r) => (r.creator ?? "").trim());

  // Choisir un contact : fiche de droite (grand écran) ou feuille (téléphone, tablette).
  const pick = (id: string) => {
    if (id !== selId) {
      setLogOpen(false);
      setTouchDel(null);
    }
    setSelId(id);
    if (!isDesktop) setSheetOpen(true);
  };
  const closeSheet = () => {
    setSheetOpen(false);
    setLogOpen(false);
    setTouchDel(null);
  };
  // Modifier depuis la feuille : on la ferme pour laisser voir le formulaire.
  const editRow = (r: Row) => {
    setSheetOpen(false);
    startEdit(r);
  };
  const trashRow = async (row: Row) => {
    if (await dbTrash("contacts", row.id, row.brand, row.person)) {
      setRows(currentRows.filter((r) => r.id !== row.id));
      if (selId === row.id) closeSheet();
      toast("Déplacé dans la corbeille");
    } else toast("Erreur, réessaie");
  };
  const copyCard = (r: Row) => {
    const text = [r.brand, personRole(r), r.email, r.phone].filter((s) => s && s.trim() && s.trim() !== "—").join("\n");
    navigator.clipboard?.writeText(text);
    toast("Fiche copiée ✓");
  };
  const copyEmail = (r: Row) => {
    navigator.clipboard?.writeText(r.email);
    toast("Email copié ✓");
  };
  // Menu ⋯ : toutes les actions d'un contact (ligne et fiche).
  const rowActions = (row: Row, withCard = false) => [
    ...(waLink(row.phone) ? [{ key: "wa", label: "WhatsApp (note le contact)", icon: MessageCircle, onClick: () => openWhatsApp(row) }] : []),
    ...(row.email
      ? [
          { key: "email", label: "Envoyer un email", icon: Mail, onClick: () => openMail(row) },
          { key: "spark", label: "Mail pré-rempli dans Spark", icon: Send, onClick: () => openSpark(row) },
          { key: "copy", label: "Copier l'email", icon: Copy, onClick: () => copyEmail(row) },
        ]
      : []),
    ...(withCard ? [{ key: "card", label: "Copier la fiche", icon: ClipboardList, onClick: () => copyCard(row) }] : []),
    { key: "edit", label: "Modifier", icon: Pencil, onClick: () => editRow(row) },
    {
      key: "delete",
      label: "Supprimer",
      icon: Trash2,
      danger: true,
      onClick: () => void trashRow(row),
      confirm: { title: "Supprimer le contact", message: `Supprimer « ${row.brand} » ? Tu pourras le restaurer depuis la corbeille.` },
    },
  ];

  // Synthèse (4 cases) : mêmes comptes que l'ancien bento.
  const total = currentRows.length;
  const contactedCount = currentRows.filter((r) => r.last_contacted || parseTouches(r.touches).length > 0).length;
  const relancerCount = currentRows.filter((r) => needsRelance(parseTouches(r.touches), r.last_contacted, relanceDays)).length;
  const withEmail = currentRows.filter((r) => (r.email ?? "").trim()).length;
  const neverRows = currentRows.filter((r) => !r.last_contacted && parseTouches(r.touches).length === 0);
  const neverCats = new Set(neverRows.map((r) => (r.tag ?? "").trim()).filter(Boolean)).size;

  // ── Ligne de la liste ──
  // Largeur suivie par conteneur (@…) : la colonne principale rétrécit quand la fiche est ouverte à droite.
  const renderRow = (row: Row) => {
    const info = relanceInfo(parseTouches(row.touches), row.last_contacted, relanceDays);
    const on = showInspector && inspected?.id === row.id;
    const sub = personRole(row);
    const wa = waLink(row.phone);
    // Action de la ligne : « Relancer » quand le cycle est écoulé, sinon « Écrire » ; WhatsApp sans email.
    const act = row.email
      ? info.due
        ? { label: "Relancer", title: "Ouvre un mail de relance pré-rempli (noté à l'envoi)", run: () => writeTo(row, true), filled: true }
        : { label: "Écrire", title: "Écrire un email à ce contact", run: () => openMail(row), filled: on }
      : wa
        ? { label: info.due ? "Relancer" : "WhatsApp", title: "Ouvre WhatsApp et note le contact", run: () => openWhatsApp(row), filled: info.due || on }
        : null;
    const last =
      info.days == null ? (
        <span className="text-muted-foreground">{info.contacted ? "Contacté" : "Jamais contacté"}</span>
      ) : info.due ? (
        <span className={cn("font-semibold", TONE_TEXT.wait)}>{agoShort(info.days)} · à relancer</span>
      ) : (
        <span className="font-semibold text-foreground">{agoLabel(info.days)}</span>
      );
    return (
      <li key={row.id}>
        <div
          role="button"
          tabIndex={0}
          aria-current={on ? "true" : undefined}
          onClick={() => pick(row.id)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              pick(row.id);
            }
          }}
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-[16px] px-2.5 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 sm:px-3",
            on ? "bg-primary/[0.06] ring-[1.5px] ring-inset ring-primary" : "hover:bg-rowhover",
          )}
        >
          {/* Tuile : logo de la marque (trouvé automatiquement), sinon initiales */}
          <MailAvatar
            name={row.person}
            email={row.email}
            brand={row.brand}
            brandDomain={brandDomainFrom(currentRows, row.brand)}
            className="h-10 w-10 rounded-[10px]"
            fallback={tileInitials(row)}
            fallbackClassName="bg-field text-[12px] font-bold text-foreground"
          />

          {/* Marque + personne · rôle */}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold text-foreground">{row.brand}</div>
            {sub && <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{sub}</div>}
            <BrandIgInline ig={row.ig} className="mt-0.5 block truncate text-[11px] text-faint" />
            {/* Colonne étroite : dernier échange et catégorie passent sous le nom */}
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] @2xl:hidden">
              <span className="min-w-0 truncate @lg:hidden">{last}</span>
              {row.tag && <span className="max-w-[45%] shrink-0 truncate rounded-full bg-field px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{row.tag}</span>}
            </div>
          </div>

          {/* Attribution : contact ajouté par un créateur */}
          {row.creator && (
            <span
              className="hidden shrink-0 whitespace-nowrap rounded-full bg-signalsoft px-2.5 py-1 text-[11px] font-medium text-signaltext @3xl:inline"
              title={`Ajouté par ${titleCase(row.creator)}`}
            >
              ↳ {titleCase(row.creator)}
            </span>
          )}

          {/* Dernier échange */}
          <div className="hidden shrink-0 whitespace-nowrap text-right text-[12px] @lg:block">{last}</div>

          {/* Catégorie */}
          {row.tag && (
            <span className="hidden max-w-[120px] shrink-0 truncate whitespace-nowrap rounded-full bg-field px-2.5 py-1 text-[11px] font-medium text-muted-foreground @2xl:inline">
              {row.tag}
            </span>
          )}

          {/* Écrire / Relancer */}
          {act && (
            <button
              type="button"
              title={act.title}
              onClick={(e) => {
                e.stopPropagation();
                act.run();
              }}
              className={cn(
                "hidden h-8 shrink-0 items-center rounded-full px-3.5 text-[12px] font-semibold transition-colors @lg:inline-flex",
                act.filled ? "bg-primary text-primary-foreground hover:opacity-90" : "bg-field text-foreground hover:bg-rowhover",
              )}
            >
              {act.label}
            </button>
          )}

          {/* Toutes les actions (le clic ne sélectionne pas la ligne) */}
          <span className="-mr-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            <ActionMenu items={rowActions(row)} />
          </span>
        </div>
      </li>
    );
  };

  // ── Fiche du contact (colonne de droite ou feuille) ──
  const renderInspector = (row: Row, inSheet: boolean) => {
    const list = sortTouches(parseTouches(row.touches));
    const info = relanceInfo(list, row.last_contacted, relanceDays);
    const kindNext = nextKind(list, row.last_contacted);
    const last = lastTouch(list);
    const sub = personRole(row);
    const fn = firstNameOf(row);
    const wa = waLink(row.phone);
    const CANAL_BTNS: { canal: TouchCanal; icon: LucideIcon }[] = [
      { canal: "whatsapp", icon: MessageCircle },
      { canal: "instagram", icon: AtSign },
      { canal: "tel", icon: Phone },
      { canal: "linkedin", icon: BriefcaseBusiness },
    ];
    const infoRow = "flex min-h-11 items-center justify-between gap-3 px-3.5 py-2";
    const chip = "flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors";
    // Action principale : écrire un mail, sinon WhatsApp, sinon compléter la fiche.
    const primary = row.email
      ? { label: fn ? `Écrire à ${fn}` : "Écrire un mail", icon: Mail, run: () => openMail(row) }
      : wa
        ? { label: fn ? `WhatsApp à ${fn}` : "WhatsApp", icon: MessageCircle, run: () => openWhatsApp(row) }
        : { label: "Ajouter un email", icon: Pencil, run: () => editRow(row) };
    return (
      <>
        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-1 [&>*]:shrink-0">
          {/* En-tête : tuile, marque, personne · rôle, menu ⋯ */}
          <div className="flex items-start gap-3">
            <MailAvatar
              name={row.person}
              email={row.email}
              brand={row.brand}
              brandDomain={brandDomainFrom(currentRows, row.brand)}
              className="h-14 w-14 rounded-[16px]"
              fallback={tileInitials(row)}
              fallbackClassName="bg-field text-[18px] font-bold text-foreground"
            />
            <div className="min-w-0 flex-1 pt-0.5">
              <h2 className="text-[22px] font-bold leading-tight tracking-[-0.02em] text-foreground [overflow-wrap:anywhere]">{row.brand}</h2>
              {sub && <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{sub}</p>}
              <BrandIgInline ig={row.ig} className="mt-0.5 block truncate text-[12px] text-faint" />
            </div>
            <div className="-mr-1.5 -mt-1 flex shrink-0 items-center">
              <ActionMenu items={rowActions(row, true)} />
              {inSheet && (
                <button
                  type="button"
                  onClick={closeSheet}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                  aria-label="Fermer"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>

          {/* L'essentiel */}
          <div className="divide-y divide-border rounded-[16px] bg-panel text-[13px]">
            <div className={infoRow}>
              <span className="text-muted-foreground">Email</span>
              {row.email ? (
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium text-foreground" title={row.email}>Disponible</span>
                  <button
                    type="button"
                    onClick={() => copyEmail(row)}
                    title={`Copier ${row.email}`}
                    className="h-7 shrink-0 rounded-full bg-field px-2.5 text-[12px] font-semibold text-foreground transition-colors hover:bg-rowhover"
                  >
                    Copier
                  </button>
                </span>
              ) : (
                <span className="text-faint">Non renseigné</span>
              )}
            </div>
            <div className={infoRow}>
              <span className="text-muted-foreground">Catégorie</span>
              <span className="truncate font-medium text-foreground">{row.tag || "Aucune"}</span>
            </div>
            <div className={infoRow}>
              <span className="text-muted-foreground">Dernier échange</span>
              <span className={cn("truncate font-medium", info.due ? TONE_TEXT.wait : "text-foreground")}>
                {info.days == null ? (info.contacted ? "Contacté" : "Jamais contacté") : agoLabel(info.days)}
              </span>
            </div>
            {row.creator && (
              <div className={infoRow}>
                <span className="text-muted-foreground">Ajouté par</span>
                <span className="truncate font-medium text-signaltext">{titleCase(row.creator)}</span>
              </div>
            )}
          </div>

          {/* Prochaine relance : avancement du cycle de recontact */}
          <section>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[13px] font-semibold text-foreground">Prochaine relance</h3>
              <span className={cn("text-right text-[13px] font-semibold", info.due ? TONE_TEXT.wait : info.daysLeft == null ? "text-muted-foreground" : "text-foreground")}>
                {info.daysLeft == null ? "Après le premier contact" : info.due ? "À relancer" : relanceCountdown(info.daysLeft)}
              </span>
            </div>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-field"
              role="progressbar"
              aria-label="Cycle de relance"
              aria-valuemin={0}
              aria-valuemax={relanceDays}
              aria-valuenow={Math.min(relanceDays, info.days ?? 0)}
            >
              <div
                className={cn("h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none", info.due ? TONE_DOT.wait : "bg-primary")}
                style={{ width: `${Math.round(info.progress * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
              Le contact passe dans « À relancer » après {relanceDays} jours sans échange.
            </p>
            {info.days != null && !info.due && info.days < Math.min(RECENT_DAYS, relanceDays) && (
              <p className={cn("mt-1 text-[12px] font-medium", TONE_TEXT.wait)}>Échange récent : évite de relancer trop vite.</p>
            )}
          </section>

          {/* Échanges : journal multi-canal, du plus récent au plus ancien */}
          <section>
            <h3 className="mb-2.5 text-[13px] font-semibold text-foreground">Échanges</h3>
            {list.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">Aucun échange noté pour l'instant.</p>
            ) : (
              <ol className="flex flex-col">
                {list.map((t, i) => (
                  <li key={t.id} className="relative flex items-start gap-3 pb-3 last:pb-0">
                    {i < list.length - 1 && <span aria-hidden className="absolute bottom-0 left-[4px] top-4 w-px bg-border" />}
                    <span aria-hidden className={cn("relative mt-[5px] h-[9px] w-[9px] shrink-0 rounded-full", TONE_DOT[KIND_TONE[t.kind]])} />
                    <div className="min-w-0 flex-1 text-[13px] leading-snug">
                      <span className="font-medium text-foreground">{KIND_LABELS[t.kind]}</span>
                      <span className="text-muted-foreground"> · {CANAL_LABELS[t.canal]}</span>
                      {t.note && <div className="text-[12px] text-muted-foreground">{t.note}</div>}
                    </div>
                    <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{fmtMailDate(t.date)}</span>
                    {touchDel === t.id ? (
                      <button
                        type="button"
                        onClick={() => {
                          setTouchDel(null);
                          void saveTouches(row, { remove: t.id });
                        }}
                        className="shrink-0 rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-semibold text-dangertext"
                      >
                        Supprimer ?
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setTouchDel(t.id)}
                        className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-faint transition-colors hover:text-dangertext"
                        aria-label="Supprimer cet échange"
                        title="Supprimer cet échange"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* Historique Gmail */}
          {row.email && (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">Historique email</h3>
              {historyBusy ? (
                <p className="text-[12px] text-muted-foreground">Chargement des mails…</p>
              ) : !history ? null : history.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">Aucun échange trouvé dans Gmail.</p>
              ) : (
                <div className="flex max-h-52 flex-col gap-1.5 overflow-y-auto pr-1">
                  {history.map((m) => (
                    <div key={m.id} className="rounded-[12px] bg-panel px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold", m.direction === "in" ? "text-signaltext" : "text-primary")}>
                          {m.direction === "in" ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                          {m.direction === "in" ? "Reçu" : "Envoyé"}
                        </span>
                        <span className="shrink-0 text-[11px] text-faint">{fmtMailDate(m.date)}</span>
                      </div>
                      <div className="mt-0.5 truncate text-[12px] font-medium text-foreground">{m.subject || "(sans objet)"}</div>
                      <div className="truncate text-[11px] text-faint">{m.snippet}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Instagram de la marque */}
          {row.instagram?.trim() && !row.creator && (
            <BrandIgPanel
              contactId={row.id}
              ig={row.ig}
              onChange={(ig) => setRows((prev) => (prev ? prev.map((r) => (r.id === row.id ? { ...r, ig } : r)) : prev))}
            />
          )}

          {/* Coordonnées (copiables) */}
          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-foreground">Coordonnées</h3>
            <div className="flex flex-col gap-1.5">
              <CopyField label="Marque / Entreprise" value={row.brand} />
              {row.first_name || row.last_name ? (
                <>
                  {row.first_name && <CopyField label="Prénom" value={row.first_name} />}
                  {row.last_name && <CopyField label="Nom de famille" value={row.last_name} />}
                </>
              ) : (
                <CopyField label="Personne" value={row.person} />
              )}
              <CopyField label="Rôle" value={row.role} />
              <CopyField label="Email" value={row.email} />
              <CopyField label="Téléphone" value={row.phone} />
              {row.instagram && <CopyField label="Instagram" value={row.instagram} />}
              {row.city && <CopyField label="Ville" value={row.city} />}
            </div>
          </section>
        </div>

        {/* Actions, collées en bas de la fiche */}
        <div className="mt-4 flex shrink-0 flex-col gap-2 border-t border-border pt-4">
          {logOpen && (
            <div className="flex flex-col gap-2 rounded-[14px] bg-panel p-3">
              <span className="text-[12px] font-medium text-muted-foreground">
                Noter {kindNext === "contact" ? "le premier contact" : "une relance"} à aujourd'hui
              </span>
              <div className="flex flex-wrap gap-1.5">
                {row.email && (
                  <button
                    type="button"
                    onClick={() => {
                      setLogOpen(false);
                      openSpark(row);
                    }}
                    title={`Ouvre un mail pré-rempli (${kindNext === "contact" ? "premier contact" : "relance"}) dans Spark et le note`}
                    className={cn(chip, "bg-primary text-primary-foreground hover:opacity-90")}
                  >
                    <Mail className="h-3.5 w-3.5" /> Spark
                  </button>
                )}
                {CANAL_BTNS.map(({ canal, icon: CI }) => (
                  <button
                    key={canal}
                    type="button"
                    onClick={() => {
                      setLogOpen(false);
                      if (canal === "whatsapp" && wa) openWhatsApp(row);
                      else logTouch(row, canal);
                    }}
                    title={`Noter : ${kindNext === "contact" ? "premier contact" : "relance"} via ${CANAL_LABELS[canal]}`}
                    className={cn(chip, "bg-surface text-foreground hover:bg-rowhover")}
                  >
                    <CI className="h-3.5 w-3.5" /> {CANAL_LABELS[canal]}
                  </button>
                ))}
                {list.length > 0 && last?.kind !== "reponse" && (
                  <button
                    type="button"
                    onClick={() => {
                      setLogOpen(false);
                      logTouch(row, last?.canal ?? "autre", "reponse");
                    }}
                    className={cn(chip, "font-semibold", TONE_SOFT.ok)}
                  >
                    <Check className="h-3.5 w-3.5" /> Réponse reçue
                  </button>
                )}
              </div>
              <p className="text-[11px] leading-snug text-faint">Spark ouvre un mail pré-rempli, WhatsApp la conversation.</p>
            </div>
          )}
          <button
            type="button"
            onClick={primary.run}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <primary.icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{primary.label}</span>
          </button>
          {/* Copie nom, rôle, marque, email et téléphone d'un coup. */}
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(contactCard(row)).then(
                () => toast("Fiche copiée ✓"),
                () => toast("Copie impossible"),
              );
            }}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-field px-4 text-[14px] font-semibold text-foreground transition-colors hover:bg-rowhover"
            title="Copie le nom, le rôle, la marque, l'email et le téléphone"
          >
            <Copy className="h-4 w-4 shrink-0" /> Copier la fiche
          </button>
          <button
            type="button"
            onClick={() => setLogOpen((v) => !v)}
            aria-expanded={logOpen}
            className={cn(
              "flex h-11 w-full items-center justify-center gap-2 rounded-full px-4 text-[14px] font-semibold transition-colors",
              logOpen ? "bg-primary/[0.08] text-primary" : "bg-field text-foreground hover:bg-rowhover",
            )}
          >
            <NotebookPen className="h-4 w-4 shrink-0" /> Noter un échange
          </button>
        </div>
      </>
    );
  };

  const kpiCell = "flex min-w-0 flex-col gap-1 p-4 sm:p-5";
  const kpiLabel = "text-[12px] font-medium text-muted-foreground";
  const kpiValue = "text-[26px] font-bold leading-tight tracking-[-0.02em] tabular-nums text-foreground";
  const contactedPct = total ? Math.round((contactedCount / total) * 100) : 0;

  return (
    <>
      <PageHeaderRow>
        <div className="text-sm text-muted-foreground">
          {filtered.length} contact{filtered.length > 1 ? "s" : ""}
          {(tagFilter !== ALL_TAGS || contactFilter !== "all" || cityFilter || query.trim()) && (
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
            onClick={() => openMail()}
            className="flex h-10 items-center gap-1.5 rounded-full bg-surface px-4 text-[13px] font-medium text-foreground transition-colors hover:bg-rowhover"
            title="Écrire un email (choisir les destinataires)"
          >
            <Mail className="h-4 w-4" />
            <span>Écrire un mail</span>
          </button>
          {/* Importer / Exporter (CSV) */}
          <ActionMenu
            buttonClassName="h-10 w-10 bg-surface text-foreground hover:bg-rowhover"
            items={[
              {
                key: "import",
                label: importing ? "Import…" : "Importer un CSV",
                icon: Upload,
                onClick: () => {
                  if (!importing) csvInputRef.current?.click();
                },
              },
              { key: "export", label: "Exporter en CSV", icon: Download, onClick: exportCsv },
            ]}
          />
          {iosPhone ? (
            <AddButton label="Contact" onClick={openAdd} />
          ) : (
            <button
              type="button"
              onClick={openAdd}
              aria-label="Ajouter un contact"
              title="Ajouter un contact"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Plus className="h-5 w-5" />
            </button>
          )}
        </div>
      </PageHeaderRow>

      <div className={cn(showInspector && "grid grid-cols-[minmax(0,1fr)_320px] items-start gap-5")}>
        {/* Colonne principale */}
        <div className="@container min-w-0">
          {/* Synthèse : quatre cases dans un seul panneau */}
          {total > 0 && (
            <div className="mb-5 grid grid-cols-2 overflow-hidden rounded-[20px] bg-surface @2xl:grid-cols-4">
              <div className={cn(kpiCell, "border-b border-r border-border @2xl:border-b-0")}>
                <span className={kpiLabel}>Répertoire</span>
                <span className={kpiValue}>{total}</span>
                <span className="text-[12px] text-muted-foreground">{withEmail} avec email</span>
              </div>
              <div className={cn(kpiCell, "border-b border-border @2xl:border-b-0 @2xl:border-r")}>
                <span className={kpiLabel}>Déjà contactés</span>
                <span className={kpiValue}>{contactedCount}</span>
                <div
                  className="mt-1 h-1 overflow-hidden rounded-full bg-field"
                  role="progressbar"
                  aria-label="Part du répertoire déjà contactée"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={contactedPct}
                >
                  <div className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${contactedPct}%` }} />
                </div>
                <span className="text-[12px] text-muted-foreground">{contactedPct} % du répertoire</span>
              </div>
              <div className={cn(kpiCell, "border-r border-border", TONE_SOFT.wait)}>
                <span className="text-[12px] font-medium">À relancer, {relanceDays} j et plus</span>
                <span className={cn(kpiValue, TONE_TEXT.wait)}>{relancerCount}</span>
                <button
                  type="button"
                  onClick={() => setContactFilter(contactFilter === "relancer" ? "all" : "relancer")}
                  aria-pressed={contactFilter === "relancer"}
                  className="self-start text-[12px] font-semibold underline-offset-2 hover:underline"
                >
                  {contactFilter === "relancer" ? "Tout afficher" : "Voir la liste"}
                </button>
              </div>
              <div className={kpiCell}>
                <span className={kpiLabel}>Jamais contactés</span>
                <span className={kpiValue}>{neverRows.length}</span>
                <span className="text-[12px] text-muted-foreground">
                  {neverCats > 0 ? `dans ${neverCats} catégorie${neverCats > 1 ? "s" : ""}` : `${tagList.length} catégorie${tagList.length > 1 ? "s" : ""}`}
                </span>
              </div>
            </div>
          )}

          {/* Mode iPhone : les trois filtres dans une feuille « Filtres » */}
          {iosPhone && <PillSearch className="mb-2.5 sm:max-w-none" value={pageQ} onChange={setPageQ} placeholder="Rechercher un contact, un mail…" />}
          {iosPhone ? (
            <FilterPanel
              className="mb-4"
              activeCount={(tagFilter !== ALL_TAGS ? 1 : 0) + (contactFilter !== "all" ? 1 : 0) + (cityFilter ? 1 : 0)}
              onClear={() => {
                setTagFilter(ALL_TAGS);
                setContactFilter("all");
                setCityFilter("");
              }}
              groups={[
                {
                  id: "tag",
                  label: "Catégorie",
                  value: tagFilter,
                  onChange: setTagFilter,
                  options: [
                    { value: ALL_TAGS, label: "Tous" },
                    ...tagList.map((t) => ({ value: t, label: t })),
                    ...(hasCreatorContacts ? [{ value: CREATOR_FILTER, label: "Ajoutés par les créateurs" }] : []),
                  ],
                },
                {
                  id: "suivi",
                  label: "Suivi",
                  value: contactFilter,
                  onChange: (v) => setContactFilter(v as ContactFilter),
                  options: [
                    { value: "all", label: "Tous" },
                    { value: "contacted", label: "Déjà contactés" },
                    { value: "never", label: "Jamais contactés" },
                    { value: "relancer", label: "À relancer" },
                  ],
                },
              ]}
              extra={cityList.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <span className="px-1 text-[13px] font-medium uppercase tracking-[0.02em] text-muted-foreground">Ville</span>
                  <Picker ariaLabel="Filtrer par ville" className="w-full" value={cityFilter} onChange={setCityFilter}
                    options={[{ value: "", label: "Toutes les villes" }, ...cityList.map((c) => ({ value: c, label: c }))]} />
                </div>
              ) : undefined}
            />
          ) : (
            /* Catégorie (segments) + suivi de contact + ville */
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <PillSearch value={pageQ} onChange={setPageQ} placeholder="Rechercher un contact, un mail…" />
              <Tabs
                className="min-w-0 max-w-full"
                label="Filtrer par catégorie"
                items={[
                  { value: ALL_TAGS, label: "Tous" },
                  ...tagList.map((t) => ({ value: t, label: t })),
                  ...(hasCreatorContacts ? [{ value: CREATOR_FILTER, label: "Ajoutés par les créateurs" }] : []),
                ]}
                value={tagFilter}
                onValueChange={setTagFilter}
              />
              <PillMenu
                ariaLabel="Filtrer par suivi de contact"
                label={`Contact : ${CONTACT_FILTER_LABELS[contactFilter]}`}
                value={contactFilter}
                active={contactFilter !== "all"}
                onChange={(v) => setContactFilter(v as ContactFilter)}
                options={[
                  { value: "all", label: "Tous" },
                  { value: "contacted", label: "Déjà contactés" },
                  { value: "never", label: "Jamais contactés" },
                  { value: "relancer", label: "À relancer" },
                ]}
              />
              {cityList.length > 0 && (
                <PillMenu
                  ariaLabel="Filtrer par ville"
                  icon={<MapPin className="h-3.5 w-3.5 shrink-0 opacity-70" />}
                  label={cityFilter || "Toutes les villes"}
                  value={cityFilter}
                  active={!!cityFilter}
                  onChange={setCityFilter}
                  options={[{ value: "", label: "Toutes les villes" }, ...cityList.map((c) => ({ value: c, label: c }))]}
                />
              )}
            </div>
          )}

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
              label="Catégorie"
              value={tag}
              onChange={setTag}
              options={TAG_OPTIONS}
            />
            <TextField label="Email" value={email} onChange={setEmail} type="email" />
            <TextField label="Téléphone" value={phone} onChange={setPhone} />
            <TextField label="Instagram" value={insta} onChange={(v) => setInsta(typeHandle(v))} placeholder="@lamarque" className="sm:min-w-[150px]" />
            <TextField label="Ville" value={city} onChange={setCity} placeholder="Paris" className="sm:min-w-[130px]" />
          </InlineForm>

          {currentRows.length === 0 ? (
            <div className="rounded-[20px] bg-surface p-6 text-center text-sm text-muted-foreground">
              Aucun contact pour l'instant. Ajoute ta première marque avec « + », ou importe un fichier CSV.
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-[20px] bg-surface p-6 text-center text-sm text-muted-foreground">
              {query.trim() ? `Aucun résultat pour « ${query} »` : "Aucun contact pour ce filtre"}
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5 rounded-[20px] bg-surface p-1.5">{filtered.map(renderRow)}</ul>
          )}
        </div>

        {/* Fiche du contact sélectionné (grand écran) */}
        {showInspector && (
          <aside aria-label="Fiche du contact" className="sticky top-5 flex h-[calc(100dvh-4.5rem)] flex-col rounded-[22px] bg-surface p-5">
            {inspected ? (
              renderInspector(inspected, false)
            ) : (
              <p className="m-auto text-center text-[13px] text-muted-foreground">Aucun contact pour ce filtre.</p>
            )}
          </aside>
        )}
      </div>

      {/* Fiche en feuille : téléphone et tablette */}
      {sheetRow && (
        <Overlay className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" label={sheetRow.brand} onClose={closeSheet}>
          <div
            role="dialog"
            aria-label={`Fiche ${sheetRow.brand}`}
            className="flex max-h-[88vh] w-full max-w-md flex-col rounded-[22px] bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {renderInspector(sheetRow, true)}
          </div>
        </Overlay>
      )}

      {/* Composeur d'email (envoi direct via Resend) */}
      <NewMailDialog
        open={!!contactMail}
        floating
        expandKey={contactMail?.n}
        defaultBox="partnerships"
        prefill={contactMail}
        onClose={() => setContactMail(null)}
        onReopen={() => lastMail.current && setContactMail({ ...lastMail.current, n: Date.now() })}
        onSent={mailSent}
      />
      {mailOpen && (
        <Overlay className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" onClose={() => !sending && setMailOpen(false)}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">Envoyer un email</div>
              <button
                type="button"
                onClick={() => setMailOpen(false)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint hover:bg-rowhover hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Destinataires</div>
                <RecipientPicker value={mailRecipients} onChange={setMailRecipients} contacts={pickContacts} />
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">Objet</span>
                <input
                  value={mailSubject}
                  onChange={(e) => setMailSubject(e.target.value)}
                  placeholder="Ex : Proposition de collaboration avec TTP Creators"
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">Message</span>
                <textarea
                  value={mailBody}
                  onChange={(e) => setMailBody(e.target.value)}
                  rows={8}
                  className="resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm leading-relaxed outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </label>

              <div>
                <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Signature</div>
                <SignaturePicker key={mailSeed} value={mailSig} onChange={setMailSig} />
              </div>

              {/* Pièces jointes */}
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Pièces jointes</div>
                <div className="flex flex-wrap items-center gap-2">
                  {attachments.map((a, i) => (
                    <span key={`${a.filename}-${i}`} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-panel px-2.5 py-1 text-[11px] text-foreground">
                      <Paperclip className="h-3 w-3 text-faint" />
                      <span className="max-w-[160px] truncate">{a.filename}</span>
                      <span className="text-faint">{fmtSize(a.size)}</span>
                      <button
                        type="button"
                        onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                        className="text-faint transition-colors hover:text-destructive"
                        aria-label={`Retirer ${a.filename}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => attachRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
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
                <Tabs
                  size="sm"
                  label="Envoyer via"
                  items={[
                    { value: "gmail", label: "Gmail", icon: <GmailLogo className="h-3.5 w-3.5" /> },
                    {
                      value: "resend",
                      label: "Envoi automatique TTP",
                      icon: (
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                          <path d="M4 3h8.6c3 0 5 1.8 5 4.6 0 2-1 3.4-2.8 4.1L18.9 21h-4.3l-2.7-7.7H8.1V21H4V3zm4.1 3.3v4.1h4c1.3 0 2.2-.8 2.2-2s-.9-2.1-2.2-2.1H8.1z" />
                        </svg>
                      ),
                    },
                  ]}
                  value={sendVia}
                  onValueChange={(v) => setSendVia(v as "gmail" | "resend")}
                />
                <span className="text-[10px] text-faint">
                  {sendVia === "gmail" ? "Depuis ta boîte Gmail : réponses dans tes fils" : "Les réponses n'apparaîtront pas dans Mails."}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMailOpen(false)}
                  disabled={sending}
                  className="rounded-full border border-border px-4 py-2 text-[12px] font-medium text-muted-foreground hover:bg-rowhover disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={sendViaSpark}
                  disabled={sending}
                  title="Ouvre ce mail dans Spark pour l'envoyer de là (pièces jointes à remettre dans Spark)"
                  className="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50"
                >
                  <Mail className="h-3.5 w-3.5" /> Spark
                </button>
                <button
                  type="button"
                  onClick={requestSend}
                  disabled={sending}
                  className="flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" /> {sending ? "Envoi…" : "Envoyer"}
                </button>
              </div>
            </div>
          </div>
        </Overlay>
      )}

      {confirmSend && (
        <ConfirmDialog
          title="Confirmer l'envoi"
          message={`Envoyer à ${[...new Set(mailRecipients.map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))].length} destinataire(s) via ${sendVia === "gmail" ? "ta boîte Gmail" : "l'envoi automatique TTP"} ? Objet : « ${mailSubject.trim()} ».`}
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
