import { useState } from "react";
import { FileBarChart } from "lucide-react";
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
import { titleCase } from "@/lib/utils";

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

export function Debrief() {
  const { data, loading, error } = useAppState<Debrief[]>(
    (s: AppState) => (s["debriefData"] as Debrief[]) ?? null
  );
  const creators = useCreators();

  // Copie locale : le blob n'est chargé qu'une fois, on maintient l'état ici.
  const [local, setLocal] = useState<Debrief[] | null>(null);
  const list: Debrief[] = local ?? data ?? (data === null && !loading ? SEED : []);

  const [formOpen, setFormOpen] = useState(false);
  const [brand, setBrand] = useState("");
  const [creator, setCreator] = useState("");
  const [period, setPeriod] = useState("");
  const [budget, setBudget] = useState("");
  const [revenue, setRevenue] = useState("");

  const creatorOptions = [
    { value: "", label: "— Choisir —" },
    ...creators.map((c) => ({ value: c.name, label: titleCase(c.name) })),
  ];

  async function add() {
    const b = brand.trim();
    if (!b) {
      toast("Indique la marque / campagne");
      return;
    }
    const budN = parseAmount(budget);
    const revN = parseAmount(revenue);
    const roi = budN > 0 ? (revN / budN).toFixed(1).replace(".", ",") + "×" : "—";
    const item: Debrief = {
      brand: b,
      creator: creator.trim(),
      period: period.trim() || "—",
      deliverables: "—",
      budget: budN ? formatEuro(budN) : "—",
      revenue: revN ? formatEuro(revN) : "—",
      roi,
      tone: "cyan",
      summary: "—",
      kpis: [],
      highlights: [],
    };
    const next: Debrief[] = [item, ...list];
    setLocal(next);
    setBrand("");
    setCreator("");
    setPeriod("");
    setBudget("");
    setRevenue("");
    setFormOpen(false);
    const ok = await saveAppStateKey("debriefData", next);
    toast(ok ? "Debrief créé ✓" : "Erreur — réessaie");
  }

  async function remove(index: number) {
    const next = list.filter((_, i) => i !== index);
    setLocal(next);
    const ok = await saveAppStateKey("debriefData", next);
    toast(ok ? "Supprimé" : "Erreur — réessaie");
  }

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
        <AddButton label="Debrief" onClick={() => setFormOpen(true)} />
      </div>

      <InlineForm
        open={formOpen}
        title="Nouveau debrief"
        onClose={() => setFormOpen(false)}
        onSubmit={add}
        submitLabel="Créer le debrief"
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
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {list.map((d, index) => (
            <article
              key={`${d.brand}-${index}`}
              className="flex flex-col rounded-2xl border border-border bg-surface p-5 shadow-sm"
            >
              {/* Titre + ROI + suppression */}
              <div className="flex items-start gap-3">
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
                <DeleteButton onClick={() => remove(index)} />
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
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
