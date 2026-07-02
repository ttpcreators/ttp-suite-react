import { useState } from "react";
import { FileBarChart, Pencil, Share2, Download, LayoutGrid, List, Table2 } from "lucide-react";
import {
  useAppState,
  saveAppStateKey,
  parseAmount,
  formatEuro,
  type AppState,
} from "@/lib/appState";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { toast } from "@/components/ui/toast";
import { AddButton, InlineForm, TextField, SelectField, DeleteButton } from "@/components/ui/form";
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
    setEditIndex(null);
  }

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
    let next: Debrief[];
    if (editIndex !== null && list[editIndex]) {
      const prev = list[editIndex];
      const updated: Debrief = {
        ...prev,
        brand: b,
        creator: creator.trim(),
        period: period.trim() || "—",
        budget: budN ? formatEuro(budN) : "—",
        revenue: revN ? formatEuro(revN) : "—",
        roi,
        summary: summary.trim() || "—",
      };
      next = list.map((d, i) => (i === editIndex ? updated : d));
    } else {
      const item: Debrief = {
        brand: b,
        creator: creator.trim(),
        period: period.trim() || "—",
        deliverables: "—",
        budget: budN ? formatEuro(budN) : "—",
        revenue: revN ? formatEuro(revN) : "—",
        roi,
        tone: "cyan",
        summary: summary.trim() || "—",
        kpis: [],
        highlights: [],
      };
      next = [item, ...list];
    }
    const wasEdit = editIndex !== null;
    setLocal(next);
    resetForm();
    setFormOpen(false);
    const ok = await saveAppStateKey("debriefData", next);
    toast(ok ? (wasEdit ? "Debrief modifié ✓" : "Debrief créé ✓") : "Erreur — réessaie");
  }

  async function remove(index: number) {
    const next = list.filter((_, i) => i !== index);
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

  const iconBtn =
    "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground";

  const actions = (d: Debrief, index: number) => (
    <>
      <button type="button" onClick={() => startEdit(index)} className={iconBtn} title="Modifier">
        <Pencil className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => shareDebrief(d)} className={iconBtn} title="Partager">
        <Share2 className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => downloadDebrief(d)} className={iconBtn} title="Télécharger">
        <Download className="h-4 w-4" />
      </button>
      <DeleteButton onClick={() => remove(index)} />
    </>
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
          className="min-w-[200px] flex-[2]"
        />
        <SelectField
          label="Créateur"
          value={creator}
          onChange={setCreator}
          options={creatorOptions}
          className="min-w-[170px] flex-1"
        />
        <TextField
          label="Période"
          value={period}
          onChange={setPeriod}
          placeholder="Mars 2026"
          className="min-w-[130px] flex-none"
        />
        <TextField
          label="Budget"
          value={budget}
          onChange={setBudget}
          placeholder="3 000 €"
          className="min-w-[120px] flex-none"
        />
        <TextField
          label="CA généré"
          value={revenue}
          onChange={setRevenue}
          placeholder="12 000 €"
          className="min-w-[120px] flex-none"
        />
        <TextField
          label="Synthèse (optionnel)"
          value={summary}
          onChange={setSummary}
          placeholder="Bilan de la campagne…"
          className="min-w-full flex-[3]"
        />
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
    </div>
  );
}
