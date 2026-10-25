import { useStickyState } from "@/lib/useStickyState";
import { useEffect, useState } from "react";
import { Pencil, Share2, Download, LayoutGrid, List, Table2, Trash2, Send, Eye, X, FileText, Activity, Sparkles } from "@/components/icons";
import { FileCard } from "@/components/ui/file-card-collections";
import {
  useAppState,
  saveAppStateKey,
  getAppState,
  invalidateAppState,
  formatEuro,
  type AppState,
} from "@/lib/appState";
import { parseAmountStrict } from "@/lib/money";
import { supabase } from "@/lib/supabase";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { toast } from "@/components/ui/toast";
import { notifyCreator } from "@/lib/push";
import { AddButton, InlineForm, TextField } from "@/components/ui/form";
import { ActionMenu } from "@/components/ui/action-menu";
import { StatsBento } from "@/components/ui/stats-bento";
import { useCreators } from "@/lib/useCreators";
import { titleCase } from "@/lib/utils";
import { DebriefCalculator, ShotStrip, useShotUrls, resolveShots, type CalcState } from "@/views/DebriefCalculator";
import { printHtml } from "@/lib/printPdf";
import { pdfFileTitle, pdfShell, pdfHeading, pdfMeta, pdfSection, pdfKpis, pdfTicks, pdfShots } from "@/lib/pdfDoc";
import { totalsOf as engTotals, parseNum as engParse, fmtCompact, fmtPct, allHaveReach, singlePlatform } from "@/lib/engagement";
import { campaignCosts } from "@/lib/pricing";
import { PageHeaderRow } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/animated-tabs";
import { Overlay } from "@/components/mobile/ios-sheet";
import { useIntent } from "@/lib/openIntent";
import { buildRecap, publicationDate, readyForRecap, type CollabForRecap, type StepRow } from "@/lib/campaignRecap";
import { dbUpdate } from "@/lib/db";
import { EMPTY, fmtDay, todayISO } from "@/lib/dates";
import { CreatorPickerField } from "@/components/ui/creator-picker";

/** Une petite statistique de campagne (label / valeur). */
type Kpi = { l: string; v: string };
/** Nombre de contenus derrière les chiffres du calculateur (0 = inconnu, bilan saisi à la main). */
function contentCount(calc: CalcState | undefined): number {
  if (!calc) return 0;
  return calc.mode === "global" ? Math.max(calc.stats.length ? 1 : 0, Math.round(engParse(calc.postsCount))) : calc.stats.length;
}
/** Libellé affiché d'un indicateur : « Reach » (gardé tel quel dans les données) s'affiche
 *  « Couverture », ou « Couverture cumulée » quand elle additionne plusieurs contenus
 *  (une même personne y compte plusieurs fois). */
const kpiLabel = (l: string, d?: { calc?: CalcState }) => (l === "Reach" ? (contentCount(d?.calc) > 1 ? "Couverture cumulée" : "Couverture") : l);
/** « CA généré / budget » (ex-« ROI ») : c'est un ratio CA ÷ budget (ROAS), pas un retour
 *  sur investissement. Champ `roi` gardé dans les données, seul le libellé change. */
const roasText = (roi: string) => (roi && roi !== "—" ? `${roi} le budget` : "—");
/** Montant d'un bilan pour les totaux : ambigu ou illisible → 0 (ignoré), jamais un nombre faux. */
const amountOf = (s: string) => parseAmountStrict(s) ?? 0;

/** État vierge du calculateur d'engagement. */
const CALC_EMPTY: CalcState = { mode: "global", stats: [], followers: "", postsCount: "", basis: "reach", shots: [] };

/** Un blob legacy/partiel ne contient pas `calc` → forme garantie ici. */
function normCalc(c: Partial<CalcState> | undefined): CalcState {
  return {
    mode: c?.mode === "detail" ? "detail" : "global",
    stats: Array.isArray(c?.stats) ? c.stats : [],
    followers: c?.followers ?? "",
    postsCount: c?.postsCount ?? "",
    basis: c?.basis === "followers" ? "followers" : "reach",
    shots: Array.isArray(c?.shots) ? c.shots : [],
  };
}

/** Un debrief de campagne : bilan marque × créateur avec CA généré / budget et points forts. */
type Debrief = {
  brand: string;
  creator: string;
  period: string;
  deliverables: string;
  budget: string;
  revenue: string;
  roi: string;
  tone: string;
  summary: string;
  kpis: Kpi[];
  highlights: string[];
  /** Saisie du calculateur d'engagement + captures jointes (optionnel : blobs legacy). */
  calc?: CalcState;
  /** Proposition de renouvellement adressée à la marque (fin du bilan). */
  renewal?: string;
  /** Collab d'origine (bilan préparé automatiquement à J+7). */
  collabId?: string;
};

/** Formate un debrief en texte lisible (partage / téléchargement). */
function debriefToText(d: Debrief): string {
  const lines: string[] = [];
  lines.push(`${d.brand} × ${titleCase(d.creator)}`);
  if (d.period && d.period !== "—") lines.push(d.period);
  lines.push("");
  lines.push(`Budget HT : ${d.budget}  →  CA généré : ${d.revenue}${d.roi && d.roi !== "—" ? `   (CA généré / budget : ${roasText(d.roi)})` : ""}`);
  if (d.summary && d.summary !== "—") {
    lines.push("");
    lines.push(d.summary);
  }
  if (d.highlights.length > 0) {
    lines.push("");
    lines.push("Points forts :");
    d.highlights.forEach((h) => lines.push(`  ✓ ${h}`));
  }
  if (d.kpis.length > 0) {
    lines.push("");
    lines.push("Indicateurs :");
    d.kpis.forEach((k) => lines.push(`  • ${kpiLabel(k.l, d)} : ${k.v}`));
  }
  if (d.renewal?.trim()) {
    lines.push("");
    lines.push("Et ensuite ?");
    lines.push(d.renewal.trim());
  }
  lines.push("");
  lines.push("— TTP Suite · Trust the Process");
  return lines.join("\n");
}

function safeName(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "debrief";
}

function escHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

/** Signature stable d'un debrief (pour fusionner sans index, le tableau étant partagé). */
function debriefSig(d: Debrief): string {
  return JSON.stringify([d.brand, d.creator, d.period, d.budget, d.revenue, d.summary, d.deliverables, d.kpis, d.highlights]);
}

/**
 * Bilan de campagne en HTML « pro » (aperçu, email, impression PDF).
 * `shotUrls` = URL signées déjà résolues (chemin → URL) ; sans elles, l'annexe captures
 * est simplement omise plutôt que d'afficher des images cassées.
 */
function debriefHTML(d: Debrief, shotUrls: Record<string, string> = {}): string {
  const burgundy = "#3d0000";
  const kpis = d.kpis.filter((k) => k.v && k.v !== "—");
  const cell = (k: Kpi) =>
    `<td width="50%" style="padding:6px;vertical-align:top"><div style="border:1px solid #ececec;border-radius:12px;padding:12px 14px">` +
    `<div style="font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:#8a8a8a">${escHtml(kpiLabel(k.l, d))}</div>` +
    `<div style="font-size:20px;font-weight:800;color:#111;margin-top:2px">${escHtml(k.v)}</div></div></td>`;
  let kpiRows = "";
  for (let i = 0; i < kpis.length; i += 2) {
    kpiRows += `<tr>${cell(kpis[i])}${kpis[i + 1] ? cell(kpis[i + 1]) : '<td width="50%"></td>'}</tr>`;
  }
  const highlights = d.highlights
    .filter(Boolean)
    .map((h) => `<div style="margin:5px 0;font-size:14px;color:#222"><span style="color:#16a34a;font-weight:700">✓</span>&nbsp; ${escHtml(h)}</div>`)
    .join("");
  const shots = (d.calc?.shots ?? []).map((s) => shotUrls[s.path]).filter(Boolean);
  const shotsBlock = shots.length
    ? `<div style="margin-top:20px;border-top:1px solid #ececec;padding-top:14px">` +
      `<div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#8a8a8a;margin-bottom:8px">Annexe — captures des statistiques</div>` +
      `<table style="border-collapse:collapse"><tr>` +
      shots
        .map((u) => `<td style="padding:4px;vertical-align:top"><img src="${escHtml(u)}" alt="" style="width:120px;border:1px solid #ececec;border-radius:8px;display:block"></td>`)
        .join("") +
      `</tr></table></div>`
    : "";
  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#111">` +
    `<div style="max-width:640px;margin:0 auto;padding:24px">` +
    `<div style="background:#fff;border-radius:18px;overflow:hidden;border:1px solid #ececec">` +
    `<div style="background:${burgundy};color:#fff;padding:22px 26px">` +
    `<div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:.85">TTP Creators · Bilan de campagne</div>` +
    `<div style="font-size:24px;font-weight:800;margin-top:6px">${escHtml(d.brand)}${d.creator ? ` × ${escHtml(titleCase(d.creator))}` : ""}</div>` +
    (d.period && d.period !== "—" ? `<div style="opacity:.85;margin-top:2px">${escHtml(d.period)}</div>` : "") +
    `</div><div style="padding:24px 26px">` +
    `<table style="width:100%"><tr>` +
    `<td style="font-size:15px;color:#333">Budget HT <b>${escHtml(d.budget)}</b> &nbsp;→&nbsp; CA généré <b style="color:#16a34a">${escHtml(d.revenue)}</b></td>` +
    (d.roi && d.roi !== "—" ? `<td align="right"><span style="background:#dcfce7;color:#15803d;font-weight:800;border-radius:999px;padding:6px 14px;font-size:14px">CA généré : ${escHtml(roasText(d.roi))}</span></td>` : "") +
    `</tr></table>` +
    (d.deliverables && d.deliverables !== "—" ? `<div style="margin-top:10px;font-size:13px;color:#666">Livrables : ${escHtml(d.deliverables)}</div>` : "") +
    (d.summary && d.summary !== "—" ? `<p style="margin:16px 0;font-size:14px;line-height:1.6;color:#222">${escHtml(d.summary)}</p>` : "") +
    (kpis.length ? `<table style="width:100%;border-collapse:collapse;margin:8px 0">${kpiRows}</table>` : "") +
    (highlights ? `<div style="margin-top:16px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#8a8a8a;margin-bottom:6px">Points forts</div>${highlights}</div>` : "") +
    (d.renewal?.trim() ? `<div style="margin-top:18px;border-radius:12px;background:#f7f3ee;padding:14px 16px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:${burgundy};margin-bottom:6px;font-weight:700">Et ensuite ?</div><div style="font-size:14px;line-height:1.6;color:#222">${escHtml(d.renewal.trim())}</div></div>` : "") +
    shotsBlock +
    `</div>` +
    `<div style="border-top:1px solid #ececec;padding:16px 26px;font-size:12px;color:#8a8a8a">TTP Creators · Trust the Process · partnerships@ttpcreators.pro · ttpcreators.pro</div>` +
    `</div></div></body></html>`
  );
}

/**
 * PDF du debrief — identité de document partagée (cf. `src/lib/pdfDoc.ts`).
 * SÉPARÉ de `debriefHTML` : celui-ci sert de corps d'EMAIL (Gmail/Resend) et doit
 * rester en tableaux + styles en ligne. Ne pas fusionner les deux.
 */
function debriefPdfHTML(d: Debrief, shotUrls: Record<string, string> = {}): string {
  const money =
    `<div class="money"><span><span class="k">Budget HT</span><b>${escHtml(d.budget)}</b></span>` +
    `<span class="arrow">→</span><span><span class="k">CA généré</span><b>${escHtml(d.revenue)}</b></span>` +
    (d.roi && d.roi !== "—" ? `<span class="roi"><span class="k">CA généré / budget</span><b>${escHtml(roasText(d.roi))}</b></span>` : "") +
    `</div>`;
  const shots = (d.calc?.shots ?? []).map((s) => shotUrls[s.path]).filter(Boolean);
  const body =
    money +
    pdfMeta([
      ["Créateur", d.creator ? titleCase(d.creator) : ""],
      ["Période", d.period],
      ["Livrables", d.deliverables],
    ]) +
    (d.summary && d.summary !== "—" ? pdfSection("Synthèse", `<p class="lede">${escHtml(d.summary)}</p>`) : "") +
    (d.kpis.length ? pdfSection("Indicateurs", pdfKpis(d.kpis.map((k) => ({ ...k, l: kpiLabel(k.l, d) })))) : "") +
    (d.highlights.length ? pdfSection("Points forts", pdfTicks(d.highlights)) : "") +
    (d.renewal?.trim() ? pdfSection("Et ensuite ?", `<p class="lede">${escHtml(d.renewal.trim())}</p>`) : "") +
    (shots.length ? pdfSection("Captures des statistiques", pdfShots(shots)) : "");
  return pdfShell({
    title: pdfFileTitle("Debrief", [d.brand, d.creator ? titleCase(d.creator) : ""].filter(Boolean).join(" x ")),
    eyebrow: "Bilan de campagne",
    heading: pdfHeading(d.brand, d.creator ? titleCase(d.creator) : undefined),
    sub: d.period && d.period !== "—" ? d.period : undefined,
    body,
  });
}

type DebriefView = "cards" | "list" | "table";

/** Garantit que kpis/highlights/calc ont la bonne forme (blob partiel/legacy toléré). */
function normDebrief(d: Debrief): Debrief {
  return {
    ...d,
    kpis: Array.isArray(d.kpis) ? d.kpis : [],
    highlights: Array.isArray(d.highlights) ? d.highlights : [],
    calc: d.calc ? normCalc(d.calc) : undefined,
  };
}

export function Debrief() {
  const { data, loading, error } = useAppState<Debrief[]>(
    // Normalise kpis/highlights en tableaux : un blob partiel/legacy sans l'un des
    // deux ferait planter le rendu (.length/.map). Garde-fou de forme à la source.
    // On garde la sémantique « null = pas encore chargé » (cf. `data === null` plus bas).
    (s: AppState) => {
      const raw = s["debriefData"] as Debrief[] | undefined;
      return (raw ? raw.map(normDebrief) : null) as Debrief[];
    }
  );
  const creators = useCreators();

  // Copie locale (après une écriture) ; remise à zéro dès que les données live changent.
  const [local, setLocal] = useState<Debrief[] | null>(null);
  useEffect(() => {
    setLocal(null);
  }, [data]);
  // Blob vide : état vide (plus de debrief de démo affiché ni compté comme réel).
  const list: Debrief[] = local ?? data ?? [];

  // Rappel : briefs (campagnes) TERMINÉS ou échus, pas encore débriefés → à débriefer.
  const [briefRows, setBriefRows] = useState<{ id: string; brand: string; creator: string | null; status: string; due: string | null }[]>([]);
  useEffect(() => {
    supabase.from("briefs").select("id, brand, creator, status, due").then(({ data: b }) => setBriefRows((b as typeof briefRows) ?? []));
  }, []);
  const brandKey = (s: string | null) => (s || "").toLowerCase().split(/[×x·]/)[0].trim();
  const duePast = (due: string | null) => {
    const t = (due || "").trim();
    let iso = "";
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) iso = t.slice(0, 10);
    else { const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t); if (m) iso = `${m[3]}-${m[2]}-${m[1]}`; }
    return iso ? iso < todayISO() : false; // date LOCALE (pas d'UTC : décalage en soirée)
  };
  const briefDone = (b: { status: string; due: string | null }) =>
    (b.status || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").includes("termin") || duePast(b.due);
  const debriefedKeys = new Set(list.map((d) => brandKey(d.brand)).filter(Boolean));
  const needsDebrief = briefRows.filter((b) => b.brand && briefDone(b) && !debriefedKeys.has(brandKey(b.brand)));

  const [view, setView] = useStickyState<DebriefView>("debrief:vue", ["cards", "list", "table"], "cards");
  const [viewD, setViewD] = useState<Debrief | null>(null); // fiche détail (clic sur une ligne)
  const [formOpen, setFormOpen] = useState(false);
  // Bilan en cours d'édition, mémorisé tel qu'ouvert (pas son index : la liste peut se
  // recharger pendant l'édition). Retrouvé par signature dans la liste fraîche à l'enregistrement.
  const [editing, setEditing] = useState<Debrief | null>(null);
  const [brand, setBrand] = useState("");
  const [creator, setCreator] = useState("");
  const [period, setPeriod] = useState("");
  const [budget, setBudget] = useState("");
  const [revenue, setRevenue] = useState("");
  const [summary, setSummary] = useState("");
  const [deliverables, setDeliverables] = useState("");
  const [reach, setReach] = useState("");
  const [engagement, setEngagement] = useState("");
  const [clics, setClics] = useState("");
  const [ventes, setVentes] = useState("");
  const [highlightsText, setHighlightsText] = useState("");
  const [calc, setCalc] = useState<CalcState>(CALC_EMPTY);
  const [renewal, setRenewal] = useState("");
  const [fromCollab, setFromCollab] = useState<string | null>(null); // bilan préparé depuis une collab

  // Bilans automatiques : collabs publiées depuis 7 jours, pas encore débriefées.
  const [recapCollabs, setRecapCollabs] = useState<(CollabForRecap & { pub: string | null })[]>([]);
  useEffect(() => {
    void (async () => {
      const { data: cols } = await supabase.from("collabs").select("id, brand, creator, deliverables, cachet, step, status, created_at, ig, tt, yt")
        .in("step", [6, 7]).neq("status", "archivee").limit(200);
      const list = (cols as (CollabForRecap & { status: string })[] | null) ?? [];
      if (!list.length) return setRecapCollabs([]);
      const { data: st } = await supabase.from("collab_steps").select("collab_id, step, reached_at").in("collab_id", list.map((c) => c.id)).gte("step", 6);
      const steps = (st as StepRow[] | null) ?? [];
      setRecapCollabs(list.map((c) => ({ ...c, pub: publicationDate(c, steps) })).filter((c) => readyForRecap(c.pub)));
    })();
  }, []);
  // « Préparer le bilan » depuis la fiche collab (étape 11) : bilan prérempli, même s'il
  // n'est pas encore dans la liste des bilans prêts (publication de moins de 7 jours…).
  useIntent("collab:recap", (id) => {
    if (!id) return;
    void (async () => {
      const { data: c } = await supabase.from("collabs").select("id, brand, creator, deliverables, cachet, step, created_at, ig, tt, yt").eq("id", id).maybeSingle();
      if (!c) return toast("Collab introuvable");
      const { data: st } = await supabase.from("collab_steps").select("collab_id, step, reached_at").eq("collab_id", id).gte("step", 6);
      const col = c as CollabForRecap;
      void prepareFromCollab({ ...col, pub: publicationDate(col, (st as StepRow[] | null) ?? []) });
    })();
  });
  // Partage à la marque (email)
  const [shareD, setShareD] = useState<Debrief | null>(null);
  const [shareTo, setShareTo] = useState("");
  const [shareSubject, setShareSubject] = useState("");
  const [shareVia, setShareVia] = useState<"gmail" | "resend">("gmail");
  const [shareSending, setShareSending] = useState(false);
  // Captures du debrief en cours de partage : résolues ici pour que l'aperçu ET l'email
  // partent avec les mêmes URL signées (7 j de validité côté marque).
  const shareShotUrls = useShotUrls(shareD?.calc?.shots);


  function resetForm() {
    setBrand("");
    setCreator("");
    setPeriod("");
    setBudget("");
    setRevenue("");
    setSummary("");
    setDeliverables("");
    setReach("");
    setEngagement("");
    setClics("");
    setVentes("");
    setHighlightsText("");
    setCalc(CALC_EMPTY);
    setRenewal("");
    setFromCollab(null);
    setEditing(null);
  }
  const kpiVal = (d: Debrief, label: string) => d.kpis.find((k) => k.l.toLowerCase().startsWith(label.toLowerCase().slice(0, 5)))?.v ?? "";

  function openCreate() {
    resetForm();
    setFormOpen(true);
  }

  // Crée un débrief pré-rempli à partir d'un brief (marque + créateur).
  function createFromBrief(b: { brand: string; creator: string | null }) {
    resetForm();
    setBrand(b.brand || "");
    setCreator(b.creator || "");
    setFormOpen(true);
  }

  function startEdit(d: Debrief) {
    setEditing(d);
    setBrand(d.brand === "—" ? "" : d.brand);
    setCreator(d.creator);
    setPeriod(d.period === "—" ? "" : d.period);
    setBudget(d.budget === "—" ? "" : d.budget);
    setRevenue(d.revenue === "—" ? "" : d.revenue);
    setSummary(d.summary === "—" ? "" : d.summary);
    setDeliverables(d.deliverables === "—" ? "" : d.deliverables);
    setReach(kpiVal(d, "Reach"));
    setEngagement(kpiVal(d, "Engagement"));
    setClics(kpiVal(d, "Clics"));
    setVentes(kpiVal(d, "Ventes"));
    setHighlightsText(d.highlights.join("\n"));
    setCalc(normCalc(d.calc));
    setRenewal(d.renewal ?? "");
    setFromCollab(d.collabId ?? null);
    setFormOpen(true);
  }

  // Bilan pré-rempli à partir des chiffres d'une collab publiée depuis 7 jours.
  async function prepareFromCollab(c: CollabForRecap & { pub: string | null }) {
    resetForm();
    const cr = creators.find((x) => x.name.toLowerCase() === (c.creator ?? "").toLowerCase());
    // Abonnés PAR réseau : un taux sur les abonnés n'a de sens qu'avec ceux du réseau des
    // contenus (les abonnés Instagram ne valent pas pour une vidéo TikTok).
    const followersBy: { instagram?: number; tiktok?: number; youtube?: number } = {};
    if (cr) {
      const { data } = await supabase.from("creators").select("ig, tt, yt").eq("id", cr.id).maybeSingle();
      const row = data as { ig?: { followers?: number | null } | null; tt?: { followers?: number | null } | null; yt?: { subscribers?: number | null } | null } | null;
      followersBy.instagram = row?.ig?.followers || 0;
      followersBy.tiktok = row?.tt?.followers || 0;
      followersBy.youtube = row?.yt?.subscribers || 0;
    }
    const r = buildRecap(c, c.pub, followersBy);
    setBrand(c.brand);
    setCreator(cr?.name ?? c.creator ?? "");
    setPeriod(r.period);
    setBudget(r.budget);
    setDeliverables(r.deliverables);
    setSummary(r.summary);
    setReach(r.reach);
    setEngagement(r.engagement);
    setHighlightsText(r.highlights.join("\n"));
    setRenewal(r.renewal);
    setCalc({ ...CALC_EMPTY, mode: "detail", stats: r.stats, followers: r.followers ? String(r.followers) : "", basis: r.basis });
    setFromCollab(c.id);
    setFormOpen(true);
    toast("Bilan pré-rempli avec les chiffres des posts : vérifie, complète le CA, puis enregistre");
  }

  async function save() {
    const b = brand.trim();
    if (!b) {
      toast("Indique la marque / campagne");
      return;
    }
    // Montant ambigu (« 800 € x 2 ») : gardé tel que saisi, mais AUCUN calcul (ratio, coûts).
    const budN = parseAmountStrict(budget);
    const revN = parseAmountStrict(revenue);
    if ((budget.trim() && budN === null) || (revenue.trim() && revN === null)) {
      toast("Montant à plusieurs nombres : enregistré tel quel, sans calcul. Indique un seul montant pour avoir les coûts");
    }
    const roi = budN && budN > 0 && revN !== null ? (revN / budN).toFixed(1).replace(".", ",") + "×" : "—";
    // Coûts réels de la campagne (budget ÷ chiffres du calculateur) : ce que la marque compare.
    const calcStats = calc.mode === "global" ? calc.stats.slice(0, 1) : calc.stats;
    const tot = engTotals(calcStats, engParse(calc.followers), calc.mode === "global" ? engParse(calc.postsCount) : undefined);
    // Coût pour 1000 vues / personnes touchées seulement si CHAQUE contenu a ses vues / sa couverture.
    const costs = campaignCosts(budN, tot, calcStats);
    const eur = (n: number | null, dec = false) => (n == null ? "" : dec ? `${n.toFixed(2).replace(".", ",")} €` : formatEuro(Math.round(n)));
    const kpis: Kpi[] = [
      { l: "Reach", v: reach.trim() },
      { l: "Engagement", v: engagement.trim() },
      { l: "Clics", v: clics.trim() },
      { l: "Ventes attribuées", v: ventes.trim() },
      { l: "Coût pour 1000 vues (CPM)", v: eur(costs.cpm, true) },
      // Couverture de plusieurs contenus additionnée : une personne peut compter plusieurs fois.
      { l: tot.posts > 1 ? "Coût pour 1000 de couverture cumulée" : "Coût pour 1000 personnes touchées", v: eur(costs.cpmReach, true) },
      { l: "Coût par interaction", v: eur(costs.cpe, true) },
    ].filter((k) => k.v);
    const highlights = highlightsText.split("\n").map((h) => h.trim()).filter(Boolean);
    const deliv = deliverables.trim() || "—";
    const original = editing;
    const wasEdit = !!original;
    const built: Debrief = {
      ...(original ?? { tone: "cyan" }),
      brand: b,
      creator: creator.trim(),
      period: period.trim() || "—",
      deliverables: deliv,
      budget: budN ? formatEuro(budN) : budN === null && budget.trim() ? budget.trim() : "—",
      revenue: revN ? formatEuro(revN) : revN === null && revenue.trim() ? revenue.trim() : "—",
      roi,
      tone: original?.tone ?? "cyan",
      summary: summary.trim() || "—",
      kpis,
      highlights,
      calc,
      renewal: renewal.trim() || undefined,
      collabId: fromCollab ?? original?.collabId,
    };
    // Relecture FRAÎCHE + fusion par signature (le tableau est partagé entre postes).
    // Le formulaire ne se ferme qu'une fois l'écriture réussie (sinon la saisie reste).
    try {
      invalidateAppState();
      // Normalisé comme `list` : sinon la signature d'une entrée legacy ne correspond jamais.
      const fresh = (((await getAppState())["debriefData"] as Debrief[]) ?? []).map(normDebrief);
      let next: Debrief[];
      if (original) {
        const os = debriefSig(original);
        const idx = fresh.findIndex((d) => debriefSig(d) === os);
        // Disparu (supprimé ou modifié sur un autre poste) : on n'écrase rien, la saisie reste.
        if (idx < 0) {
          toast("Ce bilan a été modifié ou supprimé ailleurs : ferme et rouvre-le pour reprendre");
          return;
        }
        next = fresh.map((d, i) => (i === idx ? built : d));
      } else {
        next = [built, ...fresh];
      }
      if (!(await saveAppStateKey("debriefData", next))) {
        toast("Erreur, réessaie");
        return;
      }
      setLocal(next);
      // Bilan d'une collab : elle passe à l'étape « Statistiques à sept jours » si elle n'y est pas encore.
      if (fromCollab) {
        const c = recapCollabs.find((x) => x.id === fromCollab);
        if (c && c.step < 7) void dbUpdate("collabs", c.id, { step: 7 });
        setRecapCollabs((xs) => xs.filter((x) => x.id !== fromCollab));
      }
      resetForm();
      setFormOpen(false);
      if (!wasEdit && built.creator) notifyCreator("debrief", built.creator, built.brand); // push au créateur à la création
      toast(wasEdit ? "Debrief modifié ✓" : "Debrief créé ✓");
    } catch {
      toast("Erreur, réessaie");
    }
  }

  async function remove(d: Debrief) {
    try {
      invalidateAppState();
      const fresh = (((await getAppState())["debriefData"] as Debrief[]) ?? []).map(normDebrief);
      const s = debriefSig(d);
      const next = fresh.filter((x) => debriefSig(x) !== s);
      if (!(await saveAppStateKey("debriefData", next))) return toast("Erreur, réessaie");
      setLocal(next);
      toast("Supprimé");
    } catch {
      toast("Erreur, réessaie");
    }
  }

  async function shareDebrief(d: Debrief) {
    const text = debriefToText(d);
    const title = `Debrief — ${d.brand} × ${titleCase(d.creator)}`;
    if (navigator.share) {
      try {
        await navigator.share({ title, text });
        return;
      } catch {
        /* annulé → presse-papiers */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast("Debrief copié ✓");
    } catch {
      window.prompt("Copie le debrief :", text);
    }
  }

  function downloadDebrief(d: Debrief) {
    const blob = new Blob([debriefToText(d)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `debrief-${safeName(d.brand)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Révocation différée : sinon le téléchargement peut être annulé (Safari).
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast("Debrief téléchargé ✓");
  }

  function openShare(d: Debrief) {
    setShareD(d);
    setShareTo("");
    setShareSubject(`Bilan de campagne — ${d.brand}`);
    setShareVia("gmail");
  }
  // `printHtml` = iframe caché même origine → pas de pop-up à autoriser (et cohérent
  // avec Contrats / Briefs). L'await sur les captures ne pose donc plus de problème
  // de « geste utilisateur perdu » comme avec window.open.
  async function printDebrief(d: Debrief) {
    printHtml(debriefPdfHTML(d, await resolveShots(d.calc?.shots)));
    toast("Dans la fenêtre : choisis « Enregistrer au format PDF »");
  }
  async function sendDebriefEmail() {
    if (!shareD || shareSending) return;
    const to = shareTo.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      toast("Email destinataire invalide");
      return;
    }
    const subject = shareSubject.trim() || `Bilan de campagne — ${shareD.brand}`;
    setShareSending(true);
    try {
      const html = debriefHTML(shareD, shareShotUrls);
      const jsonOf = async (error: unknown, data: unknown) => {
        if (error && (error as { context?: { json?: () => Promise<unknown> } }).context?.json)
          return await (error as { context: { json: () => Promise<unknown> } }).context.json().catch(() => null);
        return data;
      };
      const fn = shareVia === "gmail" ? "gmail-send" : "send-email";
      const { data, error } = await supabase.functions.invoke(fn, { body: { to, subject, html, source: "debrief" } });
      const res = (await jsonOf(error, data)) as { ok?: boolean; error?: string; detail?: string } | null;
      if (!res?.ok) {
        if (res?.error === "google_non_connecte" || res?.error === "gmail_scope_manquant") toast("Reconnecte Google (droits Gmail).");
        else toast(res?.detail ? `Échec : ${res.detail}` : "Envoi échoué — réessaie");
        return;
      }
      toast("Debrief envoyé à la marque ✓");
      setShareD(null);
    } finally {
      setShareSending(false);
    }
  }

  const actions = (d: Debrief) => (
    <ActionMenu
      items={[
        { key: "view", label: "Voir la fiche", icon: Eye, onClick: () => setViewD(d) },
        { key: "edit", label: "Modifier", icon: Pencil, onClick: () => startEdit(d) },
        { key: "sharebrand", label: "Partager à la marque", icon: Send, onClick: () => openShare(d) },
        { key: "preview", label: "Aperçu / PDF", icon: Eye, onClick: () => printDebrief(d) },
        { key: "copy", label: "Copier le texte", icon: Share2, onClick: () => shareDebrief(d) },
        { key: "download", label: "Télécharger (.txt)", icon: Download, onClick: () => downloadDebrief(d) },
        { key: "delete", label: "Supprimer définitivement", icon: Trash2, danger: true, onClick: () => remove(d), confirm: { title: "Supprimer définitivement", message: `Supprimer le debrief « ${d.brand} » ? Cette action est irréversible.`, confirmLabel: "Supprimer définitivement" } },
      ]}
    />
  );

  return (
    <div className="space-y-4">
      {/* En-tête : résumé + action */}
      <PageHeaderRow>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {loading ? (
            <AnimatedBadge status="loading" size="sm">
              Chargement…
            </AnimatedBadge>
          ) : (
            <>
              <span className="font-semibold text-foreground">{list.length}</span>
              <span>{list.length > 1 ? "bilans de campagne" : "bilan de campagne"}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {list.length > 0 && (
            <Tabs
              label="Affichage des bilans"
              value={view}
              onValueChange={(v) => setView(v as DebriefView)}
              items={[
                { value: "cards", label: "Cartes", icon: <LayoutGrid className="h-4 w-4" />, hideLabel: "mobile" },
                { value: "list", label: "Liste", icon: <List className="h-4 w-4" />, hideLabel: "mobile" },
                { value: "table", label: "Tableau", icon: <Table2 className="h-4 w-4" />, hideLabel: "mobile" },
              ]}
            />
          )}
          <AddButton label="Debrief" onClick={openCreate} />
        </div>
      </PageHeaderRow>

      {/* Synthèse (bento) */}
      {list.length > 0 && (() => {
        const sumRevenue = list.reduce((s, d) => s + amountOf(d.revenue), 0);
        const sumBudget = list.reduce((s, d) => s + amountOf(d.budget), 0);
        const roiStr = sumBudget > 0 ? (sumRevenue / sumBudget).toFixed(1).replace(".", ",") + "×" : "—";
        return (
          <StatsBento phoneStrip
            primary={{ eyebrow: "CA généré · bilans", value: formatEuro(sumRevenue), caption: `${list.length} campagne${list.length > 1 ? "s" : ""} · budget HT ${formatEuro(sumBudget)}` }}
            bars={{ label: "CA par campagne", value: `CA : ${roasText(roiStr)}`, series: list.map((d) => amountOf(d.revenue)) }}
            small={{ value: String(list.length), label: "Campagnes" }}
            accent={{ value: String(needsDebrief.length), label: "À débriefer", icon: Activity }}
          />
        );
      })()}

      <InlineForm
        open={formOpen}
        title={editing ? "Modifier le debrief" : "Nouveau debrief"}
        onClose={() => {
          setFormOpen(false);
          resetForm();
        }}
        onSubmit={save}
        submitLabel={editing ? "Enregistrer" : "Créer le debrief"}
      >
        <TextField
          label="Marque / campagne"
          value={brand}
          onChange={setBrand}
          placeholder="Ex : Sézane, collection été"
          className="sm:min-w-[200px] flex-[2]"
        />
        <CreatorPickerField
          label="Créateur"
          value={creator}
          onChange={setCreator}
          creators={creators}
          className="sm:min-w-[170px] flex-1"
        />
        <TextField
          label="Période"
          value={period}
          onChange={setPeriod}
          placeholder="Mars 2026"
          className="sm:min-w-[130px] flex-1"
        />
        <TextField
          label="Budget HT"
          value={budget}
          onChange={setBudget}
          placeholder="3 000 €"
          className="sm:min-w-[120px] flex-1"
        />
        <TextField
          label="CA généré"
          value={revenue}
          onChange={setRevenue}
          placeholder="12 000 €"
          className="sm:min-w-[120px] flex-1"
        />
        <TextField
          label="Synthèse (optionnel)"
          value={summary}
          onChange={setSummary}
          placeholder="Bilan de la campagne…"
          className="min-w-full flex-[3]"
        />
        <TextField label="Livrables" value={deliverables} onChange={setDeliverables} placeholder="3 Reels · 5 Stories…" className="min-w-full flex-[2]" />
        <DebriefCalculator
          // Remonte le composant quand on change de debrief édité SANS fermer le
          // formulaire (ex : « Modifier » sur une autre ligne). Sinon la copie locale
          // des lignes (`rows`, initialisée une seule fois) reste celle du précédent.
          key={editing ? debriefSig(editing) : "new"}
          slug={safeName(creator || brand)}
          state={calc}
          onChange={setCalc}
          igFor={{ brand, creator }}
          onApply={({ reach: r, engagement: e }) => {
            if (r) setReach(r);
            setEngagement(e);
          }}
        />
        <TextField label={contentCount(calc) > 1 ? "Couverture cumulée" : "Couverture"} value={reach} onChange={setReach} placeholder="480 K" className="sm:min-w-[110px] flex-1" />
        <TextField label="Engagement" value={engagement} onChange={setEngagement} placeholder="6,4 %" className="sm:min-w-[110px] flex-1" />
        <TextField label="Clics" value={clics} onChange={setClics} placeholder="9 200" className="sm:min-w-[110px] flex-1" />
        <TextField label="Ventes attribuées" value={ventes} onChange={setVentes} placeholder="310" className="sm:min-w-[130px] flex-1" />
        <label className="flex min-w-full flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Points forts (un par ligne)</span>
          <textarea
            value={highlightsText}
            onChange={(e) => setHighlightsText(e.target.value)}
            rows={3}
            placeholder={"Reel « routine matinale » : 210 K vues\nCode promo utilisé 310 fois en 10 jours"}
            className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </label>
        <label className="flex min-w-full flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Et ensuite ? Proposition de renouvellement (fin du bilan, facultatif)</span>
          <textarea
            value={renewal}
            onChange={(e) => setRenewal(e.target.value)}
            rows={3}
            placeholder="Nous vous proposons de prolonger le partenariat sur trois mois…"
            className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </label>
      </InlineForm>

      {/* Bilans prêts : collabs publiées depuis 7 jours, chiffres disponibles */}
      {(() => {
        // Déjà débriefée : bilan lié à la collab, ou bilan saisi à la main pour la même marque et le même créateur.
        const pair = (b: string | null, c: string | null) => `${brandKey(b)}|${(c ?? "").toLowerCase().trim()}`;
        const done = new Set(list.flatMap((d) => (d.collabId ? [d.collabId] : [pair(d.brand, d.creator)])));
        const ready = recapCollabs.filter((c) => !done.has(c.id) && !done.has(pair(c.brand, c.creator)));
        if (!ready.length) return null;
        return (
          <div className="mb-4 rounded-2xl border border-border bg-foreground/[0.06] p-4">
            <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-primary">
              <Sparkles className="h-4 w-4 shrink-0" /> {ready.length} bilan{ready.length > 1 ? "s" : ""} prêt{ready.length > 1 ? "s" : ""} à préparer
            </div>
            <p className="mb-2.5 text-[12px] text-muted-foreground">Collabs publiées depuis 7 jours : le bilan se remplit tout seul avec les chiffres des posts, et se termine par une proposition de renouvellement.</p>
            <div className="flex flex-col gap-2">
              {ready.map((c) => {
                const posts = (c.ig?.posts?.length ?? 0) + (c.tt?.posts?.length ?? 0) + (c.yt?.posts?.length ?? 0);
                return (
                  <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-foreground">{c.brand} × {titleCase(c.creator ?? "")}</div>
                      <div className="truncate text-[11px] text-faint">
                        Publiée le {fmtDay(c.pub) || EMPTY} · {posts ? `${posts} contenu${posts > 1 ? "s" : ""} repéré${posts > 1 ? "s" : ""}` : "aucun contenu repéré (chiffres à saisir)"}
                      </div>
                    </div>
                    <button type="button" onClick={() => void prepareFromCollab(c)}
                      className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90">
                      Préparer le bilan
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Rappel : campagnes (briefs) terminées sans débrief → à débriefer */}
      {needsDebrief.length > 0 && (
        <div className="mb-4 rounded-2xl border border-border bg-foreground/[0.06] p-4">
          <div className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-amber">
            <FileText className="h-4 w-4 shrink-0" /> {needsDebrief.length} campagne{needsDebrief.length > 1 ? "s" : ""} à débriefer
          </div>
          <div className="flex flex-col gap-2">
            {needsDebrief.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-foreground">{b.brand}</div>
                  <div className="truncate text-[11px] text-faint">
                    {b.creator ? titleCase(b.creator) : "—"} · brief {(b.status || "").toLowerCase().includes("termin") ? "terminé" : "échéance passée"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => createFromBrief(b)}
                  className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Créer le débrief
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Contenu */}
      {loading ? (
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <AnimatedBadge status="loading" size="sm">
            Chargement…
          </AnimatedBadge>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <AnimatedBadge status="danger" size="sm">
            Erreur de chargement
          </AnimatedBadge>
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface px-6 py-12 text-center shadow-sm">
          <div className="mx-auto mb-3 w-fit"><FileCard formatFile="doc" /></div>
          <div className="text-sm font-medium text-foreground">Aucun debrief pour le moment</div>
          <div className="mt-1.5 text-xs text-faint">
            Crée un bilan de campagne avec le bouton « + Debrief ».
          </div>
        </div>
      ) : view === "cards" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {list.map((d, index) => (
            <article
              key={`${d.brand}-${index}`}
              className="flex flex-col rounded-2xl border border-border bg-surface p-5 shadow-sm"
            >
              {/* Titre + CA généré / budget + actions */}
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {d.brand} <span className="text-faint">×</span> {titleCase(d.creator)}
                  </div>
                  {d.period && d.period !== "—" && (
                    <div className="mt-0.5 text-[11px] text-faint">{d.period}</div>
                  )}
                </div>
                <span className="shrink-0 whitespace-nowrap rounded-full bg-signalsoft px-2.5 py-1 text-[12px] font-medium text-signaltext">
                  CA : {roasText(d.roi)}
                </span>
              </div>

              {/* Budget HT → CA */}
              <div className="mt-3 flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Budget HT {d.budget}</span>
                <span className="text-faint">→</span>
                <span className="font-semibold text-signaltext">{d.revenue}</span>
              </div>

              {/* Synthèse */}
              {d.summary && d.summary !== "—" && (
                <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">{d.summary}</p>
              )}

              {/* Points forts */}
              {d.highlights.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {d.highlights.map((h, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] text-foreground">
                      <span className="mt-0.5 shrink-0 font-bold text-signaltext">✓</span>
                      <span className="flex-1">{h}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Petites stats KPI */}
              {d.kpis.length > 0 && (
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {d.kpis.map((k, i) => (
                    <div key={i} className="rounded-xl bg-panel px-3 py-2.5">
                      <div className="text-[10px] font-medium text-muted-foreground">
                        {kpiLabel(k.l, d)}
                      </div>
                      <div className="mt-1 text-lg font-bold leading-none tracking-tight text-foreground">
                        {k.v}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Captures des stats jointes (privées — URL signées) */}
              <ShotStrip shots={d.calc?.shots} />

              {/* Barre d'actions */}
              <div className="mt-4 flex items-center justify-end gap-1 border-t border-border pt-3">
                {actions(d)}
              </div>
            </article>
          ))}
        </div>
      ) : view === "list" ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          {list.map((d, index) => (
            <div
              key={`${d.brand}-${index}`}
              onClick={() => setViewD(d)}
              className="flex cursor-pointer items-center gap-3 border-b border-border px-4 py-3.5 last:border-b-0 hover:bg-rowhover"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-foreground">
                  {d.brand} <span className="text-faint">×</span> {titleCase(d.creator)}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
                  {d.period && d.period !== "—" && <span>{d.period}</span>}
                  <span className="text-muted-foreground">
                    Budget HT {d.budget} <span className="text-faint">→</span>{" "}
                    <span className="font-semibold text-signaltext">{d.revenue}</span>
                  </span>
                </div>
              </div>
              <span className="hidden shrink-0 whitespace-nowrap rounded-full bg-signalsoft px-2.5 py-1 text-[12px] font-medium text-signaltext sm:inline">
                CA : {roasText(d.roi)}
              </span>
              <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>{actions(d)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-panel text-[12px] font-medium text-muted-foreground">
                <th className="px-4 py-3">Campagne</th>
                <th className="px-4 py-3">Créateur</th>
                <th className="px-4 py-3">Période</th>
                <th className="px-4 py-3 text-right">Budget HT</th>
                <th className="px-4 py-3 text-right">CA</th>
                <th className="px-4 py-3 text-center">CA / budget</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((d, index) => (
                <tr
                  key={`${d.brand}-${index}`}
                  onClick={() => setViewD(d)}
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-rowhover"
                >
                  <td className="px-4 py-3 text-[13px] font-semibold text-foreground">{d.brand}</td>
                  <td className="px-4 py-3 text-[13px] text-muted-foreground">{titleCase(d.creator)}</td>
                  <td className="px-4 py-3 text-[12px] text-faint">{d.period}</td>
                  <td className="px-4 py-3 text-right text-[13px] text-muted-foreground">{d.budget}</td>
                  <td className="px-4 py-3 text-right text-[13px] font-semibold text-signaltext">{d.revenue}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="whitespace-nowrap rounded-full bg-signalsoft px-2 py-0.5 text-[10px] font-semibold text-signaltext">
                      {d.roi}
                    </span>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">{actions(d)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Partager le debrief à la marque */}
      {shareD && (
        <Overlay className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" onClose={() => !shareSending && setShareD(null)}>
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">Partager le debrief à la marque</div>
                <div className="truncate text-[11px] text-faint">{shareD.brand}{shareD.creator ? ` × ${titleCase(shareD.creator)}` : ""}</div>
              </div>
              <button type="button" onClick={() => setShareD(null)} className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-muted-foreground">Email de la marque</span>
                  <input value={shareTo} onChange={(e) => setShareTo(e.target.value)} type="email" placeholder="contact@marque.com" className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-muted-foreground">Objet</span>
                  <input value={shareSubject} onChange={(e) => setShareSubject(e.target.value)} className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
                </label>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Aperçu (ce que reçoit la marque)</div>
                <iframe title="Aperçu debrief" srcDoc={debriefHTML(shareD, shareShotUrls)} sandbox="" className="h-[44vh] w-full rounded-lg border border-border bg-white" />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3.5">
              <Tabs
                size="sm"
                label="Envoyer via"
                value={shareVia}
                onValueChange={(v) => setShareVia(v as "gmail" | "resend")}
                items={[{ value: "gmail", label: "Depuis ma boîte Gmail" }, { value: "resend", label: "Envoi automatique" }]}
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => printDebrief(shareD)} className="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover">
                  <FileText className="h-3.5 w-3.5" /> PDF
                </button>
                <button type="button" onClick={sendDebriefEmail} disabled={shareSending} className="flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                  <Send className="h-3.5 w-3.5" /> {shareSending ? "Envoi…" : "Envoyer"}
                </button>
              </div>
            </div>
          </div>
        </Overlay>
      )}

      {/* Fiche détail (clic sur une ligne / « Voir la fiche ») */}
      {viewD && (
        <DebriefDetail
          d={viewD}
          onClose={() => setViewD(null)}
          onEdit={() => {
            const d = viewD;
            setViewD(null);
            startEdit(d);
          }}
          onShare={() => {
            const d = viewD;
            setViewD(null);
            openShare(d);
          }}
          onPdf={() => printDebrief(viewD)}
        />
      )}
    </div>
  );
}

/** Fiche détaillée d'un debrief : tout ce qui est saisi, en lecture, dans une modale. */
function DebriefDetail({
  d,
  onClose,
  onEdit,
  onShare,
  onPdf,
}: {
  d: Debrief;
  onClose: () => void;
  onEdit: () => void;
  onShare: () => void;
  onPdf: () => void;
}) {
  const kpis = d.kpis.filter((k) => k.v && k.v !== "—");
  // Résumé d'engagement recalculé depuis la saisie du calculateur (si présente).
  const calc = d.calc;
  const hasCalc = !!calc && (calc.stats.length > 0 || !!calc.followers);
  const override = calc?.mode === "global" ? engParse(calc.postsCount) : undefined;
  // Même règle que le calculateur : en mode global, seule la 1re ligne (totaux) compte.
  const calcStats = calc ? (calc.mode === "global" ? calc.stats.slice(0, 1) : calc.stats) : [];
  const t = hasCalc ? engTotals(calcStats, engParse(calc!.followers), override) : null;
  // Même règle que le calculateur : pas de taux sur une base mélangée.
  const er = t ? (calc!.basis === "followers" ? (singlePlatform(calcStats) ? t.erFollowers : null) : allHaveReach(calcStats) ? t.erReach : null) : null;

  return (
    <Overlay className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6" onClose={onClose}>
      <div className="my-2 w-full max-w-2xl rounded-2xl border border-border bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* En-tête */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-foreground">
              {d.brand} {d.creator && <span className="text-faint">× {titleCase(d.creator)}</span>}
            </div>
            {d.period && d.period !== "—" && <div className="mt-0.5 text-[12px] text-faint">{d.period}</div>}
          </div>
          <div className="flex items-center gap-2">
            {d.roi && d.roi !== "—" && (
              <span className="shrink-0 whitespace-nowrap rounded-full bg-signalsoft px-2.5 py-1 text-[12px] font-medium text-signaltext">
                CA : {roasText(d.roi)}
              </span>
            )}
            <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-4">
          {/* Budget → CA */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Budget HT <b className="text-foreground">{d.budget}</b></span>
            <span className="text-faint">→</span>
            <span className="text-muted-foreground">CA généré <b className="text-signaltext">{d.revenue}</b></span>
            {d.deliverables && d.deliverables !== "—" && <span className="text-[12px] text-faint">· {d.deliverables}</span>}
          </div>

          {d.summary && d.summary !== "—" && (
            <p className="text-[13px] leading-relaxed text-muted-foreground">{d.summary}</p>
          )}

          {/* Taux d'engagement calculé */}
          {t && (
            <div className="rounded-xl border border-border bg-panel p-3.5">
              <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Activity className="h-3.5 w-3.5" /> Engagement calculé
                <span className="ml-auto text-faint">{t.posts} publication{t.posts > 1 ? "s" : ""}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ["Taux retenu", fmtPct(er)],
                  [t.posts > 1 ? "Couverture cumulée" : "Couverture", fmtCompact(t.reach)],
                  ["Interactions", fmtCompact(t.interactions)],
                  ["Vues", fmtCompact(t.views)],
                ].map(([l, v]) => (
                  <div key={l} className="rounded-lg bg-surface px-2.5 py-2">
                    <div className="text-[10px] font-medium text-muted-foreground">{l}</div>
                    <div className="mt-0.5 text-[15px] font-bold leading-none tabular-nums text-foreground">{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* KPIs saisis */}
          {kpis.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-medium text-muted-foreground">Indicateurs</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {kpis.map((k, i) => (
                  <div key={i} className="rounded-xl bg-panel px-3 py-2.5">
                    <div className="text-[10px] font-medium text-muted-foreground">{kpiLabel(k.l, d)}</div>
                    <div className="mt-1 text-lg font-bold leading-none tracking-tight text-foreground">{k.v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Points forts */}
          {d.highlights.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-medium text-muted-foreground">Points forts</div>
              <ul className="space-y-1.5">
                {d.highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px] text-foreground">
                    <span className="mt-0.5 shrink-0 font-bold text-signaltext">✓</span>
                    <span className="flex-1">{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Captures */}
          {d.calc?.shots && d.calc.shots.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">Captures des stats</div>
              <ShotStrip shots={d.calc.shots} />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3.5">
          <button type="button" onClick={onEdit} className="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
            <Pencil className="h-3.5 w-3.5" /> Modifier
          </button>
          <button type="button" onClick={onPdf} className="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
            <FileText className="h-3.5 w-3.5" /> Aperçu / PDF
          </button>
          <button type="button" onClick={onShare} className="flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90">
            <Send className="h-3.5 w-3.5" /> Partager à la marque
          </button>
        </div>
      </div>
    </Overlay>
  );
}
