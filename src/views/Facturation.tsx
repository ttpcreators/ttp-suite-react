import { peekInvoicePrefill, putInvoicePrefill, takeInvoicePrefill } from "@/lib/invoicePrefill";
import { addDaysISO, nextQuoteRef, quoteShownStatus, QUOTE_STATUS_LABEL, QUOTE_STATUS_OPTIONS, QUOTE_VALIDITY_DAYS, type QuoteShownStatus, type QuoteStatus } from "@/lib/quotes";
import { useSetNavSub } from "@/lib/navSub";
import { setCollabLink } from "@/lib/collabLinksDb";
import { CollabField, ObjectCollabLink } from "@/components/collab-links";
import { fmtDay, toISODate } from "@/lib/dates";
import { useStickyState } from "@/lib/useStickyState";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  FileText,
  Eye,
  Download,
  Pencil,
  Send,
  Plus,
  Trash2,
  Ban,
  Undo2,
  Settings2,
  Landmark,
  Wallet,
  AlertTriangle,
  X,
  EyeOff,
  ChevronRight,
  Check,
  FileSignature,
} from "@/components/icons";
import { StatsBento } from "@/components/ui/stats-bento";
import { supabase } from "@/lib/supabase";
import { useSearch, matchQuery } from "@/lib/search";
import { cn, titleCase } from "@/lib/utils";
import { parseDecimal, parseFxRate } from "@/lib/money";
import { parseAmount, formatEuro, useAppState, saveAppStateKey, mergeAppStateKey, listAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import type { AnimatedBadgeStatus } from "@/components/ui/be-ui-animated-badge";
import { dbInsert, dbUpdate, nextOrder } from "@/lib/db";
import { dbTrash } from "@/lib/trash";
import { toast } from "@/components/ui/toast";
import { AddButton, TextField, Field, Picker } from "@/components/ui/form";
import { Loader, Spin } from "@/components/ui/loader";
import { InvoiceSheet, EditorCard, EditorSection, ClientChip } from "@/components/invoice-editor";
import { ActionMenu, type ActionItem } from "@/components/ui/action-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FilterBar } from "@/components/ui/filter-bar";
import { PeriodFilter, periodsFrom, inPeriod, periodToRange, periodLabel } from "@/components/ui/period-filter";
import { fullMonthOf, rangeLabel } from "@/lib/dateRange";
import { useCreators } from "@/lib/useCreators";
import { commissionMap, rateFor } from "@/lib/commission";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";
import { CURRENCIES, eurRateOf, invoiceHT, invoiceTotals, totalsOf, type LineItem, type Totals } from "@/lib/invoice";
import { parisDay, readSettings } from "@/lib/compta";
import { printHtml } from "@/lib/printPdf";
import { docHead, pdfFileTitle, ttpLogoImg } from "@/lib/pdfDoc";
import { notifyCreator } from "@/lib/push";
import { PageHeaderRow } from "@/components/ui/page-header";
import { PhoneMenu } from "@/components/ui/phone-bar";
import { IosSheet, Overlay } from "@/components/mobile/ios-sheet";
import { useIsPhone } from "@/lib/iosUi";
import { CreatorPicker } from "@/components/ui/creator-picker";
import { isOverdueInvoice } from "@/lib/relance";

// ─── Types ───────────────────────────────────────────────────────────────────

type InvoiceStatus = "payee" | "attente" | "retard" | "brouillon" | "annulee";

type Row = {
  id: string;
  ref: string;
  party: string;
  amount: string;
  date: string;
  status: InvoiceStatus;
  creator: string | null;
  sort_order: number | null;
  /** Jour du passage en « Payée » (SQL 2026-11-01-factures-garde-fous.sql), sinon absent. */
  paid_at?: string | null;
};

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
  /** Référence TPO du client (ex. Tanke) — ex. « TPO20261470 ». Vide par défaut,
   *  saisie manuellement avant de générer la facture. */
  tpoRef: string;
  issueDate: string;
  dueDate: string;
  items: LineItem[];
  franchise: boolean;
  vatRate: number;
  commissionRate: number;
  bankId: string;
  notes: string;
  /** « commission » : facture de la commission de l'agence au créateur (page Compta). */
  kind?: "commission";
  /** Facture à la marque établie au nom et pour le compte du créateur (mandat de facturation). */
  onBehalf?: boolean;
  /** Devise de la facture (absente = EUR) et valeur d'une unité en euros, pour le CA et la commission. */
  currency?: string;
  fxRate?: number;
};

type Draft = Details & {
  id: string | null;
  ref: string;
  brand: string;
  creator: string;
  status: InvoiceStatus;
  /** Nouvelle facture : collab à relier à l'enregistrement (« Créer la facture » d'une collab, champ « Collab »). */
  collabId?: string;
  /** « devis » : l'éditeur travaille sur un devis (onglet Devis), pas une facture. */
  doc?: "devis";
  /** Statut du devis (le champ `status` reste celui d'une facture). */
  quoteStatus?: QuoteStatus;
  /** Facture créée depuis ce devis : il passe « Accepté » et pointe vers elle à l'enregistrement. */
  fromQuote?: string;
  /** Saisie brute des champs numériques (clé « id:qty », « id:unit », « commission ») :
   *  garde « 1250, » tel quel pendant la frappe, sinon la virgule disparaît. */
  raw?: Record<string, string>;
};

/** Devis enregistré (blob agence, clé `quotes`). `dueDate` y est la date de validité. */
type Quote = Details & {
  id: string;
  ref: string;
  brand: string;
  creator: string;
  status: QuoteStatus;
  createdAt: string;
  collabId?: string;
  /** Facture créée depuis ce devis. */
  invoiceId?: string;
  invoiceRef?: string;
};

// ─── Constantes ──────────────────────────────────────────────────────────────

const STATUS_META: Record<InvoiceStatus, { badge: AnimatedBadgeStatus; label: string }> = {
  payee: { badge: "success", label: "Payée" },
  attente: { badge: "warning", label: "En attente" },
  retard: { badge: "danger", label: "En retard" },
  brouillon: { badge: "neutral", label: "Brouillon" },
  annulee: { badge: "neutral", label: "Annulée" },
};

/** Accès SÛR au badge/libellé d'un statut. `invoices.status` n'a pas de contrainte
 *  CHECK en base → une valeur inconnue (legacy, import, saisie libre) est possible.
 *  Indexer STATUS_META en direct planterait alors le rendu de toute la page (le badge
 *  serait `undefined`). Repli neutre, comme les helpers défensifs d'Aperçu/CreatorSpace. */
function metaOf(status: string): { badge: AnimatedBadgeStatus; label: string } {
  return STATUS_META[status as InvoiceStatus] ?? { badge: "neutral", label: status || "—" };
}

/** Facture en retard : statut « retard », ou « En attente » dont l'échéance est passée.
 *  Règle UNIQUE de src/lib/relance.ts (page Relances, gains du créateur) : badge, filtre, compteur. */
const isLate = (r: { status: string; date: string | null }): boolean => isOverdueInvoice(r);
/** Statut AFFICHÉ (rien n'est enregistré) : « En attente » échue → « retard ». */
function shownStatusOf(r: { status: string; date: string | null }): string {
  return isLate(r) ? "retard" : r.status;
}
/** Badge AFFICHÉ : « En attente » dont l'échéance est passée s'affiche « En retard ». */
function shownMetaOf(r: { status: string; date: string | null }): { badge: AnimatedBadgeStatus; label: string } {
  return metaOf(shownStatusOf(r));
}

const STATUS_OPTIONS: { value: InvoiceStatus; label: string }[] = [
  { value: "brouillon", label: "Brouillon" },
  { value: "attente", label: "En attente" },
  { value: "payee", label: "Payée" },
  { value: "retard", label: "En retard" },
  { value: "annulee", label: "Annulée" },
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

/** Saisie numérique (quantité, prix, taux) : même lecture que les montants
 *  (« 1.500 » = 1500, « 1 250,50 » = 1250,5), cf. `parseAmount`. */
function num(s: unknown): number {
  return parseAmount(s);
}
/** Quantité : « 0,125 » reste 0,125 (une virgule = décimale, sans arrondi au centime). */
function qtyNum(s: unknown): number {
  return /^\s*\d+,\d+\s*$/.test(String(s ?? "")) ? (parseDecimal(s) ?? 0) : num(s);
}
/** Prochain numéro de facture à partir des réfs existantes (« AAAA-NNN »). */
function nextRefFrom(refs: string[]): string {
  const max = refs.reduce((m, ref) => Math.max(m, Number(String(ref).split("-").pop()) || 0), 180);
  return `${new Date().getFullYear()}-${String(max + 1).padStart(3, "0")}`;
}
/** Montant fr-FR à 2 décimales avec séparateur de milliers (« 1 273,00 € »).
 *  Les espaces fines insécables (U+202F) sont normalisées en U+00A0 : certaines
 *  polices/moteurs mobiles ne les affichent pas et collaient les milliers. */
const EURO2_FMT = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true });
function euro2(n: number): string {
  return EURO2_FMT.format(Number.isFinite(n) ? n : 0).replace(/[\u202f\s]/g, "\u00a0") + "\u00a0€";
}
/** À l'écran : « 922 € » quand le montant est rond, « 184,40 € » sinon. Les documents
 *  (HTML, PDF, mail) et le montant enregistré gardent euro2 (toujours deux décimales). */
function euroUi(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return Math.round(v * 100) % 100 === 0 ? euro2(v).replace(/,00(?=\u00a0€$)/, "") : euro2(v);
}
/** Montant dans la devise de la facture (euros : euro2). */
function money(n: number, currency?: string): string {
  const cur = (currency || "EUR").toUpperCase();
  if (cur === "EUR") return euro2(n);
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: cur, minimumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0).replace(/[\u202f]/g, "\u00a0");
}
function fmtRate(n: number): string {
  return String(n).replace(".", ",");
}
function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
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
  const t = String(iso ?? "").trim();
  if (!t || t === "—") return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`; // ISO "AAAA-MM-JJ" → "JJ/MM/AAAA"
  return t; // déjà lisible : on ne réinterprète pas (pas de new Date qui inverse jour/mois)
}
/** Date affichée dans l'écran (pas dans la facture) : format commun « 21 oct. ». */
const uiDate = (s: string) => fmtDay(toISODate(s)) || frDate(s);

/** Année + mois d'une date facture (ISO « AAAA-MM-JJ » ou fr « JJ/MM/AAAA »). */
function ymOf(iso: string): { y: number; m: number } | null {
  const t = String(iso ?? "").trim();
  let m = /^(\d{4})-(\d{2})/.exec(t);
  if (m) return { y: +m[1], m: +m[2] };
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t);
  if (m) return { y: +m[3], m: +m[2] };
  return null;
}

/** Empreinte d'un brouillon d'éditeur, pour savoir s'il reste des modifications non
 *  enregistrées (la saisie brute et l'id attribué à la création n'en font pas partie). */
function draftSnapshot(d: Draft): string {
  return JSON.stringify({ ...d, id: null, raw: undefined });
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
  /** Identité du créateur (facture au nom et pour le compte du créateur). */
  creatorLegal?: { address?: string | null; siren?: string | null } | null;
  /** « devis » : même document, titré Devis, avec la date de validité et le « Bon pour accord ». */
  doc?: "devis";
}): string {
  const { issuer, details: d, ref, brand, creator, totals } = o;
  const quote = o.doc === "devis";
  // Un devis ne se règle pas : pas de coordonnées bancaires.
  const bank = quote ? null : o.bank;
  // Mandat : le créateur est le vendeur, l'agence émet la facture pour son compte.
  const mandat = !!d.onBehalf && !!creator && d.kind !== "commission";
  const sellerName = mandat ? titleCase(creator as string) : issuer.name;
  const sellerLegal = mandat
    ? [o.creatorLegal?.address ?? "", o.creatorLegal?.siren ? `SIREN ${o.creatorLegal.siren}` : ""].filter(Boolean).map((l) => `<div>${esc(l)}</div>`).join("")
    : "";
  const mandatLine = mandat
    ? `${quote ? "Devis émis" : "Facture émise"} par ${issuer.name}${issuer.siret ? ` (SIRET ${issuer.siret})` : ""} au nom et pour le compte de ${titleCase(creator as string)}, en vertu d'un mandat de facturation.`
    : "";

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
        return `<tr><td>${esc(it.label || "—")}</td><td class="num">${fmtQty(it.qty)}</td><td class="num">${money(
          it.unit, d.currency,
        )}</td><td class="num">${money(lineHT, d.currency)}</td></tr>`;
      })
      .join("") || `<tr><td colspan="4" class="muted">Aucune ligne</td></tr>`;

  const line = (l: string, v: string, cls = "") =>
    `<div class="tr${cls}"><span>${l}</span><span class="lead"></span><span class="v">${v}</span></div>`;
  const vatBlock = d.franchise
    ? `<div class="tr note">TVA non applicable, art. 293 B du CGI</div>`
    : line(`TVA (${fmtRate(d.vatRate)} %)`, money(totals.tva, d.currency));

  const bankBlock = bank
    ? `<section class="sec"><h2>Coordonnées bancaires</h2>
       <div>${esc(bank.holder || issuer.name)}${bank.bank ? " · " + esc(bank.bank) : ""}</div>
       <div class="iban">IBAN ${esc(bank.iban)}${bank.bic ? " · BIC " + esc(bank.bic) : ""}</div></section>`
    : "";

  const notesBlock =
    d.notes && d.notes.trim()
      ? `<section class="sec"><h2>Notes</h2><div class="pre">${esc(d.notes)}</div></section>`
      : "";

  // Devis : cadre de signature du client (acceptation).
  const accordBlock = quote
    ? `<section class="sec accord"><h2>Bon pour accord</h2><div class="sign">
       <div>Date</div><div>Nom, signature et cachet du client, précédés de la mention « Bon pour accord »</div></div></section>`
    : "";
  const legalText = quote
    ? `Devis valable jusqu'au ${frDate(d.dueDate)}. Pour l'accepter, retournez-le daté et signé, précédé de la mention
  « Bon pour accord ». Les prestations acceptées seront facturées aux montants indiqués ci-dessus.${d.franchise ? " TVA non applicable, art. 293 B du CGI." : ""}`
    : `Conditions de règlement : paiement par virement au plus tard le ${frDate(d.dueDate)}.
  En cas de retard de paiement, application de pénalités égales à trois fois le taux d'intérêt légal, ainsi qu'une
  indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 et D441-5 du Code de commerce).
  Pas d'escompte pour paiement anticipé.${d.franchise ? " TVA non applicable, art. 293 B du CGI." : ""}`;

  const css = `
.parties{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6mm;margin-top:10mm}
.parties h3{margin:0 0 2.5mm;font-size:7pt;font-weight:600;letter-spacing:.24em;text-transform:uppercase;color:var(--grey)}
.parties .name{font-family:var(--serif);font-size:14pt;line-height:1.15;margin-bottom:1.5mm}
.parties .addr{font-size:8.2pt;line-height:1.55;color:var(--grey)}
.parties .tpo{margin-top:2mm;font-size:8.2pt}
.parties .tpo span{color:var(--grey)}
table.lines{width:100%;border-collapse:collapse;margin-top:10mm}
table.lines th{text-align:left;font-size:7pt;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--grey);
  padding:0 0 2.5mm;border-bottom:.8pt solid var(--ink)}
table.lines td{padding:3mm 0;border-bottom:.5pt solid var(--soft);font-size:9.6pt;vertical-align:top}
table.lines td+td,table.lines th+th{padding-left:5mm}
table.lines .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
table.lines tr{break-inside:avoid}
.totals{margin:6mm 0 0 auto;width:86mm;break-inside:avoid}
.tr{display:flex;align-items:baseline;gap:3mm;padding:1.6mm 0;font-size:9.6pt}
.tr .lead{flex:1;border-bottom:.7pt dotted var(--faint);transform:translateY(-.9mm)}
.tr .v{font-variant-numeric:tabular-nums;white-space:nowrap}
.tr.note{display:block;font-size:8.2pt;color:var(--grey)}
.tr.total{margin-top:2mm;padding-top:3mm;border-top:.8pt solid var(--ink);align-items:flex-end}
.tr.total span:first-child{font-size:7pt;font-weight:600;letter-spacing:.24em;text-transform:uppercase}
.tr.total .v{font-family:var(--serif);font-size:24pt;line-height:1;color:var(--accent)}
.iban{margin-top:1mm;font-variant-numeric:tabular-nums;letter-spacing:.02em}
.accord{break-inside:avoid}
.sign{display:grid;grid-template-columns:1fr 2fr;gap:5mm;margin-top:2mm}
.sign div{height:26mm;border:.5pt solid var(--soft);border-radius:2mm;padding:2.5mm 3mm;font-size:7.6pt;line-height:1.5;color:var(--grey)}
.legal{margin-top:10mm;padding-top:3.5mm;border-top:.5pt solid var(--soft);font-size:7.6pt;line-height:1.6;color:var(--faint)}
`;

  // Nom de fichier proposé : « Facture TTP-2026-004 - Nike x Sarah ». Aucun statut
  // (« En retard », « Payée »…) sur le document : c'est une info interne.
  const who = brand || d.clientName || "";
  const first = creator ? titleCase(creator).split(" ")[0].toLowerCase() : "";
  const withCreator = creator && !who.toLowerCase().includes(first) ? `${who} x ${titleCase(creator)}` : who;
  const fileTitle = pdfFileTitle(`${quote ? "Devis" : "Facture"} ${ref}`, withCreator);
  return `${docHead(fileTitle, css)}<body><div class="wrap">
<header class="mast"><span class="id">${ttpLogoImg(30)}<span><span class="wm">${esc(issuer.name)}</span></span></span>
<span class="r"><b>N° ${esc(ref)}</b></span></header>
<p class="kicker">${quote ? "Devis" : "Facture"}</p>
<h1>N° <i>${esc(ref)}</i></h1>
<dl class="meta">
  <div class="row"><dt>${quote ? "Émis le" : "Émise le"}</dt><span class="lead"></span><dd>${frDate(d.issueDate)}</dd></div>
  <div class="row"><dt>${quote ? "Valable jusqu'au" : "Échéance"}</dt><span class="lead"></span><dd>${frDate(d.dueDate)}</dd></div>
</dl>

<div class="parties">
  <div><h3>${mandat ? "Vendeur" : "Émetteur"}</h3><div class="name">${esc(sellerName)}</div><div class="addr">${mandat ? sellerLegal : issuerLegal}</div>
    ${mandat ? `<div class="addr" style="margin-top:2mm">Émise par ${esc(issuer.name)}, mandataire</div>` : ""}</div>
  <div><h3>${quote ? "Client" : "Facturé à"}</h3><div class="name">${esc(d.clientName || brand)}</div><div class="addr">${clientLegal}</div>
    ${d.tpoRef && d.tpoRef.trim() ? `<div class="tpo"><span>Réf. TPO</span> ${esc(d.tpoRef)}</div>` : ""}</div>
  <div><h3>Prestation</h3><div class="name">${d.kind === "commission" ? "Commission d'agence" : esc(brand)}</div>
    ${creator ? `<div class="addr">Créateur : ${esc(titleCase(creator))}</div>` : ""}</div>
</div>

<table class="lines">
  <thead><tr><th>Désignation</th><th class="num">Qté</th><th class="num">PU HT</th><th class="num">Total HT</th></tr></thead>
  <tbody>${itemRows}</tbody>
</table>

<div class="totals">
  ${line("Total HT", money(totals.ht, d.currency))}
  ${vatBlock}
  ${line("Total TTC", money(totals.ttc, d.currency), " total")}
</div>

${bankBlock}
${notesBlock}
${accordBlock}

<div class="legal">
  ${legalText}${mandatLine ? `<br>${esc(mandatLine)}` : ""}
  <br>Document généré par TTP Suite.
</div>
</div></body></html>`;
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
    <Overlay className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:p-6" onClose={onClose}>
      <div
        className={cn(
          "my-2 w-full rounded-2xl border border-border bg-card shadow-2xl",
          wide ? "max-w-3xl" : "max-w-lg",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">{footer}</div>}
      </div>
    </Overlay>
  );
}

const primaryBtn =
  "rounded-lg bg-primary px-4 py-2 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90";
const editorBtn =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-rowhover";
const editorPrimaryBtn =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60";
const ghostBtn =
  "rounded-lg border border-border bg-surface px-4 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground";

/**
 * Badge de statut cliquable (liste des factures) : un clic ouvre les 4 statuts. Le badge
 * montre le statut AFFICHÉ (« En retard » si l'échéance est passée) ; la coche, le statut
 * enregistré.
 */
function StatusPicker({ row, onPick }: { row: { status: string; date: string | null }; onPick: (s: InvoiceStatus) => void }) {
  const [open, setOpen] = useState(false);
  const meta = shownMetaOf(row);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" onClick={(e) => e.stopPropagation()} title="Changer le statut" aria-label={`Statut : ${meta.label}. Changer`} className="rounded-full transition-opacity hover:opacity-80">
          <AnimatedBadge status={meta.badge} size="sm">{meta.label}</AnimatedBadge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1" onClick={(e) => e.stopPropagation()}>
        {STATUS_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => {
              setOpen(false);
              if (o.value !== row.status) onPick(o.value);
            }}
            className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-rowhover"
          >
            {o.label}
            {o.value === row.status && <Check className="h-3.5 w-3.5 text-primary" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

const QUOTE_BADGE: Record<QuoteShownStatus, AnimatedBadgeStatus> = {
  brouillon: "neutral",
  envoye: "info",
  accepte: "success",
  refuse: "neutral",
  expire: "warning",
};

/** Badge de statut d'un devis, cliquable comme celui des factures (« Expiré » est calculé, pas choisi). */
function QuoteStatusPicker({ status, shown, onPick }: { status: QuoteStatus; shown: QuoteShownStatus; onPick: (s: QuoteStatus) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" onClick={(e) => e.stopPropagation()} title="Changer le statut" aria-label={`Statut : ${QUOTE_STATUS_LABEL[shown]}. Changer`} className="rounded-full transition-opacity hover:opacity-80">
          <AnimatedBadge status={QUOTE_BADGE[shown]} size="sm">{QUOTE_STATUS_LABEL[shown]}</AnimatedBadge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1" onClick={(e) => e.stopPropagation()}>
        {QUOTE_STATUS_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => {
              setOpen(false);
              if (o.value !== status) onPick(o.value);
            }}
            className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-rowhover"
          >
            {o.label}
            {o.value === status && <Check className="h-3.5 w-3.5 text-primary" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Détails enregistrés d'une facture ou d'un devis (sans le numéro, la marque ni le statut). */
function detailPartOf(draft: Draft): Details {
  return {
    clientName: draft.clientName,
    clientEmail: draft.clientEmail,
    clientAddress: draft.clientAddress,
    clientSiret: draft.clientSiret,
    clientVat: draft.clientVat,
    tpoRef: draft.tpoRef,
    issueDate: draft.issueDate,
    dueDate: draft.dueDate,
    items: draft.items,
    franchise: draft.franchise,
    vatRate: draft.vatRate,
    commissionRate: draft.commissionRate,
    bankId: draft.bankId,
    notes: draft.notes,
    ...(draft.kind === "commission" ? { kind: "commission" as const } : {}),
    ...(draft.kind !== "commission" && draft.onBehalf !== undefined ? { onBehalf: draft.onBehalf } : {}),
    ...(draft.currency && draft.currency !== "EUR" ? { currency: draft.currency, fxRate: draft.fxRate } : {}),
  };
}

/**
 * Nouvelle facture vide (brouillon). TVA : le régime de la page Compta (franchise par défaut,
 * modifiable par facture). Échéance : 30 jours après l'émission, jamais le jour même (une
 * facture préparée d'avance passait « en retard » avant même la livraison).
 */
function blankDraft(refs: string[], bankId: string, franchise = true): Draft {
  return {
    id: null,
    ref: nextRefFrom(refs),
    brand: "",
    creator: "",
    status: "brouillon",
    clientName: "",
    clientEmail: "",
    clientAddress: "",
    clientSiret: "",
    clientVat: "",
    tpoRef: "",
    issueDate: todayISO(),
    dueDate: addDaysISO(todayISO(), 30),
    items: [{ id: uid(), label: "", qty: 1, unit: 0 }],
    franchise,
    vatRate: 20,
    commissionRate: DEFAULT_COMMISSION,
    bankId,
    notes: "",
  };
}

// ─── Vue ─────────────────────────────────────────────────────────────────────

/** Onglet Devis de la page Facturation : même écran, sur les devis. */
export function Devis() {
  return <Facturation mode="devis" />;
}

export function Facturation({ mode = "factures" }: { mode?: "factures" | "devis" } = {}) {
  const quoteMode = mode === "devis";
  const setNavSub = useSetNavSub();
  const [rows, setRows] = useState<Row[] | null>(() => getCache<Row[]>("invoices"));
  const [error, setError] = useState(false);
  const { query } = useSearch();
  const creators = useCreators();
  const live = useLiveKey();
  const { data: appData } = useAppState<AppState>();
  // Identité des créateurs (adresse, SIREN) : vendeur d'une facture faite au nom du créateur (mandat).
  const [creatorLegal, setCreatorLegal] = useState<Record<string, { address: string | null; siren: string | null }>>({});
  useEffect(() => {
    let alive = true;
    void supabase.from("creators").select("name,address,siren").then(({ data }) => {
      if (!alive || !data) return;
      setCreatorLegal(Object.fromEntries((data as { name: string; address: string | null; siren: string | null }[]).map((c) => [c.name.trim().toLowerCase(), { address: c.address, siren: c.siren }])));
    });
    return () => {
      alive = false;
    };
  }, []);
  const legalOf = (creator: string | null | undefined) => (creator ? creatorLegal[creator.trim().toLowerCase()] ?? null : null);

  // Réglages persistés (blob agence)
  const [issuer, setIssuer] = useState<Issuer>(DEFAULT_ISSUER);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [details, setDetails] = useState<Record<string, Details>>({});
  const [commissions, setCommissions] = useState<Record<string, number>>({});
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const inited = useRef(false);

  const [statusFilter, setStatusFilter] = useStickyState<InvoiceStatus | "Tous">("facturation:statut", ["Tous", "brouillon", "attente", "payee", "retard", "annulee"], "Tous");
  const [quoteFilter, setQuoteFilter] = useStickyState<QuoteShownStatus | "Tous">("devis:statut", ["Tous", "brouillon", "envoye", "accepte", "refuse", "expire"], "Tous");
  const [period, setPeriod] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [issuerDraft, setIssuerDraft] = useState<Issuer | null>(null);
  const [banksOpen, setBanksOpen] = useState(false);
  // Brouillon local des comptes : enregistré à la fermeture, pas à chaque frappe
  const [banksDraft, setBanksDraft] = useState<BankAccount[]>([]);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false); // garde synchrone contre le double clic
  // Comptes bancaires : après un échec d'enregistrement, fermer (croix, Échap) annule au lieu de bloquer.
  const banksFailed = useRef(false);
  const [preview, setPreview] = useState<{ html: string; ref: string; email: string; brand: string } | null>(null);
  // Fiche « marge » ouverte au clic sur une facture (détail HT / TVA / commission).
  const [finView, setFinView] = useState<Row | null>(null);
  // Éditeur en page : relecture en cours, empreinte du dernier état enregistré (pour
  // « Modifications non enregistrées »), confirmation de sortie, aperçu affiché ou non.
  const [editorLoading, setEditorLoading] = useState(false);
  const [baseline, setBaseline] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [mobilePreview, setMobilePreview] = useState(false);
  const editorTop = useRef<HTMLDivElement>(null);
  const editing = draft !== null || editorLoading;
  const phone = useIsPhone();
  // Ouvrir l'éditeur (ou revenir à la liste) remonte en haut de la page (pas à l'arrivée sur la page).
  const editingSeen = useRef(editing);
  useEffect(() => {
    if (editingSeen.current === editing) return;
    editingSeen.current = editing;
    editorTop.current?.scrollIntoView({ block: "start" });
  }, [editing]);

  useEffect(() => {
    supabase
      .from("invoices")
      .select("*")
      .order("sort_order")
      .then(({ data, error }) => {
        if (error) setError(true);
        else {
          setError(false);
          const list = (data as Row[]) ?? [];
          setCache("invoices", list);
          setRows(list);
        }
      });
  }, [live]);

  // Réglages et détails suivis À CHAQUE rafraîchissement : une facture créée sur un autre
  // poste après l'ouverture de la page a ses vrais détails (PDF, aperçu, modification),
  // jamais des valeurs par défaut. Les saisies en cours vivent dans des brouillons à part.
  useEffect(() => {
    if (!appData) return;
    inited.current = true;
    setIssuer((appData.invoiceIssuer as Issuer) ?? DEFAULT_ISSUER);
    setBanks((appData.invoiceBankAccounts as BankAccount[]) ?? []);
    setDetails((appData.invoiceDetails as Record<string, Details>) ?? {});
    setCommissions((appData.creatorCommission as Record<string, number>) ?? {});
    setQuotes(Array.isArray(appData.quotes) ? (appData.quotes as Quote[]) : []);
  }, [appData]);

  // Préparé ailleurs : « Créer le devis » (Tarifs) → nouveau devis ; « Créer la facture » (collab,
  // Compta) ou « Transformer en facture » (devis accepté) → nouvelle facture. Rien n'est encore
  // enregistré (quitter sans enregistrer demande confirmation). Ce qui est préparé pour l'autre
  // onglet (Devis / Factures) y est envoyé sans être lu ici.
  // Le roster doit être lu : le taux de commission vient de la fiche du créateur (sinon la
  // facture partait au taux par défaut, et Reversements suit le taux DE LA FACTURE).
  useEffect(() => {
    if (!rows || !appData || !creators.length) return;
    const peek = peekInvoicePrefill();
    if (!peek) return;
    if ((peek.doc === "devis") !== quoteMode) {
      setNavSub(peek.doc === "devis" ? "devis" : "factures");
      return;
    }
    const p = takeInvoicePrefill();
    if (!p) return;
    const blank = blankDraft(rows.map((r) => r.ref), ((appData.invoiceBankAccounts as BankAccount[]) ?? [])[0]?.id ?? "", readSettings(appData.comptaSettings).vatRegime !== "assujetti");
    const lines = p.lines.map((l) => ({ id: uid(), label: l.label, qty: 1, unit: l.unit }));
    const commissionRate = p.kind === "commission"
      ? 0 // la commission ne prend pas de commission
      : p.commissionRate != null
        ? p.commissionRate
        : p.creator
        ? rateFor(p.creator, commissionMap(creators), (appData.creatorCommission as Record<string, number>) ?? {}, DEFAULT_COMMISSION)
        : blank.commissionRate;
    const base: Draft = quoteMode
      ? { ...blank, ref: nextQuoteRef(((appData.quotes as Quote[]) ?? []).map((q) => q.ref)), dueDate: addDaysISO(todayISO(), QUOTE_VALIDITY_DAYS), doc: "devis", quoteStatus: "brouillon" }
      : blank;
    const fromQuote = p.details
      ? { ...p.details, items: p.details.items.map((it) => ({ ...it, id: uid() })), ...(p.fromQuote ? { fromQuote: p.fromQuote } : {}) }
      : null;
    setDraft({
      ...base, creator: p.creator, brand: p.brand, commissionRate, items: lines.length ? lines : base.items,
      ...(p.collabId ? { collabId: p.collabId } : {}),
      ...(p.kind === "commission" ? { kind: "commission" as const, clientName: p.brand } : {}),
      ...(p.franchise !== undefined ? { franchise: p.franchise } : {}),
      ...(p.onBehalf !== undefined ? { onBehalf: p.onBehalf } : {}),
      ...(p.currency && p.currency !== "EUR" ? { currency: p.currency } : {}),
      ...(fromQuote ?? {}),
    });
    setBaseline(draftSnapshot(base));
    setConfirmLeave(false);
  }, [rows, appData, creators, quoteMode, setNavSub]);


  // Erreur seulement si rien n'est chargé : un raté de rafraîchissement garde la liste.
  if (error && !rows) {
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
  const commissionFor = (creator: string | null) => rateFor(creator, rosterCommission, commissions, DEFAULT_COMMISSION);

  const detailsFor = (r: Row): Details => {
    const existing = details[r.id];
    // Défaut `tpoRef` : les blobs legacy n'ont pas ce champ (ajouté après coup).
    if (existing) return { ...existing, tpoRef: existing.tpoRef ?? "" };
    // Seed depuis une facture "legacy" (montant simple)
    return {
      clientName: r.party,
      clientEmail: "",
      clientAddress: "",
      clientSiret: "",
      clientVat: "",
      tpoRef: "",
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

  const periods = periodsFrom(rows.map((r) => r.date));
  const filtered = rows.filter(
    (r) => matchQuery(query, r.ref, r.party, r.creator, r.status) && (statusFilter === "Tous" || shownStatusOf(r) === statusFilter) && inPeriod(r.date, period),
  );
  const statusChips: { value: InvoiceStatus | "Tous"; label: string }[] = [{ value: "Tous", label: "Tous" }, ...STATUS_OPTIONS];

  // ── Synthèse (bento) : suit le filtre Période (pas le Statut : c'est une ventilation par statut).
  // Sans période : encaissé de l'année + mois courant, impayés sur TOUTES les factures.
  const periodRange = periodToRange(period);
  const focusYm = periodRange ? fullMonthOf(periodRange) : null; // période = un mois entier ?
  const scope = period ? invoices.filter((r) => inPeriod(r.date, period)) : invoices;
  const nowY = new Date().getFullYear();
  const nowM = new Date().getMonth() + 1;
  const bentoY = focusYm ? Number(focusYm.slice(0, 4)) : periodRange ? Number(periodRange.to.slice(0, 4)) : nowY;
  const bentoM = focusYm ? Number(focusYm.slice(5, 7)) : nowM;
  const periodName = periodRange ? rangeLabel(periodRange) : "";
  // Mois de l'encaissement : jour du passage en « Payée » (paid_at) ; anciennes factures sans
  // cette date : l'échéance, et si elle est illisible (« 01/10 » sans année) la date d'émission.
  const ymPaid = (r: Row) => (r.paid_at ? ymOf(parisDay(r.paid_at) ?? "") : null) ?? ymOf(r.date) ?? ymOf(details[r.id]?.issueDate ?? "");
  const paidScope = scope.filter((r) => r.status === "payee" && (period ? true : ymPaid(r)?.y === nowY));
  // Chiffre d'affaires en HORS TAXES (choix de Marc, 2026-10-25) : la TVA est due à l'État.
  const htOf = (r: Row) => invoiceHT(parseAmount(r.amount), details[r.id]);
  const encaisse = paidScope.reduce((s, r) => s + htOf(r), 0);
  const monthly = Array.from({ length: 12 }, (_, i) =>
    paidScope.filter((r) => ymPaid(r)?.y === bentoY && ymPaid(r)?.m === i + 1).reduce((s, r) => s + htOf(r), 0),
  );
  // Barre « ce mois » : le mois choisi, sinon le mois courant ; plage libre = total par mois de l'année.
  const barsLabel = focusYm ? `Encaissé HT · ${periodLabel(focusYm).toLowerCase()}` : periodRange ? `Encaissé HT par mois · ${bentoY}` : "Encaissé HT ce mois";
  const barsValue = periodRange && !focusYm ? monthly.reduce((s, v) => s + v, 0) : (monthly[bentoM - 1] ?? 0);
  // ── Marge agence : commission calculée sur le HT (jamais sur la TVA), séparée du TTC.
  // Facture détaillée → lignes + TVA + taux de la facture ; ancienne facture sans
  // détail → montant enregistré considéré HT (franchise), taux du roster. Seuil 100 € inclus.
  const finOf = (r: Row): Totals & { rate: number } => {
    // Même calcul que Reversements et les gains du créateur (src/lib/invoice.ts).
    const t = invoiceTotals(parseAmount(r.amount), details[r.id], commissionFor(r.creator));
    // Facture de commission au créateur : tout le HT revient à l'agence, rien au créateur.
    return details[r.id]?.kind === "commission" ? { ...t, commission: t.ht, reversal: 0 } : t;
  };
  // Synthèse sur la période (brouillons exclus : ce n'est pas encore facturé).
  const billed = scope.filter((r) => r.status !== "brouillon" && r.status !== "annulee");
  const sumFin = (list: Row[]) =>
    list.reduce((a, r) => {
      const f = finOf(r);
      return { ht: a.ht + f.ht, tva: a.tva + f.tva, ttc: a.ttc + f.ttc, commission: a.commission + f.commission, reversal: a.reversal + f.reversal };
    }, { ht: 0, tva: 0, ttc: 0, commission: 0, reversal: 0 });
  const finBilled = sumFin(billed);
  const finPaid = sumFin(billed.filter((r) => r.status === "payee"));
  const margePct = finBilled.ht > 0 ? (finBilled.commission / finBilled.ht) * 100 : 0;
  const unpaid = scope.filter((r) => r.status === "attente" || r.status === "retard");
  const aEncaisser = unpaid.reduce((s, r) => s + parseAmount(r.amount), 0);
  const nbRetard = scope.filter(isLate).length; // même règle que le badge « En retard »

  // ── Éditeur ──
  function openCreate() {
    const compta = readSettings(appData?.comptaSettings);
    const base: Draft = { ...blankDraft(invoices.map((r) => r.ref), banks[0]?.id ?? "", compta.vatRegime !== "assujetti"), onBehalf: compta.facturation === "mandat" };
    const d: Draft = quoteMode
      ? { ...base, ref: nextQuoteRef(quotes.map((q) => q.ref)), dueDate: addDaysISO(todayISO(), QUOTE_VALIDITY_DAYS), doc: "devis", quoteStatus: "brouillon" }
      : base;
    setDraft(d);
    setBaseline(draftSnapshot(d));
    setConfirmLeave(false);
  }

  // Ouvre la modification sur les détails RELUS à l'instant (jamais sur une copie périmée
  // ou pas encore chargée : enregistrer écraserait les vraies lignes de la facture).
  async function openEdit(r: Row) {
    if (editorLoading) return;
    setEditorLoading(true);
    setConfirmLeave(false);
    let fresh: Record<string, Details>;
    try {
      invalidateAppState();
      fresh = ((await getAppState())["invoiceDetails"] as Record<string, Details>) ?? {};
    } catch {
      setEditorLoading(false);
      toast("Lecture impossible : réessaie dans un instant");
      return;
    }
    setDetails(fresh);
    const existing = fresh[r.id];
    const d = existing ? { ...existing, tpoRef: existing.tpoRef ?? "" } : detailsFor(r);
    const party = r.party ?? "";
    const brand = party.includes("×") ? party.split("×")[0].trim() : party;
    const next: Draft = { ...d, id: r.id, ref: r.ref, brand, creator: r.creator ?? "", status: r.status };
    setDraft(next);
    setBaseline(draftSnapshot(next));
    setEditorLoading(false);
  }

  /** Retour à la liste. Avec des modifications non enregistrées, on demande d'abord. */
  function closeEditor(force = false) {
    if (!force && draft && draftSnapshot(draft) !== baseline) {
      setConfirmLeave(true);
      return;
    }
    setConfirmLeave(false);
    setMobilePreview(false);
    setDraft(null);
  }

  // ── Devis ──
  /** Ouvre un devis sur sa version RELUE à l'instant (un autre poste a pu le modifier). */
  async function openEditQuote(q: Quote) {
    if (editorLoading) return;
    setEditorLoading(true);
    setConfirmLeave(false);
    let fresh: Quote | undefined;
    try {
      invalidateAppState();
      fresh = ((await getAppState())["quotes"] as Quote[] | undefined)?.find((x) => x.id === q.id);
    } catch {
      setEditorLoading(false);
      toast("Lecture impossible : réessaie dans un instant");
      return;
    }
    const src = fresh ?? q;
    const next: Draft = { ...src, tpoRef: src.tpoRef ?? "", status: "brouillon", doc: "devis", quoteStatus: src.status };
    setDraft(next);
    setBaseline(draftSnapshot(next));
    setEditorLoading(false);
  }

  /** Enregistre un devis (entrée par entrée dans le blob agence : un autre poste ne perd pas le sien). */
  async function doSaveQuote(draft: Draft) {
    const isNew = !draft.id;
    invalidateAppState();
    let freshQuotes: Quote[];
    try {
      freshQuotes = ((await getAppState())["quotes"] as Quote[] | undefined) ?? [];
    } catch {
      toast("Erreur, réessaie");
      return;
    }
    const prev = draft.id ? freshQuotes.find((x) => x.id === draft.id) : undefined;
    const quote: Quote = {
      ...detailPartOf(draft),
      id: draft.id ?? `q${uid()}`,
      // Numéro recalculé juste avant la création (deux postes en même temps : pas de doublon).
      ref: isNew ? nextQuoteRef(freshQuotes.map((x) => x.ref)) : draft.ref,
      brand: draft.brand.trim(),
      creator: draft.creator,
      status: draft.quoteStatus ?? "brouillon",
      createdAt: prev?.createdAt ?? todayISO(),
      ...(draft.collabId ? { collabId: draft.collabId } : {}),
      ...(prev?.invoiceId ? { invoiceId: prev.invoiceId, invoiceRef: prev.invoiceRef } : {}),
    };
    if (!(await listAppStateKey("quotes", [quote], [], true))) {
      toast("Erreur, réessaie");
      return;
    }
    setQuotes((list) => (list.some((x) => x.id === quote.id) ? list.map((x) => (x.id === quote.id ? quote : x)) : [quote, ...list]));
    toast(isNew ? `Devis ${quote.ref} créé ✓` : "Devis modifié ✓");
    setConfirmLeave(false);
    setMobilePreview(false);
    setDraft(null);
  }

  /** Change un seul champ d'un devis enregistré (statut…), affiché tout de suite, annulé si la base refuse. */
  async function patchQuote(q: Quote, patch: Partial<Quote>, okMsg?: string) {
    const next = { ...q, ...patch };
    setQuotes((list) => list.map((x) => (x.id === q.id ? next : x)));
    if (!(await listAppStateKey("quotes", [next]))) {
      setQuotes((list) => list.map((x) => (x.id === q.id ? q : x)));
      toast("Devis non enregistré, réessaie");
      return false;
    }
    if (okMsg) toast(okMsg);
    return true;
  }

  async function deleteQuote(q: Quote) {
    if (!(await listAppStateKey("quotes", [], [q.id]))) return toast("Suppression impossible, réessaie");
    setQuotes((list) => list.filter((x) => x.id !== q.id));
    toast(`Devis ${q.ref} supprimé`);
  }

  function quoteHTML(q: Quote): string {
    const t = totalsOf(q.items ?? [], q.franchise, q.vatRate, q.commissionRate);
    return invoiceHTML({ issuer, bank: null, details: { ...q, tpoRef: q.tpoRef ?? "" }, ref: q.ref, brand: q.brand, creator: q.creator || null, totals: t, creatorLegal: legalOf(q.creator), doc: "devis" });
  }

  /** Mail au client + impression du PDF à joindre ; un brouillon passe « Envoyé ». */
  function sendQuote(q: Quote) {
    const t = totalsOf(q.items ?? [], q.franchise, q.vatRate, q.commissionRate);
    const amount = q.franchise ? `${euro2(t.ht)} HT` : `${euro2(t.ht)} HT (${euro2(t.ttc)} TTC)`;
    const subject = `Devis ${q.ref} · ${issuer.name}`;
    const body = [
      `Bonjour,`,
      ``,
      `Veuillez trouver ci-joint notre devis ${q.ref} d'un montant de ${amount}, valable jusqu'au ${frDate(q.dueDate)}.`,
      `Pour l'accepter, il vous suffit de nous le retourner daté et signé, avec la mention « Bon pour accord ».`,
      ``,
      `Bien cordialement,`,
      issuer.name,
    ].join("\n");
    window.location.href = `mailto:${encodeURIComponent(q.clientEmail || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    printHtml(quoteHTML(q));
    if (q.status === "brouillon") void patchQuote(q, { status: "envoye" }, `Devis ${q.ref} marqué « Envoyé »`);
  }

  /** Devis accepté → nouvelle facture (onglet Factures) avec tout son contenu, à vérifier puis enregistrer. */
  function convertQuote(q: Quote) {
    if (q.invoiceId) return toast(`Ce devis est déjà la facture ${q.invoiceRef ?? ""}`.trim());
    const ok = putInvoicePrefill({
      creator: q.creator,
      brand: q.brand,
      lines: [],
      franchise: q.franchise,
      ...(q.onBehalf !== undefined ? { onBehalf: q.onBehalf } : {}),
      ...(q.collabId ? { collabId: q.collabId } : {}),
      // Devis en devise : la facture s'ouvre dans la même devise (taux du jour à saisir).
      ...(q.currency && q.currency !== "EUR" ? { currency: q.currency } : {}),
      fromQuote: q.id,
      details: {
        clientName: q.clientName,
        clientEmail: q.clientEmail,
        clientAddress: q.clientAddress,
        clientSiret: q.clientSiret,
        clientVat: q.clientVat,
        tpoRef: q.tpoRef ?? "",
        items: q.items ?? [],
        vatRate: q.vatRate,
        commissionRate: q.commissionRate,
        notes: q.notes,
      },
    });
    if (!ok) return toast("Impossible de préparer la facture");
    setNavSub("factures");
  }

  async function saveDraft() {
    if (!draft || savingRef.current) return;
    if (!draft.brand.trim()) {
      toast("Renseigne la marque / campagne");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await (draft.doc === "devis" ? doSaveQuote(draft) : doSaveDraft(draft));
    } catch {
      toast("Erreur, réessaie");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function doSaveDraft(draft: Draft) {
    const isNew = !draft.id;
    const t = totalsOf(draft.items, draft.franchise, draft.vatRate, draft.commissionRate);
    const party = draft.creator ? `${draft.brand.trim()} × ${firstName(draft.creator)}` : draft.brand.trim();
    const summary = {
      ref: draft.ref,
      party,
      // Montant enregistré EN EUROS (facture en devise : convertie au taux de la facture).
      amount: euro2(t.ttc * (eurRateOf(draft) ?? 1)),
      date: draft.dueDate || "—",
      status: draft.status,
      creator: draft.creator || null,
    };

    let id = draft.id;
    if (!id) {
      // Numéro recalculé depuis la base juste avant l'insertion (évite les doublons)
      const { data: refRows, error: refErr } = await supabase.from("invoices").select("ref");
      if (refErr) {
        toast("Erreur, réessaie");
        return;
      }
      summary.ref = nextRefFrom(((refRows as { ref: string }[]) ?? []).map((x) => x.ref));
      draft = { ...draft, ref: summary.ref };
    }
    const wasPaid = id ? invoices.find((x) => x.id === id)?.status === "payee" : false;
    if (id) {
      if (!(await dbUpdate("invoices", id, summary))) {
        toast("Erreur, réessaie");
        return;
      }
      setRows(invoices.map((x) => (x.id === id ? { ...x, ...summary } : x)));
    } else {
      const created = await dbInsert("invoices", { ...summary, sort_order: nextOrder(invoices) });
      if (!created) {
        toast("Erreur, réessaie");
        return;
      }
      id = (created as unknown as Row).id;
      setRows([created as unknown as Row, ...invoices]);
      // La facture existe : un nouveau clic sur « Enregistrer » la MODIFIE (jamais de doublon).
      draft = { ...draft, id };
      const createdId = id;
      setDraft((d) => (d ? { ...d, id: createdId, ref: summary.ref } : d));
    }
    // Facture créée depuis une collab (ou champ « Collab ») : lien enregistré à part, jamais bloquant.
    if (draft.collabId && id) void setCollabLink("invoices", id, draft.collabId);
    // Prévient le créateur (si notifs activées) quand SA facture passe à « Payée ».
    if (!wasPaid && draft.status === "payee" && draft.creator) {
      notifyCreator("invoice", draft.creator, `Ta facture ${draft.ref} a été réglée 💸`);
    }

    // Détails riches (blob)
    const detailPart = detailPartOf(draft);
    // Relire FRAIS avant de fusionner : deux postes peuvent créer des factures en
    // parallèle → sinon l'instantané local périmé écrase les détails de l'autre.
    invalidateAppState();
    let freshState: AppState;
    try {
      freshState = await getAppState();
    } catch {
      toast("Facture enregistrée, mais pas ses détails : clique de nouveau sur « Enregistrer »");
      return;
    }
    // Facture tirée d'un devis : le devis passe « Accepté » et garde le numéro de sa facture.
    if (isNew && draft.fromQuote) {
      const q = ((freshState["quotes"] as Quote[]) ?? []).find((x) => x.id === draft.fromQuote);
      if (q) {
        const done: Quote = { ...q, status: "accepte", invoiceId: id, invoiceRef: summary.ref };
        if (await listAppStateKey("quotes", [done])) setQuotes((list) => list.map((x) => (x.id === done.id ? done : x)));
      }
    }
    const freshDetails = (freshState["invoiceDetails"] as Record<string, Details>) ?? {};
    const nextDetails = { ...freshDetails, [id]: detailPart };
    setDetails(nextDetails);
    // N'envoie QUE la facture concernée : un autre poste qui enregistre au même moment
    // une autre facture ne perd pas la sienne.
    const okDetails = await mergeAppStateKey("invoiceDetails", { [id]: detailPart });

    // Mémorise la commission par créateur (même relecture fraîche, écriture de SA seule entrée)
    if (draft.creator) {
      const freshCom = (freshState["creatorCommission"] as Record<string, number>) ?? {};
      const nextCom = { ...freshCom, [draft.creator]: draft.commissionRate };
      setCommissions(nextCom);
      await mergeAppStateKey("creatorCommission", { [draft.creator]: draft.commissionRate });
    }

    if (!okDetails) {
      // Fenêtre gardée ouverte : un nouveau clic réenregistre les détails (sans doublon).
      toast("Facture enregistrée, mais pas ses détails : clique de nouveau sur « Enregistrer »");
      return;
    }
    toast(isNew ? "Facture créée ✓" : "Facture modifiée ✓");
    setConfirmLeave(false);
    setMobilePreview(false);
    setDraft(null);
  }

  function buildHTML(r: Row): string {
    const d = detailsFor(r);
    const t = totalsOf(d.items, d.franchise, d.vatRate, d.commissionRate);
    const bank = banks.find((b) => b.id === d.bankId) ?? null;
    const party = r.party ?? "";
    const brand = party.includes("×") ? party.split("×")[0].trim() : party;
    return invoiceHTML({ issuer, bank, details: d, ref: r.ref, brand, creator: r.creator, totals: t, creatorLegal: legalOf(r.creator) });
  }

  // Export = impression navigateur → « Enregistrer au format PDF » : vrai PDF
  // vectoriel (texte net, pas un .html), pagination gérée par le CSS @page.
  function downloadInvoice(r: Row) {
    printHtml(buildHTML(r));
  }

  function sendInvoice(r: Row) {
    const d = detailsFor(r);
    const t = totalsOf(d.items, d.franchise, d.vatRate, d.commissionRate);
    const subject = `Facture ${r.ref} · ${issuer.name}`;
    const body = [
      `Bonjour,`,
      ``,
      `Veuillez trouver ci-joint la facture ${r.ref} d'un montant de ${money(t.ttc, d.currency)}.`,
      `Échéance : ${frDate(d.dueDate)}.`,
      ``,
      `Bien cordialement,`,
      issuer.name,
    ].join("\n");
    const to = encodeURIComponent(d.clientEmail || "");
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    // Ouvre aussi l'impression → « Enregistrer en PDF » pour joindre la facture au mail.
    downloadInvoice(r);
  }

  async function saveIssuer() {
    if (!issuerDraft) return;
    const ok = await saveAppStateKey("invoiceIssuer", issuerDraft).catch(() => false);
    // Échec : la fenêtre reste ouverte avec la saisie, rien n'est appliqué
    if (!ok) {
      toast("Erreur, réessaie");
      return;
    }
    setIssuer(issuerDraft);
    setIssuerDraft(null);
    toast("Émetteur enregistré ✓");
  }

  function openBanks() {
    setBanksDraft(banks);
    setBanksOpen(true);
  }

  // Enregistre les comptes à la fermeture : relecture FRAÎCHE puis fusion par id
  // (sinon un instantané périmé écrase les comptes saisis sur un autre poste).
  // La fenêtre ne se ferme qu'après écriture réussie (échec : la saisie reste, on peut réessayer).
  function closeBanks() {
    if (!banksFailed.current) return void commitBanks();
    banksFailed.current = false;
    setBanksOpen(false);
    toast("Modifications des comptes annulées");
  }
  async function commitBanks() {
    const draftIds = new Set(banksDraft.map((b) => b.id));
    const removed = new Set(banks.filter((b) => !draftIds.has(b.id)).map((b) => b.id));
    const changed = banksDraft.filter((b) => JSON.stringify(b) !== JSON.stringify(banks.find((x) => x.id === b.id)));
    if (!removed.size && !changed.length) {
      setBanksOpen(false);
      return;
    }
    try {
      invalidateAppState();
      const fresh = ((await getAppState())["invoiceBankAccounts"] as BankAccount[]) ?? [];
      const byId = new Map(changed.map((b) => [b.id, b]));
      const merged = fresh.filter((b) => !removed.has(b.id)).map((b) => byId.get(b.id) ?? b);
      for (const b of changed) if (!fresh.some((x) => x.id === b.id)) merged.push(b);
      if (!(await saveAppStateKey("invoiceBankAccounts", merged))) throw new Error("save");
      setBanks(merged);
      banksFailed.current = false;
      setBanksOpen(false);
      toast("Comptes enregistrés ✓");
    } catch {
      banksFailed.current = true;
      toast("Erreur, comptes non enregistrés. Réessaie, ou ferme pour annuler");
    }
  }

  const draftTotals = draft ? totalsOf(draft.items, draft.franchise, draft.vatRate, draft.commissionRate) : null;
  const bankOptions = [
    { value: "", label: banks.length ? "Aucun compte" : "Ajoute d'abord un compte" },
    ...banks.map((b) => ({ value: b.id, label: b.label || b.iban || "Compte" })),
  ];
  const vatValue = draft ? (draft.franchise ? "franchise" : String(draft.vatRate)) : "";

  // ── Éditeur en page ──
  // La facture affichée à droite = le HTML EXACT de l'impression (même fonction que
  // « Enregistrer en PDF » depuis la liste), recalculé à chaque frappe.
  const liveHtml =
    draft && draftTotals
      ? invoiceHTML({
          issuer,
          bank: banks.find((b) => b.id === draft.bankId) ?? null,
          details: draft,
          ref: draft.ref,
          brand: draft.brand,
          creator: draft.creator || null,
          totals: draftTotals,
          creatorLegal: legalOf(draft.creator),
          doc: draft.doc,
        })
      : "";
  const dirty = !!draft && draftSnapshot(draft) !== baseline;
  // « Envoyer au client » (mail + PDF) part des détails ENREGISTRÉS : proposé seulement
  // pour une facture déjà enregistrée et sans modification en attente.
  const isQuote = draft?.doc === "devis" || (!draft && quoteMode);
  const docWord = isQuote ? "devis" : "facture";
  const savedRow = draft?.id && !isQuote ? invoices.find((x) => x.id === draft.id) : undefined;
  const savedQuote = draft?.id && isQuote ? quotes.find((x) => x.id === draft.id) : undefined;
  const canSend = (!!savedRow || !!savedQuote) && !dirty;

  function renderEditor() {
    const crumb = draft ? (draft.id ? `N° ${draft.ref}` : isQuote ? "Nouveau devis" : "Nouvelle facture") : "Ouverture…";
    const bar = (
      <div className="mb-5 flex min-h-[46px] flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border bg-panel px-4 py-2 text-[13px]">
        <nav aria-label="Fil d'Ariane" className="flex min-w-0 items-center gap-1.5">
          <button type="button" onClick={() => closeEditor()} className="shrink-0 text-muted-foreground transition-colors hover:text-foreground">
            {isQuote ? "Devis" : "Factures"}
          </button>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />
          <span className="truncate font-medium text-foreground">{crumb}</span>
        </nav>
        {confirmLeave ? (
          <div className="flex flex-wrap items-center gap-2" role="alert">
            <span className="text-foreground">Quitter sans enregistrer les modifications ?</span>
            <button type="button" onClick={() => setConfirmLeave(false)} className="rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover">
              Rester
            </button>
            <button type="button" onClick={() => closeEditor(true)} className="rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] font-medium text-dangertext transition-colors hover:bg-dangersoft">
              Quitter
            </button>
          </div>
        ) : dirty ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-amber" aria-hidden />
            Modifications non enregistrées
          </span>
        ) : null}
      </div>
    );

    if (!draft || !draftTotals) {
      return (
        <div>
          {bar}
          <div className="grid place-items-center rounded-2xl border border-border bg-surface py-20">
            <Loader variant="dots" size={18} className="text-faint" label={`Ouverture du ${isQuote ? "devis" : "document"}`} />
          </div>
        </div>
      );
    }

    const who = draft.brand.trim() ? (draft.creator ? `${draft.brand.trim()} × ${firstName(draft.creator)}` : draft.brand.trim()) : "";
    const statusLabel = isQuote ? QUOTE_STATUS_LABEL[quoteShownStatus({ status: draft.quoteStatus ?? "brouillon", validUntil: draft.dueDate }, todayISO())] : metaOf(draft.status).label;
    const subtitle = [who, draft.id ? statusLabel : "Numéro confirmé à l'enregistrement", savedQuote?.invoiceRef ? `Facture ${savedQuote.invoiceRef}` : ""].filter(Boolean).join(" · ");
    const setItem = (id: string, patch: Partial<LineItem>, raw?: Record<string, string>) =>
      setDraft({ ...draft, raw: raw ? { ...draft.raw, ...raw } : draft.raw, items: draft.items.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
    const cellCls =
      "h-10 w-full min-w-0 rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none transition-shadow placeholder:text-faint focus:border-primary focus:ring-2 focus:ring-primary/15";
    const linkBtn = "text-[12px] font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline";
    // Facture en devise : montants du document dans la devise, part agence / créateur en euros.
    const foreign = !!draft.currency && draft.currency !== "EUR";
    const draftFx = eurRateOf(draft);
    const inCur = (n: number) => (foreign ? money(n, draft.currency) : euroUi(n));
    const eurOf = (n: number) => (foreign ? (draftFx ? euroUi(n * draftFx) : "—") : euroUi(n));
    const sumRow = (label: string, value: string, cls = "") => (
      <div className={cn("flex items-baseline justify-between gap-4 py-1.5 text-[13px]", cls)}>
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="tabular-nums text-foreground">{value}</dd>
      </div>
    );

    return (
      <div>
        {bar}

        {/* Titre + actions */}
        <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h2 className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-foreground md:text-[28px]">
              {draft.id ? `${isQuote ? "Devis" : "Facture"} ${draft.ref}` : isQuote ? "Nouveau devis" : "Nouvelle facture"}
            </h2>
            <p className="mt-1 text-[14px] text-muted-foreground">{subtitle}</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <button type="button" onClick={() => setShowPreview((v) => !v)} className={cn(editorBtn, "hidden xl:inline-flex")}>
              {showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {showPreview ? "Masquer l'aperçu" : "Afficher l'aperçu"}
            </button>
            <button type="button" onClick={() => setMobilePreview(true)} className={cn(editorBtn, "xl:hidden")}>
              <Eye className="h-4 w-4" /> Aperçu
            </button>
            {canSend && (savedRow || savedQuote) && (
              <button type="button" onClick={() => (savedQuote ? sendQuote(savedQuote) : savedRow && sendInvoice(savedRow))} className={editorBtn}>
                <Send className="h-4 w-4" /> Envoyer au client
              </button>
            )}
            {canSend && savedQuote && !savedQuote.invoiceId && (
              <button type="button" onClick={() => convertQuote(savedQuote)} className={editorBtn}>
                <FileSignature className="h-4 w-4" /> Transformer en facture
              </button>
            )}
            <button type="button" onClick={() => printHtml(liveHtml)} className={editorBtn}>
              <Download className="h-4 w-4" /> Enregistrer en PDF
            </button>
            <button type="button" onClick={saveDraft} disabled={saving} className={cn(editorPrimaryBtn, "max-sm:flex-1")}>
              {saving ? <Spin size={15} /> : <Check className="h-4 w-4" />}
              {saving ? "Enregistrement…" : `Enregistrer ${isQuote ? "le devis" : "la facture"}`}
            </button>
          </div>
        </div>

        <div className={cn("grid items-start gap-5", showPreview && "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
          {/* ── Formulaire ── */}
          <EditorCard className={cn("min-w-0", !showPreview && "xl:max-w-[900px]")}>
            <EditorSection title="Détails" hint="Client et dates." right={<ClientChip name={draft.clientName} email={draft.clientEmail} />}>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
                <TextField label="Marque / campagne" value={draft.brand} onChange={(v) => setDraft({ ...draft, brand: v })} placeholder="Saucony" />
                <Field label="Créateur">
                  <CreatorPicker
                    ariaLabel="Créateur"
                    creators={creators}
                    value={draft.creator}
                    onChange={(v) =>
                      // Taux du roster appliqué : la saisie brute de commission est oubliée (sinon l'ancien taux resterait affiché)
                      setDraft({
                        ...draft,
                        creator: v,
                        commissionRate: v ? commissionFor(v) : draft.commissionRate,
                        raw: v ? Object.fromEntries(Object.entries(draft.raw ?? {}).filter(([k]) => k !== "commission")) : draft.raw,
                      })
                    }
                  />
                </Field>
                {draft.id && !isQuote ? (
                  <ObjectCollabLink table="invoices" id={draft.id} creator={draft.creator} withLabel />
                ) : (
                  <CollabField value={draft.collabId ?? ""} onChange={(v) => setDraft({ ...draft, collabId: v || undefined })} creator={draft.creator} />
                )}
                <TextField label="Client (nom ou société)" value={draft.clientName} onChange={(v) => setDraft({ ...draft, clientName: v })} />
                <TextField label="Email du client" type="email" value={draft.clientEmail} onChange={(v) => setDraft({ ...draft, clientEmail: v })} placeholder="compta@marque.com" />
                <TextField label="Adresse de facturation" value={draft.clientAddress} onChange={(v) => setDraft({ ...draft, clientAddress: v })} className="sm:col-span-2" />
                <TextField label="SIRET du client" value={draft.clientSiret} onChange={(v) => setDraft({ ...draft, clientSiret: v })} />
                <TextField label="N° TVA du client" value={draft.clientVat} onChange={(v) => setDraft({ ...draft, clientVat: v })} />
                <TextField label="Référence TPO" value={draft.tpoRef} onChange={(v) => setDraft({ ...draft, tpoRef: v.trim() })} placeholder="TPO20261470" />
                <Field label={`N° de ${docWord}`}>
                  <div
                    className="flex h-[42px] items-center gap-2 rounded-lg border border-border bg-muted px-3 text-sm tabular-nums text-foreground"
                    title={draft.id ? undefined : "Le numéro est recalculé juste avant l'enregistrement, pour éviter tout doublon."}
                  >
                    <span className="truncate">{draft.ref}</span>
                    {!draft.id && <span className="ml-auto shrink-0 text-[11.5px] text-faint">provisoire</span>}
                  </div>
                </Field>
                <TextField label={isQuote ? "Émis le" : "Émise le"} type="date" value={draft.issueDate} onChange={(v) => setDraft({ ...draft, issueDate: v })} />
                <TextField label={isQuote ? "Valable jusqu'au" : "Échéance"} type="date" value={draft.dueDate} onChange={(v) => setDraft({ ...draft, dueDate: v })} />
                <Field label="Statut">
                  {isQuote ? (
                    <Picker ariaLabel="Statut" value={draft.quoteStatus ?? "brouillon"} onChange={(v) => setDraft({ ...draft, quoteStatus: v as QuoteStatus })} options={QUOTE_STATUS_OPTIONS} />
                  ) : (
                    <Picker ariaLabel="Statut" value={draft.status} onChange={(v) => setDraft({ ...draft, status: v as InvoiceStatus })} options={STATUS_OPTIONS} />
                  )}
                </Field>
                {!isQuote && (
                  <Field label="Compte bancaire">
                    <Picker ariaLabel="Compte bancaire" value={draft.bankId} onChange={(v) => setDraft({ ...draft, bankId: v })} options={bankOptions} />
                  </Field>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                {!isQuote && <button type="button" onClick={openBanks} className={linkBtn}>Gérer les comptes bancaires</button>}
                <button type="button" onClick={() => setIssuerDraft(issuer)} className={linkBtn}>Informations émetteur</button>
              </div>
            </EditorSection>

            <EditorSection title="Prestations" hint={showPreview ? "Modifie les quantités ou les prix, l'aperçu suit." : "Modifie les quantités ou les prix."}>
              {/* Mise en page selon la LARGEUR DU BLOC (pas de l'écran) : à côté de l'aperçu, le
                  formulaire est étroit et la colonne « Livrable » s'écrasait (titres l'un sur l'autre). */}
              <div className="@container rounded-xl bg-panel p-3 sm:p-4">
                <div className="hidden grid-cols-[minmax(0,1fr)_4rem_6.5rem_7rem_2rem] gap-2 px-1 pb-2 text-[12px] text-muted-foreground @min-[34rem]:grid">
                  <span>Livrable</span>
                  <span>Qté</span>
                  <span>Prix HT</span>
                  <span className="text-right">Total</span>
                  <span />
                </div>
                <div className="flex flex-col gap-3 @min-[34rem]:gap-2">
                  {draft.items.map((it, i) => (
                    <div key={it.id} className="grid grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-2 @min-[34rem]:grid-cols-[minmax(0,1fr)_4rem_6.5rem_7rem_2rem]">
                      <input
                        value={it.label}
                        onChange={(e) => setItem(it.id, { label: e.target.value })}
                        placeholder="Désignation (ex : Reel Instagram)"
                        aria-label={`Livrable, ligne ${i + 1}`}
                        className={cn(cellCls, "col-span-4 @min-[34rem]:col-span-1")}
                      />
                      <input
                        value={draft.raw?.[`${it.id}:qty`] ?? fmtQty(it.qty)}
                        onChange={(e) => setItem(it.id, { qty: qtyNum(e.target.value) }, { [`${it.id}:qty`]: e.target.value })}
                        inputMode="decimal"
                        placeholder="Qté"
                        aria-label={`Quantité, ligne ${i + 1}`}
                        className={cn(cellCls, "px-2 text-center tabular-nums")}
                      />
                      <input
                        value={draft.raw?.[`${it.id}:unit`] ?? fmtQty(it.unit)}
                        onChange={(e) => setItem(it.id, { unit: num(e.target.value) }, { [`${it.id}:unit`]: e.target.value })}
                        inputMode="decimal"
                        placeholder="PU HT"
                        aria-label={`Prix unitaire HT, ligne ${i + 1}`}
                        className={cn(cellCls, "text-right tabular-nums")}
                      />
                      <span className="flex h-10 min-w-0 items-center justify-end truncate rounded-lg bg-muted px-3 text-sm tabular-nums text-muted-foreground">
                        {inCur((it.qty || 0) * (it.unit || 0))}
                      </span>
                      <button
                        type="button"
                        onClick={() => setDraft({ ...draft, items: draft.items.length > 1 ? draft.items.filter((x) => x.id !== it.id) : draft.items })}
                        disabled={draft.items.length <= 1}
                        className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-dangertext disabled:pointer-events-none disabled:opacity-40"
                        title="Supprimer la ligne"
                        aria-label={`Supprimer la ligne ${i + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, items: [...draft.items, { id: uid(), label: "", qty: 1, unit: 0 }] })}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
                >
                  <Plus className="h-4 w-4" /> Ajouter une ligne
                </button>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
                {draft.kind !== "commission" && (
                  <Field label={isQuote ? "Devis au nom de" : "Facture au nom de"}>
                    <Picker
                      ariaLabel={isQuote ? "Devis au nom de" : "Facture au nom de"}
                      value={draft.onBehalf ? "mandat" : "agence"}
                      onChange={(v) => setDraft({ ...draft, onBehalf: v === "mandat" })}
                      options={[
                        { value: "agence", label: "L'agence" },
                        { value: "mandat", label: draft.creator ? `${titleCase(draft.creator)} (mandat)` : "Le créateur (mandat)" },
                      ]}
                    />
                  </Field>
                )}
                <Field label="TVA">
                  <Picker
                    ariaLabel="TVA"
                    value={vatValue}
                    onChange={(v) => setDraft({ ...draft, franchise: v === "franchise", vatRate: v === "franchise" ? draft.vatRate : num(v) })}
                    options={VAT_OPTIONS}
                  />
                </Field>
                <Field label="Devise">
                  <Picker
                    ariaLabel="Devise"
                    value={draft.currency || "EUR"}
                    onChange={(v) => setDraft({ ...draft, currency: v === "EUR" ? undefined : v, fxRate: v === "EUR" ? undefined : draft.fxRate })}
                    options={CURRENCIES.map((c) => ({ value: c, label: c === "EUR" ? "Euro (€)" : c }))}
                  />
                </Field>
                {draft.currency && draft.currency !== "EUR" && (
                  <Field label={`Valeur d'1 ${draft.currency} en euros`}>
                    <input
                      value={draft.raw?.fx ?? (draft.fxRate ? fmtRate(draft.fxRate) : "")}
                      onChange={(e) => setDraft({ ...draft, raw: { ...draft.raw, fx: e.target.value }, fxRate: parseFxRate(e.target.value) ?? undefined })}
                      inputMode="decimal"
                      placeholder="ex. 0,92"
                      aria-label="Taux de conversion"
                      className={cn(cellCls, "h-[42px] tabular-nums", !draft.fxRate && "border-amber")}
                    />
                  </Field>
                )}
                <Field label="Commission agence (%)">
                  <input
                    value={draft.raw?.commission ?? fmtRate(draft.commissionRate)}
                    onChange={(e) => setDraft({ ...draft, raw: { ...draft.raw, commission: e.target.value }, commissionRate: num(e.target.value) })}
                    inputMode="decimal"
                    className={cn(cellCls, "h-[42px] tabular-nums")}
                  />
                </Field>
              </div>

              {/* Totaux (identiques au document) + part agence / créateur (interne, non imprimée) */}
              <div className="mt-5 flex flex-col gap-4 border-t border-border pt-4 sm:flex-row sm:items-start sm:justify-between">
                <dl className="order-2 min-w-0 sm:order-1 sm:max-w-[240px]">
                  <div className="text-[12px] font-medium text-muted-foreground">Interne, non imprimé</div>
                  {sumRow(`Commission TTP · ${fmtRate(draft.commissionRate)} %`, eurOf(draftTotals.commission), "[&_dd]:font-medium [&_dd]:text-signaltext")}
                  {draft.creator && sumRow(`Reversé à ${firstName(draft.creator)}`, eurOf(draftTotals.reversal))}
                  {foreign && <div className="pt-1 text-[11.5px] text-muted-foreground">{draftFx ? `En euros, au taux de la facture (1 ${draft.currency} = ${fmtRate(draftFx)} €).` : "Taux de conversion à renseigner : sans lui, rien n'est compté en euros."}</div>}
                </dl>
                <dl className="order-1 w-full sm:order-2 sm:max-w-[300px]">
                  {sumRow("Sous-total HT", inCur(draftTotals.ht))}
                  {sumRow(draft.franchise ? "TVA non applicable" : `TVA ${fmtRate(draft.vatRate)} %`, inCur(draftTotals.tva))}
                  {sumRow("Total TTC", inCur(draftTotals.ttc), "mt-1 border-t border-border pt-2.5 text-[15px] [&_dd]:font-semibold [&_dt]:font-semibold [&_dt]:text-foreground")}
                </dl>
              </div>
            </EditorSection>

            <EditorSection title="Notes" hint={`Facultatif, imprimées sur ${isQuote ? "le devis" : "la facture"}.`}>
              <textarea
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                rows={3}
                aria-label="Notes"
                className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2.5 text-sm leading-relaxed text-foreground outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </EditorSection>
          </EditorCard>

          {/* ── Aperçu vivant (ordinateur) ── */}
          {showPreview && (
            <div className="sticky top-4 hidden min-w-0 xl:block">
              <InvoiceSheet html={liveHtml} title={`${isQuote ? "Devis" : "Facture"} ${draft.ref}`} className="h-[calc(100dvh-150px)] min-h-[560px]" />
            </div>
          )}
        </div>

        {/* ── Aperçu (téléphone, tablette) ── */}
        {mobilePreview && (
          <Modal
            title={`Aperçu · ${draft.ref}`}
            onClose={() => setMobilePreview(false)}
            wide
            footer={
              <>
                <button type="button" className={ghostBtn} onClick={() => setMobilePreview(false)}>Fermer</button>
                <button type="button" className={cn(ghostBtn, "flex items-center gap-1.5")} onClick={() => printHtml(liveHtml)}>
                  <Download className="h-3.5 w-3.5" /> Enregistrer en PDF
                </button>
              </>
            }
          >
            <InvoiceSheet html={liveHtml} title={`${isQuote ? "Devis" : "Facture"} ${draft.ref}`} className="h-[62vh] p-2 sm:p-3" />
          </Modal>
        )}
      </div>
    );
  }

  // ── Liste des devis (onglet Devis) ──
  function renderQuotes() {
    const today = todayISO();
    const shown = (q: Quote) => quoteShownStatus({ status: q.status, validUntil: q.dueDate }, today);
    const htOfQuote = (q: Quote) => totalsOf(q.items ?? [], q.franchise, q.vatRate, q.commissionRate);
    const list = quotes.filter((q) => matchQuery(query, q.ref, q.brand, q.creator, q.clientName) && (quoteFilter === "Tous" || shown(q) === quoteFilter));
    const pending = quotes.filter((q) => shown(q) === "envoye");
    const accepted = quotes.filter((q) => q.status === "accepte");
    const answered = quotes.filter((q) => ["accepte", "refuse", "expire"].includes(shown(q)));
    const sumHT = (l: Quote[]) => l.reduce((a, q) => a + htOfQuote(q).ht, 0);
    const chips = [{ value: "Tous", label: "Tous" }, ...(["brouillon", "envoye", "accepte", "refuse", "expire"] as const).map((v) => ({ value: v, label: QUOTE_STATUS_LABEL[v] }))];
    const tiles = [
      { label: "En attente de réponse", value: euroUi(sumHT(pending)), foot: `${pending.length} devis envoyé${pending.length > 1 ? "s" : ""}, HT` },
      { label: "Acceptés", value: euroUi(sumHT(accepted)), foot: `${accepted.length} devis, HT`, strong: true },
      { label: "Taux d'acceptation", value: answered.length ? `${Math.round((accepted.length / answered.length) * 100)} %` : "—", foot: "sur les devis acceptés, refusés ou expirés" },
    ];
    return (
      <>
        <PageHeaderRow>
          <div className="text-sm text-muted-foreground">
            {quotes.length} devis
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setIssuerDraft(issuer)} className={cn(ghostBtn, "ios-phone-hide flex items-center gap-1.5")} title="Informations émetteur">
              <Settings2 className="h-3.5 w-3.5" />
              <span>Émetteur</span>
            </button>
            <AddButton label="Devis" onClick={openCreate} />
          </div>
        </PageHeaderRow>

        {quotes.length > 0 && (
          <div className="mb-5 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
            {tiles.map((k) => (
              <div key={k.label} className="flex min-w-0 flex-col bg-surface px-4 py-4 sm:px-5">
                <span className="text-[12px] leading-snug text-muted-foreground sm:text-[13px]">{k.label}</span>
                <span className={cn("mt-2 truncate text-[20px] font-semibold leading-none tracking-tight tabular-nums sm:text-[24px]", k.strong && "text-signaltext")}>{k.value}</span>
                <span className="mt-2.5 text-[12px] leading-snug text-muted-foreground">{k.foot}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <FilterBar value={quoteFilter} onChange={(v) => setQuoteFilter(v as QuoteShownStatus | "Tous")} options={chips} className="min-w-0 flex-1 md:min-w-auto md:flex-initial" />
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="hidden grid-cols-[1.1fr_2fr_1fr_1fr_1.1fr_1.4fr] gap-3 border-b border-border px-4 py-3 text-[12px] text-muted-foreground md:grid">
            <span>Réf.</span>
            <span>Marque × Créateur</span>
            <span className="text-right">Montant HT</span>
            <span className="text-right">TTC</span>
            <span className="text-center">Valable jusqu'au</span>
            <span className="text-right">Statut</span>
          </div>
          {quotes.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <div className="text-sm font-medium text-foreground">Aucun devis</div>
              <div className="mt-1.5 text-xs text-faint">Crée ton premier devis avec « + Devis », ou depuis Tarifs avec « Créer le devis ».</div>
            </div>
          ) : list.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {query.trim() ? `Aucun résultat pour « ${query} »` : "Aucun devis pour ce filtre."}
            </div>
          ) : (
            list.map((q) => {
              const t = htOfQuote(q);
              const st = shown(q);
              const party = q.creator ? `${q.brand} × ${firstName(q.creator)}` : q.brand;
              const items: ActionItem[] = [
                { key: "edit", label: "Modifier", icon: Pencil, onClick: () => void openEditQuote(q) },
                { key: "preview", label: "Aperçu", icon: Eye, onClick: () => setPreview({ html: quoteHTML(q), ref: q.ref, email: q.clientEmail, brand: party }) },
                { key: "send", label: "Envoyer au client", icon: Send, onClick: () => sendQuote(q) },
                { key: "download", label: "Enregistrer en PDF", icon: Download, onClick: () => printHtml(quoteHTML(q)) },
                ...(q.invoiceId ? [] : [{ key: "invoice", label: "Transformer en facture", icon: FileSignature, onClick: () => convertQuote(q) }]),
                { key: "delete", label: "Supprimer", icon: Trash2, danger: true, onClick: () => void deleteQuote(q), confirm: { title: "Supprimer le devis", message: `Supprimer le devis ${q.ref} (${party}) ?${q.invoiceRef ? ` Sa facture ${q.invoiceRef} reste.` : ""}`, confirmLabel: "Supprimer" } },
              ];
              const badge = (
                <QuoteStatusPicker
                  status={q.status}
                  shown={st}
                  onPick={(v) => {
                    void patchQuote(q, { status: v }, v === "accepte" && !q.invoiceId ? `Devis ${q.ref} accepté : « Transformer en facture » dans son menu` : `Devis ${q.ref} : ${QUOTE_STATUS_LABEL[v]}`);
                  }}
                />
              );
              const linked = q.invoiceRef ? <span className="text-[11px] text-muted-foreground">Facture {q.invoiceRef}</span> : null;
              return (
                <div key={q.id} className="border-b border-border last:border-0">
                  <div onClick={() => void openEditQuote(q)} className="hidden cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-rowhover md:grid md:grid-cols-[1.1fr_2fr_1fr_1fr_1.1fr_1.4fr]">
                    <span className="whitespace-nowrap text-[11px] font-medium text-faint">#{q.ref}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">{party || "—"}</span>
                      {linked}
                    </span>
                    <span className="text-right text-[13px] font-medium tabular-nums text-foreground">{euroUi(t.ht)}</span>
                    <span className="text-right text-[12px] tabular-nums text-muted-foreground">{euroUi(t.ttc)}</span>
                    <span className="text-center text-[11px] font-medium text-muted-foreground">{uiDate(q.dueDate)}</span>
                    <span className="flex items-center justify-end gap-2">
                      {badge}
                      <span onClick={(e) => e.stopPropagation()}>
                        <ActionMenu items={items} />
                      </span>
                    </span>
                  </div>
                  <div onClick={() => void openEditQuote(q)} className="flex cursor-pointer flex-col gap-2 px-3 py-3 md:hidden">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[10px] font-medium text-faint">
                          <FileText className="h-3 w-3" /> #{q.ref}
                        </div>
                        <div className="mt-0.5 truncate text-[15px] font-semibold text-foreground">{party || "—"}</div>
                        {linked}
                      </div>
                      {badge}
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t border-border pt-2.5">
                      <span className="flex flex-col">
                        <span className="text-lg font-bold tracking-tight text-foreground">{euroUi(t.ht)} <span className="text-[11px] font-medium text-muted-foreground">HT</span></span>
                        <span className="text-[11px] font-medium text-muted-foreground">Valable jusqu'au {uiDate(q.dueDate)}</span>
                      </span>
                      <span onClick={(e) => e.stopPropagation()}>
                        <ActionMenu items={items} />
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <div ref={editorTop} className="-mb-4 scroll-mt-4" />
      {/* Téléphone : la facture s'ouvre en feuille (comme les autres « + »), pas dans la page. */}
      {editing && phone ? (
        <IosSheet onClose={() => closeEditor()} label={draft?.id ? `${isQuote ? "Devis" : "Facture"} ${draft.ref}` : isQuote ? "Nouveau devis" : "Nouvelle facture"}>
          <div className="max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-[22px] bg-background px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-7">{renderEditor()}</div>
        </IosSheet>
      ) : null}
      {editing && !phone ? renderEditor() : quoteMode ? renderQuotes() : (<>
      {/* En-tête */}
      <PageHeaderRow>
        <div className="text-sm text-muted-foreground">
          {rows.length} facture{rows.length > 1 ? "s" : ""}
        </div>
        <div className="flex items-center gap-2">
          <PhoneMenu items={[
            { key: "comptes", label: "Comptes bancaires", icon: Landmark, onClick: openBanks },
            { key: "emetteur", label: "Émetteur", icon: Settings2, onClick: () => setIssuerDraft(issuer) },
          ]} />
          <button type="button" onClick={openBanks} className={cn(ghostBtn, "ios-phone-hide flex items-center gap-1.5")} title="Comptes bancaires">
            <Landmark className="h-3.5 w-3.5" />
            <span>Comptes</span>
          </button>
          <button type="button" onClick={() => setIssuerDraft(issuer)} className={cn(ghostBtn, "ios-phone-hide flex items-center gap-1.5")} title="Informations émetteur">
            <Settings2 className="h-3.5 w-3.5" />
            <span>Émetteur</span>
          </button>
          <AddButton label="Facture" onClick={openCreate} />
        </div>
      </PageHeaderRow>

      {/* Période : pilote les chiffres ci-dessous ET la liste */}
      {periods.length > 0 && (
        <div className="mb-4 flex justify-end">
          <PeriodFilter value={period} onChange={setPeriod} periods={periods} allLabel="Toutes échéances" forward className="shrink-0" />
        </div>
      )}

      {/* Synthèse (bento) */}
      {rows.length > 0 && (
        <StatsBento phoneStrip
          className="mb-5"
          primary={{
            eyebrow: `Encaissé HT · ${period ? periodName : nowY}`,
            value: formatEuro(encaisse),
            caption: `${paidScope.length} facture${paidScope.length > 1 ? "s" : ""} réglée${paidScope.length > 1 ? "s" : ""} ${period ? "sur la période" : "cette année"}.`,
          }}
          bars={{
            label: barsLabel,
            value: formatEuro(barsValue),
            series: monthly,
          }}
          small={{ value: String(unpaid.length), label: period ? `À encaisser TTC · ${periodName}` : "À encaisser TTC · toutes périodes" }}
          accent={{
            value: formatEuro(aEncaisser),
            label: nbRetard > 0 ? `dont ${nbRetard} en retard` : "En attente de paiement",
            icon: nbRetard > 0 ? AlertTriangle : Wallet,
          }}
        />
      )}

      {/* Marge agence (sur le HT), séparée du TTC */}
      {billed.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-4">
          {[
            { label: "Facturé HT", value: euroUi(finBilled.ht), foot: `${euroUi(finBilled.ttc)} TTC · TVA ${euroUi(finBilled.tva)}` },
            { label: "Commission TTP (HT)", value: euroUi(finBilled.commission), foot: `${fmtRate(Math.round(margePct * 10) / 10)} % du HT en moyenne`, strong: true },
            { label: "Commission encaissée", value: euroUi(finPaid.commission), foot: `sur ${euroUi(finPaid.ht)} HT payés` },
            { label: "Part créateurs", value: euroUi(finBilled.reversal), foot: "HT moins la commission" },
          ].map((k) => (
            <div key={k.label} className="flex min-w-0 flex-col bg-surface px-4 py-4 sm:px-5">
              <span className="line-clamp-2 min-h-[2lh] text-[12px] leading-snug text-muted-foreground sm:text-[13px] lg:min-h-0">{k.label}</span>
              <span className={cn("mt-2 truncate text-[20px] font-semibold leading-none tracking-tight tabular-nums sm:text-[24px]", k.strong && "text-signaltext")}>{k.value}</span>
              <span className="mt-2.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground">{k.foot}</span>
            </div>
          ))}
          <div className="col-span-2 bg-surface px-4 py-2.5 text-[12px] text-muted-foreground sm:px-5 lg:col-span-4">
            Hors brouillons · commission calculée sur le HT, aucune sous 100 € HT.
          </div>
        </div>
      )}

      {/* Filtres (pastilles desktop · sélecteur mobile) */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterBar
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as InvoiceStatus | "Tous")}
          options={statusChips}
          className="min-w-0 flex-1 md:min-w-auto md:flex-initial"
        />
      </div>

      {/* Liste */}
      {/* Tableau dans UN panneau à filets (langage Aperçu) */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="hidden grid-cols-[0.8fr_2fr_1fr_1.1fr_1fr_1fr_1.4fr] gap-3 border-b border-border px-4 py-3 text-[12px] text-muted-foreground md:grid">
          <span>Réf.</span>
          <span>Marque × Créateur</span>
          <span className="text-right">Montant HT</span>
          <span className="text-right">Commission TTP</span>
          <span className="text-right">TTC</span>
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
            {query.trim() ? `Aucun résultat pour « ${query} »` : "Aucune facture pour ces filtres."}
          </div>
        ) : (
          filtered.map((r) => {
            // Taux de CETTE facture si un taux spécifique a été saisi (invoiceDetails),
            // sinon le taux vivant du roster. Cohérent avec Reversements (paie).
            const fin = finOf(r);
            const rate = fin.rate;
            const del = async () => {
              if (await dbTrash("invoices", r.id, r.party, formatEuro(parseAmount(r.amount)))) {
                setRows(invoices.filter((x) => x.id !== r.id));
                toast("Déplacé dans la corbeille");
              } else {
                toast("Suppression impossible, réessaie");
              }
            };
            const openPreview = () => setPreview({ html: buildHTML(r), ref: r.ref, email: detailsFor(r).clientEmail, brand: r.party });
            // Changement de statut depuis le badge : affiché tout de suite, annulé si la base refuse.
            const pickStatus = async (status: InvoiceStatus) => {
              const before = r.status;
              setRows((list) => list?.map((x) => (x.id === r.id ? { ...x, status } : x)) ?? list);
              if (!(await dbUpdate("invoices", r.id, { status }))) {
                setRows((list) => list?.map((x) => (x.id === r.id ? { ...x, status: before } : x)) ?? list);
                return toast("Statut non enregistré, réessaie");
              }
              toast(`Facture ${r.ref} : ${metaOf(status).label}`);
              if (status === "payee" && before !== "payee" && r.creator) notifyCreator("invoice", r.creator, `Ta facture ${r.ref} a été réglée 💸`);
            };
            const menuItems: ActionItem[] = [
              { key: "edit", label: "Modifier", icon: Pencil, onClick: () => void openEdit(r) },
              { key: "preview", label: "Aperçu", icon: Eye, onClick: openPreview },
              { key: "send", label: "Envoyer au client", icon: Send, onClick: () => sendInvoice(r) },
              { key: "download", label: "Enregistrer en PDF", icon: Download, onClick: () => downloadInvoice(r) },
              // Une facture émise ne se supprime pas (numérotation continue, obligation légale) :
              // elle s'annule et garde son numéro. Seul un brouillon part à la corbeille.
              r.status === "brouillon"
                ? { key: "delete", label: "Mettre à la corbeille", icon: Trash2, danger: true, onClick: del, confirm: { title: "Mettre à la corbeille", message: `Déplacer le brouillon ${r.ref} (${r.party}) vers la corbeille ? Tu pourras le restaurer.`, confirmLabel: "Mettre à la corbeille" } }
                : r.status === "annulee"
                  ? { key: "restore", label: "Réactiver", icon: Undo2, onClick: () => void pickStatus("attente") }
                  : { key: "cancel", label: "Annuler", icon: Ban, danger: true, onClick: () => void pickStatus("annulee"), confirm: { title: "Annuler la facture", message: `Annuler la facture ${r.ref} (${r.party}) ? Elle garde son numéro et reste dans la liste, marquée « Annulée ». Elle ne compte plus dans le chiffre d'affaires.`, confirmLabel: "Annuler la facture" } },
            ];
            const margeChip = (
              <span className="inline-block whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                Commission {euroUi(fin.commission)} · {fmtRate(rate)} %
              </span>
            );
            return (
              <div key={r.id} className="border-b border-border last:border-0">
                {/* Desktop : ligne type tableau */}
                <div
                  onClick={() => setFinView(r)}
                  className="hidden cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-rowhover md:grid md:grid-cols-[0.8fr_2fr_1fr_1.1fr_1fr_1fr_1.4fr]"
                >
                  <span className="text-[11px] font-medium text-faint">#{r.ref}</span>
                  <span className="truncate text-sm font-medium text-foreground">{r.party}</span>
                  <span className="text-right text-[13px] font-medium tabular-nums text-foreground">{euroUi(fin.ht)}</span>
                  <span className="text-right tabular-nums">
                    <span className="block text-[13px] font-medium text-signaltext">{euroUi(fin.commission)}</span>
                    <span className="block text-[11px] text-muted-foreground">{fin.commission === 0 && fin.ht > 0 && fin.ht < 100 ? "sous 100 € HT" : `${fmtRate(rate)} %`}</span>
                  </span>
                  <span className="text-right text-[12px] tabular-nums text-muted-foreground">{euroUi(fin.ttc)}</span>
                  <span className="text-center text-[11px] font-medium text-muted-foreground">{uiDate(r.date)}</span>
                  <span className="flex items-center justify-end gap-2">
                    <StatusPicker row={r} onPick={(st) => void pickStatus(st)} />
                    <span onClick={(e) => e.stopPropagation()}>
                      <ActionMenu items={menuItems} />
                    </span>
                  </span>
                </div>

                {/* Mobile : carte compacte */}
                <div onClick={() => setFinView(r)} className="flex cursor-pointer flex-col gap-2 px-3 py-3 md:hidden">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[10px] font-medium text-faint">
                        <FileText className="h-3 w-3" /> #{r.ref}
                      </div>
                      <div className="mt-0.5 truncate text-[15px] font-semibold text-foreground">{r.party}</div>
                    </div>
                    <StatusPicker row={r} onPick={(st) => void pickStatus(st)} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex flex-col">
                      <span className="text-lg font-bold tracking-tight text-foreground">{euroUi(fin.ht)} <span className="text-[11px] font-medium text-muted-foreground">HT</span></span>
                      {fin.tva > 0 && <span className="text-[11px] text-muted-foreground">{euroUi(fin.ttc)} TTC</span>}
                    </span>
                    {margeChip}
                  </div>
                  <div className="mt-0.5 flex items-center justify-between border-t border-border pt-2.5">
                    <span className="text-[11px] font-medium text-muted-foreground">Échéance · {uiDate(r.date)}</span>
                    <span onClick={(e) => e.stopPropagation()}>
                      <ActionMenu items={menuItems} />
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      </>)}

      {/* ── Fiche marge d'une facture (au clic) ── */}
      {finView && (() => {
        const r = finView;
        const f = finOf(r);
        const d = details[r.id];
        const underFloor = f.commission === 0 && f.ht > 0 && f.ht < 100;
        const line = (label: string, value: string, opts?: { strong?: boolean; accent?: boolean; muted?: boolean }) => (
          <div className="flex items-center justify-between gap-3 py-2.5">
            <span className={cn("text-[13px]", opts?.muted ? "text-muted-foreground" : "text-foreground")}>{label}</span>
            <span className={cn("tabular-nums", opts?.strong ? "text-[16px] font-semibold" : "text-[13px] font-medium", opts?.accent ? "text-signaltext" : "text-foreground")}>{value}</span>
          </div>
        );
        return (
          <Modal
            title={`Facture #${r.ref} · ${r.party}`}
            onClose={() => setFinView(null)}
            footer={
              <>
                <button type="button" className={ghostBtn} onClick={() => { setFinView(null); void openEdit(r); }}>Modifier</button>
                <button type="button" className={ghostBtn} onClick={() => { setFinView(null); downloadInvoice(r); }}>Enregistrer en PDF</button>
                <button type="button" className={ghostBtn} onClick={() => { setFinView(null); sendInvoice(r); }}>Envoyer au client</button>
                <button type="button" className={primaryBtn} onClick={() => { setFinView(null); setPreview({ html: buildHTML(r), ref: r.ref, email: detailsFor(r).clientEmail, brand: r.party }); }}>Aperçu</button>
              </>
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
              <AnimatedBadge status={shownMetaOf(r).badge} size="sm">{shownMetaOf(r).label}</AnimatedBadge>
              <span>Échéance {uiDate(r.date)}</span>
              {r.creator && <span>· {r.creator}</span>}
            </div>
            <div className="divide-y divide-border rounded-xl border border-border px-4">
              {line("Montant HT", euroUi(f.ht))}
              {line(f.tva > 0 ? `TVA ${fmtRate(d?.vatRate ?? 0)} %` : "TVA", f.tva > 0 ? euroUi(f.tva) : "Non applicable", { muted: true })}
              {line("Total TTC (payé par la marque)", euroUi(f.ttc), { muted: true })}
            </div>
            <div className="mt-3 divide-y divide-border rounded-xl border border-border bg-muted/40 px-4">
              {line(`Commission TTP · ${fmtRate(f.rate)} % du HT`, euroUi(f.commission), { strong: true, accent: true })}
              {line("Part créateur (HT − commission)", euroUi(f.reversal))}
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
              {underFloor
                ? "Pas de commission : la facture est sous 100 € HT (seuil du contrat). "
                : "La commission se calcule sur le HT, jamais sur la TVA (reversée à l'État). "}
              {d?.items?.length ? "Calcul à partir des lignes de la facture." : "Ancienne facture sans détail : le montant enregistré est traité comme HT, sans TVA. Ouvre « Modifier » pour préciser."}
            </p>
          </Modal>
        );
      })()}

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
          onClose={closeBanks}
          footer={<button type="button" className={primaryBtn} onClick={commitBanks}>Terminé</button>}
        >
          <div className="flex flex-col gap-3">
            {banksDraft.length === 0 && <p className="text-sm text-muted-foreground">Aucun compte : ajoute-en un pour pouvoir le sélectionner sur une facture.</p>}
            {banksDraft.map((b) => (
              <div key={b.id} className="rounded-xl border border-border bg-surface p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <TextField label="Libellé" value={b.label} onChange={(v) => setBanksDraft(banksDraft.map((x) => (x.id === b.id ? { ...x, label: v } : x)))} className="min-w-[140px] flex-1" />
                  <TextField label="Titulaire" value={b.holder} onChange={(v) => setBanksDraft(banksDraft.map((x) => (x.id === b.id ? { ...x, holder: v } : x)))} className="min-w-[140px] flex-1" />
                  <TextField label="Banque" value={b.bank} onChange={(v) => setBanksDraft(banksDraft.map((x) => (x.id === b.id ? { ...x, bank: v } : x)))} className="min-w-[120px] flex-1" />
                  <TextField label="IBAN" value={b.iban} onChange={(v) => setBanksDraft(banksDraft.map((x) => (x.id === b.id ? { ...x, iban: v } : x)))} className="min-w-full flex-[2]" />
                  <TextField label="BIC" value={b.bic} onChange={(v) => setBanksDraft(banksDraft.map((x) => (x.id === b.id ? { ...x, bic: v } : x)))} className="min-w-[120px] flex-1" />
                  <button
                    type="button"
                    onClick={() => setBanksDraft(banksDraft.filter((x) => x.id !== b.id))}
                    className="grid h-[42px] w-10 shrink-0 place-items-center rounded-lg border border-border text-faint transition-colors hover:bg-rowhover hover:text-dangertext"
                    title="Supprimer le compte"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setBanksDraft([...banksDraft, { id: uid(), label: "", holder: issuer.name, bank: "", iban: "", bic: "" }])}
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
                onClick={() => printHtml(preview.html)}
              >
                <FileText className="h-3.5 w-3.5" /> Enregistrer en PDF
              </button>
            </>
          }
        >
          <iframe title={`Document ${preview.ref}`} srcDoc={preview.html} sandbox="" className="h-[62vh] w-full rounded-lg border border-border bg-white" />
        </Modal>
      )}
    </>
  );
}
