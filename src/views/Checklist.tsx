import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useAppState, saveAppStateKey, type AppState } from "@/lib/appState";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** Étape d'une phase : id STABLE (persisté dans le blob `checklistDone`). */
type Step = { id: string; label: string; who: "Agence" | "Créateur" };
type Phase = { title: string; steps: Step[] };

/** Map { stepId: true } persistée dans le blob agence. */
type DoneMap = Record<string, boolean>;

/**
 * Phases & étapes par défaut d'une collaboration.
 * Chaque étape porte un id stable (`prefixe-index`) pour survivre aux réordonnancements.
 */
const PHASES: Phase[] = [
  {
    title: "Brief & cadrage",
    steps: [
      { id: "brief-1", label: "Recevoir le brief marque", who: "Agence" },
      { id: "brief-2", label: "Valider les livrables", who: "Agence" },
      { id: "brief-3", label: "Fixer les deadlines", who: "Agence" },
    ],
  },
  {
    title: "Production",
    steps: [
      { id: "prod-1", label: "Tournage / shooting", who: "Créateur" },
      { id: "prod-2", label: "Montage / retouche", who: "Créateur" },
      { id: "prod-3", label: "Validation interne", who: "Agence" },
    ],
  },
  {
    title: "Validation marque",
    steps: [
      { id: "valid-1", label: "Envoyer pour validation", who: "Agence" },
      { id: "valid-2", label: "Intégrer les retours", who: "Créateur" },
    ],
  },
  {
    title: "Publication",
    steps: [
      { id: "pub-1", label: "Programmer la publication", who: "Agence" },
      { id: "pub-2", label: "Publier", who: "Créateur" },
      { id: "pub-3", label: "Story / repost", who: "Créateur" },
    ],
  },
  {
    title: "Facturation",
    steps: [
      { id: "fact-1", label: "Émettre la facture", who: "Agence" },
      { id: "fact-2", label: "Encaisser", who: "Agence" },
      { id: "fact-3", label: "Reverser au créateur", who: "Agence" },
    ],
  },
];

const TOTAL_STEPS = PHASES.reduce((n, p) => n + p.steps.length, 0);

export function Checklist() {
  const { data, loading } = useAppState<DoneMap>(
    (s: AppState) => (s["checklistDone"] as DoneMap) ?? {}
  );
  const [done, setDone] = useState<DoneMap>({});

  // Synchronise l'état local dès que le blob est chargé.
  useEffect(() => {
    if (data) setDone(data);
  }, [data]);

  const doneCount = PHASES.reduce(
    (n, p) => n + p.steps.filter((st) => done[st.id]).length,
    0
  );
  const pct = TOTAL_STEPS ? Math.round((doneCount / TOTAL_STEPS) * 100) : 0;

  const toggle = async (id: string) => {
    const next: DoneMap = { ...done, [id]: !done[id] };
    if (!next[id]) delete next[id]; // on ne garde que les étapes cochées
    setDone(next);
    await saveAppStateKey("checklistDone", next);
  };

  const reset = async () => {
    const next: DoneMap = {};
    setDone(next);
    await saveAppStateKey("checklistDone", next);
    toast("Checklist réinitialisée");
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-panel shadow-sm px-4 py-3">
        <AnimatedBadge status="loading" size="sm">
          Chargement…
        </AnimatedBadge>
      </div>
    );
  }

  return (
    <div>
      {/* Barre d'avancement globale */}
      <div className="mb-5 rounded-2xl border border-border bg-panel shadow-sm p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">
              Avancement de la collaboration
            </div>
            <div className="mt-0.5 text-[11px] text-faint">
              {doneCount} / {TOTAL_STEPS} étapes bouclées
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-3xl font-bold tracking-tight tabular-nums text-foreground">
              {pct}%
            </div>
            {doneCount > 0 && (
              <button
                type="button"
                onClick={reset}
                className="rounded-lg border border-border px-3 py-2 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover"
              >
                RÉINITIALISER
              </button>
            )}
          </div>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-rowhover">
          <div
            className="h-full rounded-full bg-signal transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Phases */}
      <div className="space-y-4">
        {PHASES.map((phase) => {
          const phaseDone = phase.steps.filter((st) => done[st.id]).length;
          return (
            <div
              key={phase.title}
              className="rounded-2xl border border-border bg-panel shadow-sm p-5"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-foreground">
                  {phase.title}
                </div>
                <span className="text-[10px] font-semibold text-faint tabular-nums">
                  {phaseDone} / {phase.steps.length}
                </span>
              </div>

              <ul className="space-y-1">
                {phase.steps.map((step) => {
                  const checked = !!done[step.id];
                  return (
                    <li key={step.id}>
                      <button
                        type="button"
                        onClick={() => toggle(step.id)}
                        className="group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-rowhover"
                      >
                        {/* Case animée */}
                        <span
                          className={cn(
                            "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border-[1.5px] transition-all duration-200",
                            checked
                              ? "scale-100 border-signal bg-signal text-signaltext"
                              : "border-faint text-transparent group-hover:border-signal"
                          )}
                        >
                          <Check
                            className={cn(
                              "h-3 w-3 transition-transform duration-200",
                              checked ? "scale-100" : "scale-0"
                            )}
                            strokeWidth={3}
                          />
                        </span>

                        {/* Libellé */}
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-[13px] font-medium transition-colors",
                            checked
                              ? "text-faint line-through"
                              : "text-foreground"
                          )}
                        >
                          {step.label}
                        </span>

                        {/* Côté responsable */}
                        <span
                          className={cn(
                            "hidden shrink-0 rounded-full px-2.5 py-1 text-[8px] font-semibold uppercase tracking-wider sm:inline",
                            step.who === "Créateur"
                              ? "bg-indigo/10 text-indigo"
                              : "bg-signalsoft text-signaltext"
                          )}
                        >
                          {step.who}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
