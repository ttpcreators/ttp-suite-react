import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  FileText,
  Eye,
  Download,
  Pencil,
  Send,
  Plus,
  Trash2,
  Settings2,
  Landmark,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSearch, matchQuery } from "@/lib/search";
import { cn, titleCase } from "@/lib/utils";
import { parseAmount, formatEuro, useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import type { AnimatedBadgeStatus } from "@/components/ui/be-ui-animated-badge";
import { dbInsert, dbUpdate, nextOrder } from "@/lib/db";
import { dbTrash } from "@/lib/trash";
import { toast } from "@/components/ui/toast";
import { AddButton, TextField, SelectField } from "@/components/ui/form";
import { ActionMenu, type ActionItem } from "@/components/ui/action-menu";
import { useCreators } from "@/lib/useCreators";
import { commissionMap } from "@/lib/commission";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";

// ─── Types ───────────────────────────────────────────────────────────────────

type InvoiceStatus = "payee" | "attente" | "retard" | "brouillon";

type Row = {
  id: string;
  ref: string;
  party: string;
  amount: string;
  date: string;
  status: InvoiceStatus;
  creator: string | null;
  sort_order: number | null;
};

type LineItem = { id: string; label: string; qty: number; unit: number };

type BankAccount = { id: string; label: string; holder: string; bank: string; iban: string; bic: string };

type Issuer = {
  name: string;
  legalForm: string;
  address: string;
  siret: string;
  ape: string;
  rcs: string;
  vat: string;
  email: string;
  phone: string;
};

type Details = {
  clientName: string;
  clientEmail: string;
  clientAddress: string;
  clientSiret: string;
  clientVat: string;
  issueDate: string;
  dueDate: string;
  items: LineItem[];
  franchise: boolean;
  vatRate: number;
  commissionRate: number;
  bankId: string;
  notes: string;
};

type Draft = Details & {
  id: string | null;
  ref: string;
  brand: string;
  creator: string;
  status: InvoiceStatus;
};

type Totals = { ht: number; tva: number; ttc: number; commission: number; reversal: number };

// ─── Constantes ──────────────────────────────────────────────────────────────

const STATUS_META: Record<InvoiceStatus, { badge: AnimatedBadgeStatus; label: string }> = {
  payee: { badge: "success", label: "Payée" },
  attente: { badge: "warning", label: "En attente" },
  retard: { badge: "danger", label: "En retard" },
  brouillon: { badge: "neutral", label: "Brouillon" },
};

const STATUS_OPTIONS: { value: InvoiceStatus; label: string }[] = [
  { value: "brouillon", label: "Brouillon" },
  { value: "attente", label: "En attente" },
  { value: "payee", label: "Payée" },
  { value: "retard", label: "En retard" },
];

const DEFAULT_ISSUER: Issuer = {
  name: "TTP Creators",
  legalForm: "",
  address: "Lyon, France",
  siret: "",
  ape: "",
  rcs: "",
  vat: "",
  email: "partnerships@ttpcreators.pro",
  phone: "",
};

const VAT_OPTIONS = [
  { value: "franchise", label: "Franchise (art. 293 B)" },
  { value: "20", label: "TVA 20 %" },
  { value: "10", label: "TVA 10 %" },
  { value: "5.5", label: "TVA 5,5 %" },
];

const DEFAULT_COMMISSION = 20;

// ─── Helpers ─────────────────────────────────────────────────────────────────

let _uid = 0;
function uid(): string {
  _uid += 1;
  return `f${Date.now().toString(36)}${_uid}`;
}

function num(s: unknown): number {
  const n = parseFloat(String(s ?? "").replace(/\s/g, "").replace(",", ".").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function euro2(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
function fmtRate(n: number): string {
  return String(n).replace(".", ",");
}
function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
}

function totalsOf(items: LineItem[], franchise: boolean, vatRate: number, commissionRate: number): Totals {
  const ht = items.reduce((s, it) => s + (it.qty || 0) * (it.unit || 0), 0);
  const tva = franchise ? 0 : ht * (vatRate / 100);
  const ttc = ht + tva;
  const commission = ht * (commissionRate / 100);
  const reversal = ht - commission;
  return { ht, tva, ttc, commission, reversal };
}

function firstName(name: string): string {
  return titleCase(name).split(" ")[0] ?? name;
}

function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function frDate(iso: string): string {
  if (!iso || iso === "—") return iso || "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("fr-FR");
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);

// ─── Facture HTML (conforme droit français) ──────────────────────────────────

function invoiceHTML(o: {
  issuer: Issuer;
  bank: BankAccount | null;
  details: Details;
  ref: string;
  brand: string;
  creator: string | null;
  totals: Totals;
  statusLabel: string;
}): string {
  const { issuer, bank, details: d, ref, brand, creator, totals, statusLabel } = o;

  const issuerLegal = [
    issuer.legalForm,
    issuer.address,
    issuer.siret ? `SIRET ${issuer.siret}` : "",
    issuer.rcs ? `RCS ${issuer.rcs}` : "",
    issuer.ape ? `APE ${issuer.ape}` : "",
    issuer.vat ? `TVA ${issuer.vat}` : "",
    issuer.email,
    issuer.phone,
  ]
    .filter(Boolean)
    .map((l) => `<div>${esc(l)}</div>`)
    .join("");

  const clientLegal = [
    d.clientAddress,
    d.clientSiret ? `SIRET ${d.clientSiret}` : "",
    d.clientVat ? `TVA ${d.clientVat}` : "",
    d.clientEmail,
  ]
    .filter(Boolean)
    .map((l) => `<div>${esc(l)}</div>`)
    .join("");

  const itemRows =
    d.items
      .map((it) => {
        const lineHT = (it.qty || 0) * (it.unit || 0);
        return `<tr><td>${esc(it.label || "—")}</td><td class="num">${fmtQty(it.qty)}</td><td class="num">${euro2(
          it.unit,
        )}</td><td class="num">${euro2(lineHT)}</td></tr>`;
      })
      .join("") || `<tr><td colspan="4" class="muted">Aucune ligne</td></tr>`;

  const vatBlock = d.franchise
    ? `<div class="tr muted">TVA non applicable, art. 293 B du CGI</div>`
    : `<div class="tr"><span>TVA (${fmtRate(d.vatRate)} %)</span><span>${euro2(totals.tva)}</span></div>`;

  const bankBlock = bank
    ? `<div class="block"><div class="block-t">Coordonnées bancaires</div>
       <div class="muted">${esc(bank.holder || issuer.name)}${bank.bank ? " · " + esc(bank.bank) : ""}</div>
       <div class="muted">IBAN ${esc(bank.iban)}${bank.bic ? " · BIC " + esc(bank.bic) : ""}</div></div>`
    : "";

  const notesBlock =
    d.notes && d.notes.trim()
      ? `<div class="block"><div class="block-t">Notes</div><div class="muted">${esc(d.notes)}</div></div>`
      : "";

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Facture ${esc(ref)}</title>
<style>
*{box-sizing:border-box}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,Arial,sans-serif;color:#18181b;max-width:820px;margin:0 auto;padding:44px 40px;background:#fff;font-size:13px;line-height:1.5}
h1{font-size:26px;letter-spacing:-.5px;margin:0}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-bottom:28px}
.brand{font-size:16px;font-weight:700;margin-bottom:4px}
.muted{color:#71717a}
.faint{color:#a1a1aa;font-size:11px}
.right{text-align:right}
.ref{margin-top:6px;font-size:12px}
.badge{display:inline-block;margin-top:8px;padding:4px 11px;border-radius:20px;background:#eef2ff;color:#4338ca;font-size:11px;font-weight:700}
.cols{display:flex;gap:24px;margin:18px 0 8px}
.col{flex:1}
.col-t{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#a1a1aa;font-weight:700;margin-bottom:6px}
.name{font-weight:600;font-size:14px;margin-bottom:2px}
table{width:100%;border-collapse:collapse;margin-top:20px}
th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#a1a1aa;border-bottom:2px solid #18181b;padding:8px 6px}
td{padding:10px 6px;border-bottom:1px solid #ececef;font-size:13px}
.num{text-align:right;white-space:nowrap}
.totals{margin-top:16px;margin-left:auto;width:280px}
.tr{display:flex;justify-content:space-between;padding:6px 0;font-size:13px}
.tr.total{border-top:2px solid #18181b;margin-top:6px;padding-top:10px;font-size:17px;font-weight:700}
.block{margin-top:22px}
.block-t{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#a1a1aa;font-weight:700;margin-bottom:5px}
.legal{margin-top:34px;border-top:1px solid #ececef;padding-top:14px;font-size:10.5px;color:#a1a1aa;line-height:1.6}
@media print{body{padding:0}}
</style></head><body>
<div class="top">
  <div><div class="brand">${esc(issuer.name)}</div><div class="faint">${issuerLegal}</div></div>
  <div class="right"><h1>FACTURE</h1><div class="ref muted">N° ${esc(ref)}</div>
  <div class="ref muted">Émise le ${frDate(d.issueDate)}</div>
  <div class="ref muted">Échéance : ${frDate(d.dueDate)}</div>
  <span class="badge">${esc(statusLabel)}</span></div>
</div>

<div class="cols">
  <div class="col"><div class="col-t">Facturé à</div>
    <div class="name">${esc(d.clientName || brand)}</div>
    <div class="faint">${clientLegal}</div>
  </div>
  <div class="col"><div class="col-t">Prestation</div>
    <div class="name">${esc(brand)}</div>
    ${creator ? `<div class="muted">Créateur : ${esc(titleCase(creator))}</div>` : ""}
  </div>
</div>

<table>
  <thead><tr><th>Désignation</th><th class="num">Qté</th><th class="num">PU HT</th><th class="num">Total HT</th></tr></thead>
  <tbody>${itemRows}</tbody>
</table>

<div class="totals">
  <div class="tr"><span>Total HT</span><span>${euro2(totals.ht)}</span></div>
  ${vatBlock}
  <div class="tr total"><span>Total TTC</span><span>${euro2(totals.ttc)}</span></div>
</div>

${bankBlock}
${notesBlock}

<div class="legal">
  Conditions de règlement : paiement à réception, échéance le ${frDate(d.dueDate)}, par virement bancaire.
  En cas de retard de paiement, application de pénalités égales à trois fois le taux d'intérêt légal, ainsi qu'une
  indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 et D441-5 du Code de commerce).
  Pas d'escompte pour paiement anticipé.${d.franchise ? " TVA non applicable, art. 293 B du CGI." : ""}
  <br>Document généré par TTP Suite.
</div>
</body></html>`;
}

// ─── Petits composants ───────────────────────────────────────────────────────

function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div
        className={cn(
          "my-2 w-full rounded-2xl border border-border bg-card shadow-2xl",
          wide ? "max-w-3xl" : "max-w-lg",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

const primaryBtn =
  "rounded-lg bg-primary px-4 py-2 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90";
const ghostBtn =
  "rounded-lg border border-border bg-surface px-4 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground";

// ─── Vue ─────────────────────────────────────────────────────────────────────

export function Facturation() {
  const [rows, setRows] = useState<Row[] | null>(() => getCache<Row[]>("invoices"));
  const [error, setError] = useState(false);
  const { query } = useSearch();
  const creators = useCreators();
  const live = useLiveKey();
  const { data: appData } = useAppState<AppState>();

  // Réglages persistés (blob agence)
  const [issuer, setIssuer] = useState<Issuer>(DEFAULT_ISSUER);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [details, setDetails] = useState<Record<string, Details>>({});
  const [commissions, setCommissions] = useState<Record<string, number>>({});
  const inited = useRef(false);

  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "Tous">("Tous");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [issuerDraft, setIssuerDraft] = useState<Issuer | null>(null);
  const [banksOpen, setBanksOpen] = useState(false);
  const [preview, setPreview] = useState<{ html: string; ref: string; email: string; brand: string } | null>(null);

  useEffect(() => {
    supabase
      .from("invoices")
      .select("id,ref,party,amount,date,status,creator,sort_order")
      .order("sort_order")
      .then(({ data, error }) => {
        if (error) setError(true);
        else {
          const list = (data as Row[]) ?? [];
          setCache("invoices", list);
          setRows(list);
        }
      });
  }, [live]);

  useEffect(() => {
    if (inited.current || !appData) return;
    inited.current = true;
    setIssuer((appData.invoiceIssuer as Issuer) ?? DEFAULT_ISSUER);
    setBanks((appData.invoiceBankAccounts as BankAccount[]) ?? []);
    setDetails((appData.invoiceDetails as Record<string, Details>) ?? {});
    setCommissions((appData.creatorCommission as Record<string, number>) ?? {});
  }, [appData]);


  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Impossible de charger la facturation.
      </div>
    );
  }
  if (!rows) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <AnimatedBadge status="loading" size="sm">Chargement…</AnimatedBadge>
      </div>
    );
  }

  const invoices = rows; // narrowed: Row[]

  // Taux de commission : la fiche roster (creators.commission) fait foi ; repli
  // sur l'ancien blob puis le défaut. → changer le % sur le roster met à jour les factures.
  const rosterCommission = commissionMap(creators);
  const commissionFor = (creator: string | null) =>
    creator
      ? rosterCommission[creator] ?? (commissions[creator] != null ? commissions[creator] : DEFAULT_COMMISSION)
      : DEFAULT_COMMISSION;

  const detailsFor = (r: Row): Details => {
    const existing = details[r.id];
    if (existing) return existing;
    // Seed depuis une facture "legacy" (montant simple)
    return {
      clientName: r.party,
      clientEmail: "",
      clientAddress: "",
      clientSiret: "",
      clientVat: "",
      issueDate: todayISO(),
      dueDate: r.date && r.date !== "—" ? r.date : todayISO(),
      items: [{ id: uid(), label: r.party || "Prestation", qty: 1, unit: parseAmount(r.amount) }],
      franchise: true,
      vatRate: 20,
      commissionRate: commissionFor(r.creator),
      bankId: banks[0]?.id ?? "",
      notes: "",
    };
  };

  const filtered = rows.filter(
    (r) => matchQuery(query, r.ref, r.party, r.creator, r.status) && (statusFilter === "Tous" || r.status === statusFilter),
  );
  const statusChips: { value: InvoiceStatus | "Tous"; label: string }[] = [{ value: "Tous", label: "Tous" }, ...STATUS_OPTIONS];

  // ── Éditeur ──
  function openCreate() {
    setDraft({
      id: null,
      ref: `${new Date().getFullYear()}-${String(
        invoices.reduce((m, r) => Math.max(m, Number(String(r.ref).split("-").pop()) || 0), 180) + 1,
      ).padStart(3, "0")}`,
      brand: "",
      creator: "",
      status: "brouillon",
      clientName: "",
      clientEmail: "",
      clientAddress: "",
      clientSiret: "",
      clientVat: "",
      issueDate: todayISO(),
      dueDate: todayISO(),
      items: [{ id: uid(), label: "", qty: 1, unit: 0 }],
      franchise: true,
      vatRate: 20,
      commissionRate: DEFAULT_COMMISSION,
      bankId: banks[0]?.id ?? "",
      notes: "",
    });
  }

  function openEdit(r: Row) {
    const d = detailsFor(r);
    const brand = r.party.includes("×") ? r.party.split("×")[0].trim() : r.party;
    setDraft({ ...d, id: r.id, ref: r.ref, brand, creator: r.creator ?? "", status: r.status });
  }

  async function saveDraft() {
    if (!draft) return;
    if (!draft.brand.trim()) {
      toast("Renseigne la marque / campagne");
      return;
    }
    const t = totalsOf(draft.items, draft.franchise, draft.vatRate, draft.commissionRate);
    const party = draft.creator ? `${draft.brand.trim()} × ${firstName(draft.creator)}` : draft.brand.trim();
    const summary = {
      ref: draft.ref,
      party,
      amount: euro2(t.ttc),
      date: draft.dueDate || "—",
      status: draft.status,
      creator: draft.creator || null,
    };

    let id = draft.id;
    if (id) {
      if (!(await dbUpdate("invoices", id, summary))) {
        toast("Erreur — réessaie");
        return;
      }
      setRows(invoices.map((x) => (x.id === id ? { ...x, ...summary } : x)));
    } else {
      const created = await dbInsert("invoices", { ...summary, sort_order: nextOrder(invoices) });
      if (!created) {
        toast("Erreur — réessaie");
        return;
      }
      id = (created as unknown as Row).id;
      setRows([created as unknown as Row, ...invoices]);
    }

    // Détails riches (blob)
    const detailPart: Details = {
      clientName: draft.clientName,
      clientEmail: draft.clientEmail,
      clientAddress: draft.clientAddress,
      clientSiret: draft.clientSiret,
      clientVat: draft.clientVat,
      issueDate: draft.issueDate,
      dueDate: draft.dueDate,
      items: draft.items,
      franchise: draft.franchise,
      vatRate: draft.vatRate,
      commissionRate: draft.commissionRate,
      bankId: draft.bankId,
      notes: draft.notes,
    };
    // Relire FRAIS avant de fusionner : deux postes peuvent créer des factures en
    // parallèle → sinon l'instantané local périmé écrase les détails de l'autre.
    invalidateAppState();
    const freshState = await getAppState();
    const freshDetails = (freshState["invoiceDetails"] as Record<string, Details>) ?? {};
    const nextDetails = { ...freshDetails, [id]: detailPart };
    setDetails(nextDetails);
    const okDetails = await saveAppStateKey("invoiceDetails", nextDetails);

    // Mémorise la commission par créateur (même relecture fraîche)
    if (draft.creator) {
      const freshCom = (freshState["creatorCommission"] as Record<string, number>) ?? {};
      const nextCom = { ...freshCom, [draft.creator]: draft.commissionRate };
      setCommissions(nextCom);
      await saveAppStateKey("creatorCommission", nextCom);
    }

    if (!okDetails) {
      toast("Facture enregistrée, mais détails non synchronisés — réessaie");
      setDraft(null);
      return;
    }
    toast(draft.id ? "Facture modifiée ✓" : "Facture créée ✓");
    setDraft(null);
  }

  function buildHTML(r: Row): string {
    const d = detailsFor(r);
    const t = totalsOf(d.items, d.franchise, d.vatRate, d.commissionRate);
    const bank = banks.find((b) => b.id === d.bankId) ?? null;
    const brand = r.party.includes("×") ? r.party.split("×")[0].trim() : r.party;
    return invoiceHTML({ issuer, bank, details: d, ref: r.ref, brand, creator: r.creator, totals: t, statusLabel: STATUS_META[r.status].label });
  }

  function downloadInvoice(r: Row) {
    const blob = new Blob([buildHTML(r)], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `facture-${r.ref}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Facture téléchargée ✓ (ouvre-la puis Imprimer → PDF)");
  }

  function sendInvoice(r: Row) {
    const d = detailsFor(r);
    const t = totalsOf(d.items, d.franchise, d.vatRate, d.commissionRate);
    const subject = `Facture ${r.ref} — ${issuer.name}`;
    const body = [
      `Bonjour,`,
      ``,
      `Veuillez trouver ci-joint la facture ${r.ref} d'un montant de ${euro2(t.ttc)}.`,
      `Échéance : ${frDate(d.dueDate)}.`,
      ``,
      `Bien cordialement,`,
      issuer.name,
    ].join("\n");
    const to = encodeURIComponent(d.clientEmail || "");
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    // On télécharge aussi le PDF pour la pièce jointe
    downloadInvoice(r);
  }

  async function saveIssuer() {
    if (!issuerDraft) return;
    setIssuer(issuerDraft);
    const ok = await saveAppStateKey("invoiceIssuer", issuerDraft);
    setIssuerDraft(null);
    toast(ok ? "Émetteur enregistré ✓" : "Erreur — réessaie");
  }

  async function persistBanks(next: BankAccount[]) {
    setBanks(next);
    const ok = await saveAppStateKey("invoiceBankAccounts", next);
    if (!ok) toast("Erreur — réessaie");
  }

  const draftTotals = draft ? totalsOf(draft.items, draft.franchise, draft.vatRate, draft.commissionRate) : null;
  const creatorOptions = [{ value: "", label: "— Aucun —" }, ...creators.map((c) => ({ value: c.name, label: titleCase(c.name) }))];
  const bankOptions = [
    { value: "", label: banks.length ? "— Aucun compte —" : "— Ajoute un compte —" },
    ...banks.map((b) => ({ value: b.id, label: b.label || b.iban || "Compte" })),
  ];

  return (
    <>
      {/* En-tête */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {rows.length} facture{rows.length > 1 ? "s" : ""}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setBanksOpen(true)} className={cn(ghostBtn, "flex items-center gap-1.5")} title="Comptes bancaires">
            <Landmark className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Comptes</span>
          </button>
          <button type="button" onClick={() => setIssuerDraft(issuer)} className={cn(ghostBtn, "flex items-center gap-1.5")} title="Informations émetteur">
            <Settings2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Émetteur</span>
          </button>
          <AddButton label="Facture" onClick={openCreate} />
        </div>
      </div>

      {/* Filtres */}
      <div className="mb-4 flex flex-wrap gap-2">
        {statusChips.map((chip) => {
          const active = statusFilter === chip.value;
          return (
            <button
              key={chip.value}
              type="button"
              onClick={() => setStatusFilter(chip.value)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors",
                active ? "bg-primary text-primary-foreground" : "border border-border bg-surface text-muted-foreground hover:bg-rowhover hover:text-foreground",
              )}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {/* Liste */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface p-2 shadow-sm">
        <div className="hidden grid-cols-[0.8fr_2fr_1.1fr_1fr_1fr_1.4fr] gap-3 px-4 py-3 text-[9px] font-semibold uppercase tracking-wider text-faint md:grid">
          <span>Réf.</span>
          <span>Marque × Créateur</span>
          <span className="text-right">Montant TTC</span>
          <span className="text-center">Marge</span>
          <span className="text-center">Échéance</span>
          <span className="text-right">Statut</span>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <div className="text-sm font-medium text-foreground">Aucune facture</div>
            <div className="mt-1.5 text-xs text-faint">Crée ta première facture avec « + Facture ».</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {query.trim() ? `Aucun résultat pour « ${query} »` : "Aucune facture pour ce statut."}
          </div>
        ) : (
          filtered.map((r) => {
            const meta = STATUS_META[r.status];
            // Taux vivant depuis le roster (source unique) → une modif de commission se répercute ici.
            const rate = commissionFor(r.creator);
            const del = async () => {
              if (await dbTrash("invoices", r.id, r.party, formatEuro(parseAmount(r.amount)))) {
                setRows(invoices.filter((x) => x.id !== r.id));
                toast("Déplacé dans la corbeille");
              }
            };
            const menuItems: ActionItem[] = [
              { key: "edit", label: "Modifier", icon: Pencil, onClick: () => openEdit(r) },
              { key: "preview", label: "Aperçu", icon: Eye, onClick: () => setPreview({ html: buildHTML(r), ref: r.ref, email: detailsFor(r).clientEmail, brand: r.party }) },
              { key: "send", label: "Envoyer au client", icon: Send, onClick: () => sendInvoice(r) },
              { key: "download", label: "Télécharger", icon: Download, onClick: () => downloadInvoice(r) },
              { key: "delete", label: "Supprimer", icon: Trash2, danger: true, onClick: del, confirm: { title: "Supprimer la facture", message: `Supprimer la facture ${r.ref} (${r.party}) ? Cette action est irréversible.` } },
            ];
            const margeChip = (
              <span className="inline-block whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                Marge {fmtRate(rate)} %
              </span>
            );
            return (
              <div key={r.id} className="border-b border-border last:border-b-0">
                {/* Desktop : ligne type tableau */}
                <div className="hidden items-center gap-3 rounded-xl px-4 py-3 transition-colors hover:bg-rowhover md:grid md:grid-cols-[0.8fr_2fr_1.1fr_1fr_1fr_1.4fr]">
                  <span className="text-[11px] font-medium text-faint">#{r.ref}</span>
                  <span className="truncate text-sm font-medium text-foreground">{r.party}</span>
                  <span className="text-right text-sm font-semibold text-foreground">{formatEuro(parseAmount(r.amount))}</span>
                  <span className="text-center">{margeChip}</span>
                  <span className="text-center text-[11px] font-medium text-muted-foreground">{frDate(r.date)}</span>
                  <span className="flex items-center justify-end gap-2">
                    <AnimatedBadge status={meta.badge} size="sm">{meta.label}</AnimatedBadge>
                    <ActionMenu items={menuItems} />
                  </span>
                </div>

                {/* Mobile : carte compacte */}
                <div className="flex flex-col gap-2 px-3 py-3 md:hidden">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[10px] font-medium text-faint">
                        <FileText className="h-3 w-3" /> #{r.ref}
                      </div>
                      <div className="mt-0.5 truncate text-[15px] font-semibold text-foreground">{r.party}</div>
                    </div>
                    <AnimatedBadge status={meta.badge} size="sm">{meta.label}</AnimatedBadge>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-lg font-bold tracking-tight text-foreground">{formatEuro(parseAmount(r.amount))}</span>
                    {margeChip}
                  </div>
                  <div className="mt-0.5 flex items-center justify-between border-t border-border pt-2.5">
                    <span className="text-[11px] font-medium text-muted-foreground">Échéance · {frDate(r.date)}</span>
                    <ActionMenu items={menuItems} />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Éditeur de facture ── */}
      {draft && draftTotals && (
        <Modal
          title={draft.id ? `Modifier · ${draft.ref}` : `Nouvelle facture · ${draft.ref}`}
          onClose={() => setDraft(null)}
          wide
          footer={
            <>
              <button type="button" className={ghostBtn} onClick={() => setDraft(null)}>Annuler</button>
              <button type="button" className={primaryBtn} onClick={saveDraft}>Enregistrer</button>
            </>
          }
        >
          <div className="flex flex-col gap-5">
            {/* Marque / créateur / statut */}
            <div className="flex flex-wrap items-end gap-3">
              <TextField label="Marque / campagne" value={draft.brand} onChange={(v) => setDraft({ ...draft, brand: v })} className="min-w-[180px] flex-[2]" />
              <div className="min-w-[160px] flex-1">
                <SelectField
                  label="Créateur"
                  value={draft.creator}
                  onChange={(v) => setDraft({ ...draft, creator: v, commissionRate: v ? commissionFor(v) : draft.commissionRate })}
                  options={creatorOptions}
                />
              </div>
              <div className="min-w-[140px] flex-1">
                <SelectField label="Statut" value={draft.status} onChange={(v) => setDraft({ ...draft, status: v as InvoiceStatus })} options={STATUS_OPTIONS} />
              </div>
            </div>

            {/* Client */}
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-faint">Client (facturé à)</div>
              <div className="flex flex-wrap items-end gap-3">
                <TextField label="Nom / société" value={draft.clientName} onChange={(v) => setDraft({ ...draft, clientName: v })} className="min-w-[180px] flex-[2]" />
                <TextField label="Email" type="email" value={draft.clientEmail} onChange={(v) => setDraft({ ...draft, clientEmail: v })} className="min-w-[180px] flex-1" />
                <TextField label="Adresse" value={draft.clientAddress} onChange={(v) => setDraft({ ...draft, clientAddress: v })} className="min-w-full flex-[2]" />
                <TextField label="SIRET" value={draft.clientSiret} onChange={(v) => setDraft({ ...draft, clientSiret: v })} className="min-w-[150px] flex-1" />
                <TextField label="N° TVA" value={draft.clientVat} onChange={(v) => setDraft({ ...draft, clientVat: v })} className="min-w-[150px] flex-1" />
              </div>
            </div>

            {/* Dates + compte */}
            <div className="flex flex-wrap items-end gap-3">
              <TextField label="Date d'émission" type="date" value={draft.issueDate} onChange={(v) => setDraft({ ...draft, issueDate: v })} className="min-w-[150px] flex-1" />
              <TextField label="Échéance" type="date" value={draft.dueDate} onChange={(v) => setDraft({ ...draft, dueDate: v })} className="min-w-[150px] flex-1" />
              <div className="min-w-[180px] flex-1">
                <SelectField label="Compte bancaire" value={draft.bankId} onChange={(v) => setDraft({ ...draft, bankId: v })} options={bankOptions} />
              </div>
            </div>

            {/* Lignes / options */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">Lignes / options</div>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, items: [...draft.items, { id: uid(), label: "", qty: 1, unit: 0 }] })}
                  className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-rowhover"
                >
                  <Plus className="h-3.5 w-3.5" /> Ajouter une ligne
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {draft.items.map((it) => (
                  <div key={it.id} className="flex items-center gap-2">
                    <input
                      value={it.label}
                      onChange={(e) => setDraft({ ...draft, items: draft.items.map((x) => (x.id === it.id ? { ...x, label: e.target.value } : x)) })}
                      placeholder="Désignation (ex : Reel Instagram)"
                      className="min-w-0 flex-[3] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                    />
                    <input
                      value={String(it.qty)}
                      onChange={(e) => setDraft({ ...draft, items: draft.items.map((x) => (x.id === it.id ? { ...x, qty: num(e.target.value) } : x)) })}
                      inputMode="decimal"
                      placeholder="Qté"
                      className="w-16 shrink-0 rounded-lg border border-border bg-surface px-2 py-2 text-center text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                    />
                    <input
                      value={String(it.unit)}
                      onChange={(e) => setDraft({ ...draft, items: draft.items.map((x) => (x.id === it.id ? { ...x, unit: num(e.target.value) } : x)) })}
                      inputMode="decimal"
                      placeholder="PU HT"
                      className="w-24 shrink-0 rounded-lg border border-border bg-surface px-2 py-2 text-right text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                    />
                    <span className="w-24 shrink-0 text-right text-sm font-semibold text-foreground">{euro2((it.qty || 0) * (it.unit || 0))}</span>
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, items: draft.items.length > 1 ? draft.items.filter((x) => x.id !== it.id) : draft.items })}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-rose-500"
                      title="Supprimer la ligne"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* TVA + commission */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[190px] flex-1">
                <SelectField
                  label="TVA"
                  value={draft.franchise ? "franchise" : String(draft.vatRate)}
                  onChange={(v) => setDraft({ ...draft, franchise: v === "franchise", vatRate: v === "franchise" ? draft.vatRate : num(v) })}
                  options={VAT_OPTIONS}
                />
              </div>
              <div className="min-w-[170px] flex-1">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Commission agence (%)</span>
                  <input
                    value={String(draft.commissionRate)}
                    onChange={(e) => setDraft({ ...draft, commissionRate: num(e.target.value) })}
                    inputMode="decimal"
                    className="h-[42px] w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                  />
                </label>
              </div>
            </div>

            {/* Notes */}
            <label className="flex flex-col gap-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Notes (facultatif)</span>
              <textarea
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                rows={2}
                className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </label>

            {/* Récap */}
            <div className="rounded-xl border border-border bg-panel p-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-4">
                <div><div className="text-[9px] font-semibold uppercase tracking-wide text-faint">Total HT</div><div className="mt-0.5 font-semibold text-foreground">{euro2(draftTotals.ht)}</div></div>
                <div><div className="text-[9px] font-semibold uppercase tracking-wide text-faint">{draft.franchise ? "TVA" : `TVA ${fmtRate(draft.vatRate)}%`}</div><div className="mt-0.5 font-semibold text-foreground">{draft.franchise ? "—" : euro2(draftTotals.tva)}</div></div>
                <div><div className="text-[9px] font-semibold uppercase tracking-wide text-faint">Total TTC</div><div className="mt-0.5 font-bold text-primary">{euro2(draftTotals.ttc)}</div></div>
                <div><div className="text-[9px] font-semibold uppercase tracking-wide text-faint">Marge agence · {fmtRate(draft.commissionRate)}%</div><div className="mt-0.5 font-semibold text-signaltext">{euro2(draftTotals.commission)}</div></div>
              </div>
              {draft.creator && (
                <div className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
                  Reversé à {firstName(draft.creator)} : <span className="font-semibold text-foreground">{euro2(draftTotals.reversal)}</span>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* ── Émetteur ── */}
      {issuerDraft && (
        <Modal
          title="Informations émetteur"
          onClose={() => setIssuerDraft(null)}
          footer={
            <>
              <button type="button" className={ghostBtn} onClick={() => setIssuerDraft(null)}>Annuler</button>
              <button type="button" className={primaryBtn} onClick={saveIssuer}>Enregistrer</button>
            </>
          }
        >
          <div className="flex flex-wrap items-end gap-3">
            <TextField label="Nom / dénomination" value={issuerDraft.name} onChange={(v) => setIssuerDraft({ ...issuerDraft, name: v })} className="min-w-[180px] flex-[2]" />
            <TextField label="Forme juridique / capital" value={issuerDraft.legalForm} onChange={(v) => setIssuerDraft({ ...issuerDraft, legalForm: v })} className="min-w-[180px] flex-1" />
            <TextField label="Adresse" value={issuerDraft.address} onChange={(v) => setIssuerDraft({ ...issuerDraft, address: v })} className="min-w-full flex-[2]" />
            <TextField label="SIRET" value={issuerDraft.siret} onChange={(v) => setIssuerDraft({ ...issuerDraft, siret: v })} className="min-w-[150px] flex-1" />
            <TextField label="RCS" value={issuerDraft.rcs} onChange={(v) => setIssuerDraft({ ...issuerDraft, rcs: v })} className="min-w-[130px] flex-1" />
            <TextField label="APE / NAF" value={issuerDraft.ape} onChange={(v) => setIssuerDraft({ ...issuerDraft, ape: v })} className="min-w-[120px] flex-1" />
            <TextField label="N° TVA intracom." value={issuerDraft.vat} onChange={(v) => setIssuerDraft({ ...issuerDraft, vat: v })} className="min-w-[150px] flex-1" />
            <TextField label="Email" type="email" value={issuerDraft.email} onChange={(v) => setIssuerDraft({ ...issuerDraft, email: v })} className="min-w-[170px] flex-1" />
            <TextField label="Téléphone" value={issuerDraft.phone} onChange={(v) => setIssuerDraft({ ...issuerDraft, phone: v })} className="min-w-[150px] flex-1" />
          </div>
          <p className="mt-3 text-[11px] text-faint">Ces informations apparaissent en en-tête de chaque facture (mentions légales obligatoires).</p>
        </Modal>
      )}

      {/* ── Comptes bancaires ── */}
      {banksOpen && (
        <Modal
          title="Comptes bancaires"
          onClose={() => setBanksOpen(false)}
          footer={<button type="button" className={primaryBtn} onClick={() => setBanksOpen(false)}>Terminé</button>}
        >
          <div className="flex flex-col gap-3">
            {banks.length === 0 && <p className="text-sm text-muted-foreground">Aucun compte — ajoute-en un pour pouvoir le sélectionner sur une facture.</p>}
            {banks.map((b) => (
              <div key={b.id} className="rounded-xl border border-border bg-surface p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <TextField label="Libellé" value={b.label} onChange={(v) => persistBanks(banks.map((x) => (x.id === b.id ? { ...x, label: v } : x)))} className="min-w-[140px] flex-1" />
                  <TextField label="Titulaire" value={b.holder} onChange={(v) => persistBanks(banks.map((x) => (x.id === b.id ? { ...x, holder: v } : x)))} className="min-w-[140px] flex-1" />
                  <TextField label="Banque" value={b.bank} onChange={(v) => persistBanks(banks.map((x) => (x.id === b.id ? { ...x, bank: v } : x)))} className="min-w-[120px] flex-1" />
                  <TextField label="IBAN" value={b.iban} onChange={(v) => persistBanks(banks.map((x) => (x.id === b.id ? { ...x, iban: v } : x)))} className="min-w-full flex-[2]" />
                  <TextField label="BIC" value={b.bic} onChange={(v) => persistBanks(banks.map((x) => (x.id === b.id ? { ...x, bic: v } : x)))} className="min-w-[120px] flex-1" />
                  <button
                    type="button"
                    onClick={() => persistBanks(banks.filter((x) => x.id !== b.id))}
                    className="grid h-[42px] w-10 shrink-0 place-items-center rounded-lg border border-border text-faint transition-colors hover:bg-rowhover hover:text-rose-500"
                    title="Supprimer le compte"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => persistBanks([...banks, { id: uid(), label: "", holder: issuer.name, bank: "", iban: "", bic: "" }])}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5 text-[12px] font-semibold text-primary transition-colors hover:bg-rowhover"
            >
              <Plus className="h-4 w-4" /> Ajouter un compte
            </button>
          </div>
        </Modal>
      )}

      {/* ── Aperçu facture ── */}
      {preview && (
        <Modal
          title={`Aperçu · ${preview.ref}`}
          onClose={() => setPreview(null)}
          wide
          footer={
            <>
              <button type="button" className={ghostBtn} onClick={() => setPreview(null)}>Fermer</button>
              <button
                type="button"
                className={cn(ghostBtn, "flex items-center gap-1.5")}
                onClick={() => {
                  const w = window.open("", "_blank");
                  if (w) {
                    w.document.write(preview.html);
                    w.document.close();
                    w.focus();
                    w.print();
                  } else toast("Autorise les pop-ups pour imprimer");
                }}
              >
                <FileText className="h-3.5 w-3.5" /> Imprimer / PDF
              </button>
            </>
          }
        >
          <iframe title={`Facture ${preview.ref}`} srcDoc={preview.html} className="h-[62vh] w-full rounded-lg border border-border bg-white" />
        </Modal>
      )}
    </>
  );
}
