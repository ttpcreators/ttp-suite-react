import { useEffect, useState } from "react";
import { Check, ChevronLeft, Pencil, LayoutGrid, List, Table2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
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

type ChecklistView = "cards" | "list" | "table";

export function Checklist() {
  const { data, loading } = useAppState<Checklist[]>(
    (s: AppState) => (s["checklists"] as Checklist[]) ?? DEFAULT_CHECKLISTS
  );
  const [lists, setLists] = useState<Checklist[]>(DEFAULT_CHECKLISTS);
  const [view, setView] = useState<ChecklistView>("cards");
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

  // Écriture STRUCTURELLE (ajout/suppression/renommage d'une checklist) : on relit l'état
  // frais du blob juste avant de fusionner, pour ne pas écraser une checklist créée en
  // parallèle par l'autre compte agence. (Le toggle d'une étape reste optimiste : sans
  // enjeu, il se resynchronise au tick suivant.)
  const persistFresh = async (mutate: (fresh: Checklist[]) => Checklist[]): Promise<boolean> => {
    invalidateAppState();
    const fresh = ((await getAppState())["checklists"] as Checklist[]) ?? DEFAULT_CHECKLISTS;
    const next = mutate(fresh);
    setLists(next);
    const ok = await saveAppStateKey("checklists", next);
    if (!ok) toast("Erreur — réessaie");
    return ok;
  };

  const addChecklist = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const ck: Checklist = { id: "ck" + Date.now(), name: trimmed, done: {} };
    await persistFresh((fresh) => [...fresh, ck]);
    setName("");
    setFormOpen(false);
    toast("Checklist créée");
  };

  const removeChecklist = async (id: string) => {
    // `persistFresh` prévient déjà en cas d'échec : ne pas annoncer une suppression
    // qui n'a pas été enregistrée.
    const ok = await persistFresh((fresh) => fresh.filter((c) => c.id !== id));
    if (!ok) return;
    if (selectedId === id) setSelectedId(null);
    toast("Checklist supprimée");
  };

  const askRemove = (ck: Checklist) =>
    setPendingDel({
      message: `Supprimer la checklist « ${ck.name} » ? Cette action est irréversible.`,
      run: () => removeChecklist(ck.id),
    });

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
    await persistFresh((fresh) => fresh.map((c) => (c.id === id ? { ...c, name: trimmed } : c)));
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

  /* La boîte de confirmation est rendue dans les DEUX vues : la vue liste sortait en
     `return` avant de l'atteindre, donc le bouton supprimer armait `pendingDel` sans
     que rien ne l'affiche — la suppression n'était jamais confirmée, donc jamais faite. */
  const confirmDialog = pendingDel && (
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
  );

  /* ─────────────────────────── VUE LISTE ─────────────────────────── */
  if (!selected) {
    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">
              Checklists
            </div>
            <div className="mt-0.5 text-[11px] text-faint">
              {lists.length} checklist{lists.length > 1 ? "s" : ""}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {lists.length > 0 && (
              <div className="flex items-center gap-1 rounded-xl border border-border bg-panel p-1">
                {(
                  [
                    ["cards", LayoutGrid, "Cartes"],
                    ["list", List, "Liste"],
                    ["table", Table2, "Tableau"],
                  ] as [ChecklistView, typeof LayoutGrid, string][]
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
            <AddButton label="Nouvelle checklist" onClick={() => setFormOpen(true)} />
          </div>
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
        ) : view === "cards" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {lists.map((ck) => {
              const dc = doneCountOf(ck);
              const pct = TOTAL_STEPS ? Math.round((dc / TOTAL_STEPS) * 100) : 0;
              return (
                <div
                  key={ck.id}
                  className="group flex flex-col gap-3 rounded-2xl border border-border bg-panel p-5 shadow-sm transition-colors hover:bg-rowhover"
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedId(ck.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-sm font-semibold text-foreground">
                        {ck.name}
                      </div>
                      <div className="mt-0.5 text-[11px] text-faint tabular-nums">
                        {dc} / {TOTAL_STEPS} étapes
                      </div>
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold tabular-nums text-foreground">
                        {pct}%
                      </span>
                      <DeleteButton onClick={() => askRemove(ck)} />
                    </div>
                  </div>
                  <button type="button" onClick={() => setSelectedId(ck.id)} aria-label={`Ouvrir ${ck.name}`}>
                    <Progress value={pct} className="h-2" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : view === "list" ? (
          <div className="overflow-hidden rounded-2xl border border-border bg-panel shadow-sm">
            {lists.map((ck) => {
              const dc = doneCountOf(ck);
              const pct = TOTAL_STEPS ? Math.round((dc / TOTAL_STEPS) * 100) : 0;
              return (
                <div
                  key={ck.id}
                  className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-rowhover"
                >
                  <button type="button" onClick={() => setSelectedId(ck.id)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-[13px] font-semibold text-foreground">{ck.name}</div>
                    <div className="mt-0.5 text-[11px] text-faint tabular-nums">{dc} / {TOTAL_STEPS} étapes</div>
                  </button>
                  <div className="hidden w-40 shrink-0 sm:block">
                    <Progress value={pct} className="h-1.5" />
                  </div>
                  <span className="w-12 shrink-0 text-right text-sm font-bold tabular-nums text-foreground">{pct}%</span>
                  <DeleteButton onClick={() => askRemove(ck)} />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-panel shadow-sm">
            <table className="w-full min-w-[480px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-wide text-faint">
                  <th className="px-4 py-3">Checklist</th>
                  <th className="px-4 py-3 text-right">Étapes</th>
                  <th className="px-4 py-3 text-right">Avancement</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {lists.map((ck) => {
                  const dc = doneCountOf(ck);
                  const pct = TOTAL_STEPS ? Math.round((dc / TOTAL_STEPS) * 100) : 0;
                  return (
                    <tr key={ck.id} className="border-b border-border last:border-b-0 hover:bg-rowhover">
                      <td className="px-4 py-3">
                        <button type="button" onClick={() => setSelectedId(ck.id)} className="text-left text-[13px] font-semibold text-foreground hover:text-primary">
                          {ck.name}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right text-[12px] tabular-nums text-muted-foreground">{dc} / {TOTAL_STEPS}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <div className="hidden w-24 sm:block"><Progress value={pct} className="h-1.5" /></div>
                          <span className="w-10 text-right text-[13px] font-bold tabular-nums text-foreground">{pct}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end"><DeleteButton onClick={() => askRemove(ck)} /></div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {confirmDialog}
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
      {confirmDialog}
    </div>
  );
}
