import { useState } from "react";
import { FileBarChart, Pencil, Share2, Download, LayoutGrid, List, Table2, Trash2, Send, Eye, X, FileText } from "lucide-react";
import {
  useAppState,
  saveAppStateKey,
  getAppState,
  invalidateAppState,
  parseAmount,
  formatEuro,
  type AppState,
} from "@/lib/appState";
import { supabase } from "@/lib/supabase";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { toast } from "@/components/ui/toast";
import { AddButton, InlineForm, TextField, SelectField } from "@/components/ui/form";
import { ActionMenu } from "@/components/ui/action-menu";
import { useCreators } from "@/lib/useCreators";
import { cn, titleCase } from "@/lib/utils";

/** Une petite statistique de campagne (label / valeur). */
type Kpi = { l: string; v: string };

/** Un debrief de campagne : bilan marque × créateur avec ROI et points forts. */
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
};

/** Valeurs de départ utiles quand le blob 'debriefData' est vide. */
const SEED: Debrief[] = [
  {
    brand: "Sézane × Léna",
    creator: "Léna Marchand",
    period: "Mars 2026",
    deliverables: "3 Reels · 5 Stories · 1 post carrousel",
    budget: "3 000 €",
    revenue: "12 000 €",
    roi: "4,0×",
    tone: "indigo",
    summary:
      "Campagne printemps performante : forte résonance sur les Reels, taux de conversion supérieur aux attentes de la marque.",
    kpis: [
      { l: "Reach", v: "480 K" },
      { l: "Engagement", v: "6,4 %" },
      { l: "Clics", v: "9 200" },
      { l: "Ventes attribuées", v: "310" },
    ],
    highlights: [
      "Reel « routine matinale » : 210 K vues, meilleur contenu du trimestre",
      "Code promo utilisé 310 fois en 10 jours",
      "La marque a reconduit pour la collection été",
    ],
  },
];

/** Formate un debrief en texte lisible (partage / téléchargement). */
function debriefToText(d: Debrief): string {
  const lines: string[] = [];
  lines.push(`${d.brand} × ${titleCase(d.creator)}`);
  if (d.period && d.period !== "—") lines.push(d.period);
  lines.push("");
  lines.push(`Budget : ${d.budget}  →  CA généré : ${d.revenue}   (ROI ${d.roi})`);
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
    d.kpis.forEach((k) => lines.push(`  • ${k.l} : ${k.v}`));
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

/** Bilan de campagne en HTML « pro » (aperçu, email, impression PDF). */
function debriefHTML(d: Debrief): string {
  const burgundy = "#3d0000";
  const kpis = d.kpis.filter((k) => k.v && k.v !== "—");
  const cell = (k: Kpi) =>
    `<td width="50%" style="padding:6px;vertical-align:top"><div style="border:1px solid #ececec;border-radius:12px;padding:12px 14px">` +
    `<div style="font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:#8a8a8a">${escHtml(k.l)}</div>` +
    `<div style="font-size:20px;font-weight:800;color:#111;margin-top:2px">${escHtml(k.v)}</div></div></td>`;
  let kpiRows = "";
  for (let i = 0; i < kpis.length; i += 2) {
    kpiRows += `<tr>${cell(kpis[i])}${kpis[i + 1] ? cell(kpis[i + 1]) : '<td width="50%"></td>'}</tr>`;
  }
  const highlights = d.highlights
    .filter(Boolean)
    .map((h) => `<div style="margin:5px 0;font-size:14px;color:#222"><span style="color:#16a34a;font-weight:700">✓</span>&nbsp; ${escHtml(h)}</div>`)
    .join("");
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
    `<td style="font-size:15px;color:#333">Budget <b>${escHtml(d.budget)}</b> &nbsp;→&nbsp; CA généré <b style="color:#16a34a">${escHtml(d.revenue)}</b></td>` +
    (d.roi && d.roi !== "—" ? `<td align="right"><span style="background:#dcfce7;color:#15803d;font-weight:800;border-radius:999px;padding:6px 14px;font-size:14px">ROI ${escHtml(d.roi)}</span></td>` : "") +
    `</tr></table>` +
    (d.deliverables && d.deliverables !== "—" ? `<div style="margin-top:10px;font-size:13px;color:#666">Livrables : ${escHtml(d.deliverables)}</div>` : "") +
    (d.summary && d.summary !== "—" ? `<p style="margin:16px 0;font-size:14px;line-height:1.6;color:#222">${escHtml(d.summary)}</p>` : "") +
    (kpis.length ? `<table style="width:100%;border-collapse:collapse;margin:8px 0">${kpiRows}</table>` : "") +
    (highlights ? `<div style="margin-top:16px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#8a8a8a;margin-bottom:6px">Points forts</div>${highlights}</div>` : "") +
    `</div>` +
    `<div style="border-top:1px solid #ececec;padding:16px 26px;font-size:12px;color:#8a8a8a">TTP Creators · Trust the Process · partnerships@ttpcreators.pro · ttpcreators.pro</div>` +
    `</div></div></body></html>`
  );
}

type DebriefView = "cards" | "list" | "table";

export function Debrief() {
  const { data, loading, error } = useAppState<Debrief[]>(
    (s: AppState) => (s["debriefData"] as Debrief[]) ?? null
  );
  const creators = useCreators();

  // Copie locale : le blob n'est chargé qu'une fois, on maintient l'état ici.
  const [local, setLocal] = useState<Debrief[] | null>(null);
  const list: Debrief[] = local ?? data ?? (data === null && !loading ? SEED : []);

  const [view, setView] = useState<DebriefView>("cards");
  const [formOpen, setFormOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
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

  // Partage à la marque (email)
  const [shareD, setShareD] = useState<Debrief | null>(null);
  const [shareTo, setShareTo] = useState("");
  const [shareSubject, setShareSubject] = useState("");
  const [shareVia, setShareVia] = useState<"gmail" | "resend">("gmail");
  const [shareSending, setShareSending] = useState(false);

  const creatorOptions = [
    { value: "", label: "— Choisir —" },
    ...creators.map((c) => ({ value: c.name, label: titleCase(c.name) })),
  ];

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
    setEditIndex(null);
  }
  const kpiVal = (d: Debrief, label: string) => d.kpis.find((k) => k.l.toLowerCase().startsWith(label.toLowerCase().slice(0, 5)))?.v ?? "";

  function openCreate() {
    resetForm();
    setFormOpen(true);
  }

  function startEdit(index: number) {
    const d = list[index];
    setEditIndex(index);
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
    setFormOpen(true);
  }

  async function save() {
    const b = brand.trim();
    if (!b) {
      toast("Indique la marque / campagne");
      return;
    }
    const budN = parseAmount(budget);
    const revN = parseAmount(revenue);
    const roi = budN > 0 ? (revN / budN).toFixed(1).replace(".", ",") + "×" : "—";
    const kpis: Kpi[] = [
      { l: "Reach", v: reach.trim() },
      { l: "Engagement", v: engagement.trim() },
      { l: "Clics", v: clics.trim() },
      { l: "Ventes attribuées", v: ventes.trim() },
    ].filter((k) => k.v);
    const highlights = highlightsText.split("\n").map((h) => h.trim()).filter(Boolean);
    const deliv = deliverables.trim() || "—";
    const wasEdit = editIndex !== null && !!list[editIndex];
    const original = wasEdit ? list[editIndex] : null;
    const built: Debrief = {
      ...(original ?? { tone: "cyan" }),
      brand: b,
      creator: creator.trim(),
      period: period.trim() || "—",
      deliverables: deliv,
      budget: budN ? formatEuro(budN) : "—",
      revenue: revN ? formatEuro(revN) : "—",
      roi,
      tone: original?.tone ?? "cyan",
      summary: summary.trim() || "—",
      kpis,
      highlights,
    };
    resetForm();
    setFormOpen(false);
    // Relecture FRAÎCHE + fusion par signature (le tableau est partagé entre postes).
    invalidateAppState();
    const fresh = ((await getAppState())["debriefData"] as Debrief[]) ?? [];
    let next: Debrief[];
    if (original) {
      const os = debriefSig(original);
      const idx = fresh.findIndex((d) => debriefSig(d) === os);
      next = idx >= 0 ? fresh.map((d, i) => (i === idx ? built : d)) : [built, ...fresh];
    } else {
      next = [built, ...fresh];
    }
    setLocal(next);
    const ok = await saveAppStateKey("debriefData", next);
    toast(ok ? (wasEdit ? "Debrief modifié ✓" : "Debrief créé ✓") : "Erreur — réessaie");
  }

  async function remove(d: Debrief) {
    invalidateAppState();
    const fresh = ((await getAppState())["debriefData"] as Debrief[]) ?? [];
    const s = debriefSig(d);
    const next = fresh.filter((x) => debriefSig(x) !== s);
    setLocal(next);
    const ok = await saveAppStateKey("debriefData", next);
    toast(ok ? "Supprimé" : "Erreur — réessaie");
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
    URL.revokeObjectURL(url);
    toast("Debrief téléchargé ✓");
  }

  function openShare(d: Debrief) {
    setShareD(d);
    setShareTo("");
    setShareSubject(`Bilan de campagne — ${d.brand}`);
    setShareVia("gmail");
  }
  function printDebrief(d: Debrief) {
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(debriefHTML(d));
      w.document.close();
      w.focus();
      w.print();
    } else toast("Autorise les pop-ups pour imprimer");
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
      const html = debriefHTML(shareD);
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

  const actions = (d: Debrief, index: number) => (
    <ActionMenu
      items={[
        { key: "edit", label: "Modifier", icon: Pencil, onClick: () => startEdit(index) },
        { key: "sharebrand", label: "Partager à la marque", icon: Send, onClick: () => openShare(d) },
        { key: "preview", label: "Aperçu / PDF", icon: Eye, onClick: () => printDebrief(d) },
        { key: "copy", label: "Copier le texte", icon: Share2, onClick: () => shareDebrief(d) },
        { key: "download", label: "Télécharger (.txt)", icon: Download, onClick: () => downloadDebrief(d) },
        { key: "delete", label: "Supprimer", icon: Trash2, danger: true, onClick: () => remove(d), confirm: { title: "Supprimer le debrief", message: `Supprimer le debrief « ${d.brand} » ? Cette action est irréversible.` } },
      ]}
    />
  );

  return (
    <div className="space-y-4">
      {/* En-tête : résumé + action */}
      <div className="flex flex-wrap items-center justify-between gap-3">
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
            <div className="flex items-center gap-1 rounded-xl border border-border bg-panel p-1">
              {(
                [
                  ["cards", LayoutGrid, "Cartes"],
                  ["list", List, "Liste"],
                  ["table", Table2, "Tableau"],
                ] as [DebriefView, typeof LayoutGrid, string][]
              ).map(([v, Icon, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  title={label}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors",
                    view === v
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-rowhover hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          )}
          <AddButton label="Debrief" onClick={openCreate} />
        </div>
      </div>

      <InlineForm
        open={formOpen}
        title={editIndex !== null ? "Modifier le debrief" : "Nouveau debrief"}
        onClose={() => {
          setFormOpen(false);
          resetForm();
        }}
        onSubmit={save}
        submitLabel={editIndex !== null ? "Enregistrer" : "Créer le debrief"}
      >
        <TextField
          label="Marque / campagne"
          value={brand}
          onChange={setBrand}
          placeholder="Ex : Sézane × Léna"
          className="sm:min-w-[200px] flex-[2]"
        />
        <SelectField
          label="Créateur"
          value={creator}
          onChange={setCreator}
          options={creatorOptions}
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
          label="Budget"
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
        <TextField label="Reach" value={reach} onChange={setReach} placeholder="480 K" className="sm:min-w-[110px] flex-1" />
        <TextField label="Engagement" value={engagement} onChange={setEngagement} placeholder="6,4 %" className="sm:min-w-[110px] flex-1" />
        <TextField label="Clics" value={clics} onChange={setClics} placeholder="9 200" className="sm:min-w-[110px] flex-1" />
        <TextField label="Ventes attribuées" value={ventes} onChange={setVentes} placeholder="310" className="sm:min-w-[130px] flex-1" />
        <label className="flex min-w-full flex-col gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Points forts (un par ligne)</span>
          <textarea
            value={highlightsText}
            onChange={(e) => setHighlightsText(e.target.value)}
            rows={3}
            placeholder={"Reel « routine matinale » : 210 K vues\nCode promo utilisé 310 fois en 10 jours"}
            className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </label>
      </InlineForm>

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
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-signalsoft text-signaltext">
            <FileBarChart className="size-5" />
          </div>
          <div className="text-sm font-medium text-foreground">Aucun debrief pour le moment</div>
          <div className="mt-1.5 text-xs text-faint">
            Crée un bilan de campagne avec le bouton « + Debrief ».
          </div>
        </div>
      ) : view === "cards" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {list.map((d, index) => (
            <article
              key={`${d.brand}-${index}`}
              className="flex flex-col rounded-2xl border border-border bg-surface p-5 shadow-sm"
            >
              {/* Titre + ROI + actions */}
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {d.brand} <span className="text-faint">×</span> {titleCase(d.creator)}
                  </div>
                  {d.period && d.period !== "—" && (
                    <div className="mt-0.5 text-[11px] text-faint">{d.period}</div>
                  )}
                </div>
                <span className="shrink-0 whitespace-nowrap rounded-full bg-signalsoft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-signaltext">
                  ROI {d.roi}
                </span>
              </div>

              {/* Budget → CA */}
              <div className="mt-3 flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">{d.budget}</span>
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
                      <div className="text-[8px] font-semibold uppercase tracking-wide text-faint">
                        {k.l}
                      </div>
                      <div className="mt-1 text-lg font-bold leading-none tracking-tight text-foreground">
                        {k.v}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Barre d'actions */}
              <div className="mt-4 flex items-center justify-end gap-1 border-t border-border pt-3">
                {actions(d, index)}
              </div>
            </article>
          ))}
        </div>
      ) : view === "list" ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          {list.map((d, index) => (
            <div
              key={`${d.brand}-${index}`}
              className="flex items-center gap-3 border-b border-border px-4 py-3.5 last:border-b-0 hover:bg-rowhover"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-foreground">
                  {d.brand} <span className="text-faint">×</span> {titleCase(d.creator)}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
                  {d.period && d.period !== "—" && <span>{d.period}</span>}
                  <span className="text-muted-foreground">
                    {d.budget} <span className="text-faint">→</span>{" "}
                    <span className="font-semibold text-signaltext">{d.revenue}</span>
                  </span>
                </div>
              </div>
              <span className="hidden shrink-0 whitespace-nowrap rounded-full bg-signalsoft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-signaltext sm:inline">
                ROI {d.roi}
              </span>
              <div className="flex shrink-0 items-center gap-1">{actions(d, index)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-panel text-[10px] font-semibold uppercase tracking-wide text-faint">
                <th className="px-4 py-3">Campagne</th>
                <th className="px-4 py-3">Créateur</th>
                <th className="px-4 py-3">Période</th>
                <th className="px-4 py-3 text-right">Budget</th>
                <th className="px-4 py-3 text-right">CA</th>
                <th className="px-4 py-3 text-center">ROI</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((d, index) => (
                <tr key={`${d.brand}-${index}`} className="border-b border-border last:border-b-0 hover:bg-rowhover">
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
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">{actions(d, index)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Partager le debrief à la marque */}
      {shareD && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" onClick={() => !shareSending && setShareD(null)}>
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">Partager le debrief à la marque</div>
                <div className="truncate text-[11px] text-faint">{shareD.brand}{shareD.creator ? ` × ${titleCase(shareD.creator)}` : ""}</div>
              </div>
              <button type="button" onClick={() => setShareD(null)} className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Email de la marque</span>
                  <input value={shareTo} onChange={(e) => setShareTo(e.target.value)} type="email" placeholder="contact@marque.com" className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Objet</span>
                  <input value={shareSubject} onChange={(e) => setShareSubject(e.target.value)} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
                </label>
              </div>
              <div>
                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">Aperçu (ce que reçoit la marque)</div>
                <iframe title="Aperçu debrief" srcDoc={debriefHTML(shareD)} sandbox="" className="h-[44vh] w-full rounded-lg border border-border bg-white" />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3.5">
              <div className="inline-flex overflow-hidden rounded-lg border border-border">
                <button type="button" onClick={() => setShareVia("gmail")} className={cn("px-3 py-1.5 text-[11px] font-semibold transition-colors", shareVia === "gmail" ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground hover:bg-rowhover")}>Gmail</button>
                <button type="button" onClick={() => setShareVia("resend")} className={cn("border-l border-border px-3 py-1.5 text-[11px] font-semibold transition-colors", shareVia === "resend" ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground hover:bg-rowhover")}>Resend</button>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => printDebrief(shareD)} className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover">
                  <FileText className="h-3.5 w-3.5" /> PDF
                </button>
                <button type="button" onClick={sendDebriefEmail} disabled={shareSending} className="flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                  <Send className="h-3.5 w-3.5" /> {shareSending ? "Envoi…" : "Envoyer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
