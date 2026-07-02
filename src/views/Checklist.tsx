import { useEffect, useState } from "react";
import { Check, ChevronLeft, Pencil } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useAppState, saveAppStateKey, type AppState } from "@/lib/appState";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { AddButton, InlineForm, TextField, DeleteButton } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** Une checklist nommée : `done` mappe { stepId: true } pour les étapes cochées. */
export type Checklist = {
  id: string;
  name: string;
  done: Record<string, boolean>;
};

/** Étape d'une phase : id STABLE (persisté dans `done`). */
type Step = { id: string; label: string; who: "Agence" | "Créateur" };
type Phase = { title: string; steps: Step[] };

/**
 * Phases & étapes par défaut d'une collaboration (template partagé).
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

/** Nombre d'étapes cochées (bornées au template) d'une checklist. */
function doneCountOf(ck: Checklist): number {
  return PHASES.reduce(
    (n, p) => n + p.steps.filter((st) => ck.done[st.id]).length,
    0
  );
}

const DEFAULT_CHECKLISTS: Checklist[] = [
  { id: "default", name: "Collaboration type", done: {} },
];

export function Checklist() {
  const { data, loading } = useAppState<Checklist[]>(
    (s: AppState) => (s["checklists"] as Checklist[]) ?? DEFAULT_CHECKLISTS
  );
  const [lists, setLists] = useState<Checklist[]>(DEFAULT_CHECKLISTS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [pendingDel, setPendingDel] = useState<null | { message: string; run: () => void }>(null);

  // Synchronise l'état local dès que le blob est chargé.
  useEffect(() => {
    if (data) setLists(data);
  }, [data]);

  const persist = async (next: Checklist[]) => {
    setLists(next);
    const ok = await saveAppStateKey("checklists", next);
    if (!ok) toast("Erreur — réessaie");
  };

  const addChecklist = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const ck: Checklist = { id: "ck" + Date.now(), name: trimmed, done: {} };
    await persist([...lists, ck]);
    setName("");
    setFormOpen(false);
    toast("Checklist créée");
  };

  const removeChecklist = async (id: string) => {
    const next = lists.filter((c) => c.id !== id);
    await persist(next);
    if (selectedId === id) setSelectedId(null);
    toast("Checklist supprimée");
  };

  const startEdit = (ck: Checklist) => {
    setEditingId(ck.id);
    setEditName(ck.name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
  };

  const saveEdit = async (id: string) => {
    const trimmed = editName.trim();
    if (!trimmed) return;
    const next = lists.map((c) => (c.id === id ? { ...c, name: trimmed } : c));
    await persist(next);
    cancelEdit();
    toast("Titre modifié");
  };

  const toggleStep = async (id: string) => {
    const next = lists.map((c) => {
      if (c.id !== selectedId) return c;
      const done = { ...c.done };
      if (done[id]) delete done[id];
      else done[id] = true;
      return { ...c, done };
    });
    await persist(next);
  };

  const resetSelected = async () => {
    const next = lists.map((c) =>
      c.id === selectedId ? { ...c, done: {} } : c
    );
    await persist(next);
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

  const selected = lists.find((c) => c.id === selectedId) ?? null;

  /* ─────────────────────────── VUE LISTE ─────────────────────────── */
  if (!selected) {
    return (
      <div>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">
              Checklists
            </div>
            <div className="mt-0.5 text-[11px] text-faint">
              {lists.length} checklist{lists.length > 1 ? "s" : ""}
            </div>
          </div>
          <AddButton label="Nouvelle checklist" onClick={() => setFormOpen(true)} />
        </div>

        <InlineForm
          open={formOpen}
          title="Nouvelle checklist"
          submitLabel="Créer"
          onClose={() => {
            setFormOpen(false);
            setName("");
          }}
          onSubmit={addChecklist}
        >
          <TextField
            label="Nom"
            value={name}
            onChange={setName}
            placeholder="Nom de la checklist"
          />
        </InlineForm>

        {lists.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-panel/50 px-5 py-10 text-center text-[13px] text-muted-foreground">
            Aucune checklist. Crée-en une pour démarrer.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {lists.map((ck) => {
              const dc = doneCountOf(ck);
              const pct = TOTAL_STEPS ? Math.round((dc / TOTAL_STEPS) * 100) : 0;
              return (
                <button
                  key={ck.id}
                  type="button"
                  onClick={() => setSelectedId(ck.id)}
                  className="group flex flex-col gap-3 rounded-2xl border border-border bg-panel p-5 text-left shadow-sm transition-colors hover:bg-rowhover"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground">
                        {ck.name}
                      </div>
                      <div className="mt-0.5 text-[11px] text-faint tabular-nums">
                        {dc} / {TOTAL_STEPS} étapes
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold tabular-nums text-foreground">
                        {pct}%
                      </span>
                      <DeleteButton onClick={() => setPendingDel({ message: `Supprimer la checklist « ${ck.name} » ? Cette action est irréversible.`, run: () => removeChecklist(ck.id) })} />
                    </div>
                  </div>
                  <Progress value={pct} className="h-2" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  /* ─────────────────────────── VUE DÉTAIL ─────────────────────────── */
  const doneCount = doneCountOf(selected);
  const pct = TOTAL_STEPS ? Math.round((doneCount / TOTAL_STEPS) * 100) : 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => setSelectedId(null)}
        className="mb-4 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Toutes les checklists
      </button>

      {/* Barre d'avancement globale */}
      <div className="mb-5 rounded-2xl border border-border bg-panel shadow-sm p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {editingId === selected.id ? (
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEdit(selected.id);
                  if (e.key === "Escape") cancelEdit();
                }}
                onBlur={() => saveEdit(selected.id)}
                className="w-full rounded-lg border border-border bg-panel px-2 py-1 text-sm font-semibold text-foreground outline-none focus:border-primary"
              />
            ) : (
              <div className="flex items-center gap-1.5">
                <div className="truncate text-sm font-semibold text-foreground">
                  {selected.name}
                </div>
                <button
                  type="button"
                  onClick={() => startEdit(selected)}
                  className="shrink-0 rounded-md p-1 text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                  aria-label="Modifier le titre"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
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
                onClick={resetSelected}
                className="rounded-lg border border-border px-3 py-2 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover"
              >
                RÉINITIALISER
              </button>
            )}
          </div>
        </div>
        <Progress value={pct} className="h-2.5" />
      </div>

      {/* Phases */}
      <div className="space-y-4">
        {PHASES.map((phase) => {
          const phaseDone = phase.steps.filter((st) => selected.done[st.id]).length;
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
                  const checked = !!selected.done[step.id];
                  return (
                    <li key={step.id}>
                      <button
                        type="button"
                        onClick={() => toggleStep(step.id)}
                        className="group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-rowhover"
                      >
                        {/* Case animée */}
                        <span
                          className={cn(
                            "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border-[1.5px] transition-all duration-200",
                            checked
                              ? "scale-100 border-primary bg-primary text-primary-foreground"
                              : "border-faint text-transparent group-hover:border-primary"
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
                            checked ? "text-faint line-through" : "text-foreground"
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
      {pendingDel && (
        <ConfirmDialog
          title="Supprimer la checklist"
          message={pendingDel.message}
          confirmLabel="Supprimer"
          danger
          onCancel={() => setPendingDel(null)}
          onConfirm={() => {
            pendingDel.run();
            setPendingDel(null);
          }}
        />
      )}
    </div>
  );
}
