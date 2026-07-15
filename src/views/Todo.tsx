import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import { useSearch, matchQuery } from "@/lib/search";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { dbInsert, dbUpdate, nextOrder } from "@/lib/db";
import { dbTrash } from "@/lib/trash";
import { toast } from "@/components/ui/toast";
import {
  AddButton,
  InlineForm,
  TextField,
  SelectField,
  AutoGrowTextField,
} from "@/components/ui/form";
import { ActionMenu, ConfirmDialog } from "@/components/ui/action-menu";
import { FilterBar } from "@/components/ui/filter-bar";
import { useCreators } from "@/lib/useCreators";
import { notifyCreator } from "@/lib/push";
import { useLiveKey } from "@/lib/useLive";
import { toISODate, frDate } from "@/lib/dates";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { getCache, setCache } from "@/lib/viewCache";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusSelect, type StatusOption } from "@/components/ui/status-select";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useEffect, useState, type ReactNode } from "react";
import { X, Pencil, Trash2, MessageSquarePlus, Check, List, Columns3 } from "lucide-react";

type Priority = "haute" | "moyenne" | "basse";
type Source = "agency" | "creator";

type Row = {
  id: string;
  text: string;
  descr: string | null;
  tag: string | null;
  due: string | null;
  creator: string | null;
  priority: Priority;
  source: Source;
  done: boolean;
  status?: string | null;
  sort_order: number;
  created_at: string | null;
};

const TODO_STATUS_OPTS: StatusOption[] = [
  { value: "À faire", label: "À faire", dot: "bg-primary" },
  { value: "En cours", label: "En cours", dot: "bg-cyan" },
  { value: "Fait", label: "Fait", dot: "bg-signal" },
];
/** Statut affiché : colonne status si présente, sinon dérivé de `done`. */
const todoStatus = (r: Row): string => r.status ?? (r.done ? "Fait" : "À faire");

const priorityBadge: Record<
  Priority,
  { status: "danger" | "warning" | "neutral"; label: string }
> = {
  haute: { status: "danger", label: "Haute" },
  moyenne: { status: "warning", label: "Moyenne" },
  basse: { status: "neutral", label: "Basse" },
};

/** Accès SÛR au badge de priorité. `todos.priority` n'a pas de contrainte CHECK en
 *  base → une valeur inconnue (legacy/import) est possible ; l'indexer en direct
 *  planterait la modale de détail. Repli neutre. */
function prioOf(p: string): { status: "danger" | "warning" | "neutral"; label: string } {
  return priorityBadge[p as Priority] ?? { status: "neutral", label: p || "—" };
}

/** Point de priorité scintillant (remplace le badge texte dans la liste). */
function PriorityDot({ priority }: { priority: Priority }) {
  const color = priority === "haute" ? "bg-rose-500" : priority === "moyenne" ? "bg-amber-500" : "bg-slate-400";
  const label = priority === "haute" ? "Priorité haute" : priority === "moyenne" ? "Priorité moyenne" : "Priorité basse";
  const animate = priority !== "basse";
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0" title={label} aria-label={label}>
      {animate && <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", color)} />}
      <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", color)} />
    </span>
  );
}

// Formate created_at en fr-FR ; rien si absent.
const formatCreatedAt = (created_at: string | null): string | null =>
  created_at ? new Date(created_at).toLocaleDateString("fr-FR") : null;

// Filtre créateur : null = tous, "__agency__" = agence, sinon nom du créateur.
type CreatorFilter = null | "__agency__" | string;
// Filtre priorité : null = toutes, sinon la priorité.
type PriorityFilter = null | Priority;

// Filtre de vue par statut (comme CreatorSpace).
type TodoFilter = "encours" | "terminees" | "toutes";
const TODO_FILTERS: { id: TodoFilter; label: string }[] = [
  { id: "encours", label: "En cours" },
  { id: "terminees", label: "Terminées" },
  { id: "toutes", label: "Toutes" },
];

export function Todo() {
  const [rows, setRows] = useState<Row[] | null>(() => getCache<Row[]>("todos"));
  const [error, setError] = useState(false);
  const { query } = useSearch();
  const creators = useCreators();
  const live = useLiveKey();

  const [formOpen, setFormOpen] = useState(false);
  const [text, setText] = useState("");
  const [descr, setDescr] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<Priority>("moyenne");
  const [creator, setCreator] = useState("");
  // Bouton dédié « Tâche agence » : ouvre le formulaire verrouillé sur l'agence
  // (creator vide) et masque le champ « Pour qui » → tâche interne, sans créatrice.
  const [forceAgency, setForceAgency] = useState(false);

  // Commentaires (agence) stockés dans le blob __app_state__, indexés par id de tâche.
  const { data: notesData } = useAppState<Record<string, string>>(
    (s: AppState) => (s["itemNotes"] as Record<string, string>) ?? {},
  );
  const [notes, setNotes] = useState<Record<string, string>>({});
  useEffect(() => {
    if (notesData) setNotes(notesData);
  }, [notesData]);
  const saveNote = async (id: string, value: string) => {
    // Relit la map FRAÎCHE avant d'écrire (jamais depuis l'état local : on
    // écraserait les commentaires posés depuis un autre poste / pas encore chargés).
    invalidateAppState();
    const fresh = ((await getAppState())["itemNotes"] as Record<string, string>) ?? {};
    const next = { ...fresh };
    if (value.trim()) next[id] = value.trim();
    else delete next[id];
    setNotes(next);
    const ok = await saveAppStateKey("itemNotes", next);
    if (!ok) toast("Commentaire non enregistré — réessaie");
  };
  // Édition inline du commentaire d'avancement (sous la carte, dans la liste).
  const [noteEditId, setNoteEditId] = useState<string | null>(null);
  const [noteEditText, setNoteEditText] = useState("");
  const startNote = (id: string) => {
    setNoteEditId(id);
    setNoteEditText(notes[id] ?? "");
  };

  const [creatorFilter, setCreatorFilter] = useState<CreatorFilter>(null);
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>(null);
  const [todoFilter, setTodoFilter] = useState<TodoFilter>("encours");
  const [selectedTodo, setSelectedTodo] = useState<Row | null>(null);
  const [confirmDone, setConfirmDone] = useState<Row | null>(null); // anti-missclick « fait »

  // Mode de vue : liste classique ↔ colonnes par statut (kanban). Mémorisé.
  const [viewMode, setViewMode] = useState<"liste" | "colonnes">(
    () => (localStorage.getItem("ttp:todo-view") === "colonnes" ? "colonnes" : "liste"),
  );
  useEffect(() => { localStorage.setItem("ttp:todo-view", viewMode); }, [viewMode]);

  // Change le statut d'une tâche (utilisé par le kanban ; done dérivé de « Fait »).
  const setStatus = async (row: Row, status: string) => {
    if (await dbUpdate("todos", row.id, { status, done: status === "Fait" })) {
      setRows((prev) => (prev ?? []).map((r) => (r.id === row.id ? { ...r, status, done: status === "Fait" } : r)));
      setSelectedTodo((prev) => (prev?.id === row.id ? { ...prev, status, done: status === "Fait" } : prev));
    } else {
      toast("Statut non enregistré — la colonne « status » manque (lance le SQL)");
    }
  };

  // Marque une tâche faite / à refaire (remonté au niveau composant pour la confirmation).
  const markDone = async (row: Row, next: boolean) => {
    const status = next ? "Fait" : "À faire";
    if (await dbUpdate("todos", row.id, { done: next, status })) {
      setRows((prev) => (prev ?? []).map((r) => (r.id === row.id ? { ...r, done: next, status } : r)));
      setSelectedTodo((prev) => (prev?.id === row.id ? { ...prev, done: next, status } : prev));
      toast(next ? "Fait ✓" : "À refaire");
    } else {
      toast("Erreur — réessaie");
    }
  };

  // Édition de la tâche sélectionnée (dans le panneau de détail).
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [editDescr, setEditDescr] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editPriority, setEditPriority] = useState<Priority>("moyenne");
  const [editCreator, setEditCreator] = useState("");

  // Ouvre le mode édition en pré-remplissant depuis la tâche sélectionnée.
  const openEdit = (row: Row) => {
    setEditText(row.text);
    setEditDescr(row.descr ?? "");
    setEditNote(notes[row.id] ?? "");
    setEditDue(toISODate(row.due));
    setEditPriority(row.priority);
    setEditCreator(row.creator ?? "");
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!selectedTodo) return;
    if (!editText.trim()) {
      toast("Renseigne la tâche");
      return;
    }
    // Échéance : si l'ancienne valeur est un texte libre illisible (ex. « fin
    // juin ») le champ date arrive vide — on la PRÉSERVE au lieu de l'écraser.
    const oldDue = selectedTodo.due ?? "";
    const dueVal = editDue.trim()
      ? editDue.trim()
      : oldDue && oldDue !== "—" && !toISODate(oldDue)
        ? oldDue
        : "—";
    const patch = {
      text: editText.trim(),
      descr: editDescr.trim() || null,
      tag: editCreator ? "CRÉATEUR" : "AGENCE",
      due: dueVal,
      creator: editCreator || null,
      priority: editPriority,
    };
    if (!(await dbUpdate("todos", selectedTodo.id, patch))) {
      toast("Erreur — réessaie");
      return;
    }
    setRows((prev) =>
      (prev ?? []).map((r) =>
        r.id === selectedTodo.id ? { ...r, ...patch } : r
      )
    );
    setSelectedTodo((prev) => (prev ? { ...prev, ...patch } : prev));
    await saveNote(selectedTodo.id, editNote);
    setEditing(false);
    toast("Tâche modifiée ✓");
  };

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("todos")
        .select("*")
        .order("sort_order");
      if (!active) return;
      if (error) {
        setError(true);
        setRows([]);
        return;
      }
      const list = (data as Row[]) ?? [];
      setCache("todos", list);
      setRows(list);
    })();
    return () => {
      active = false;
    };
  }, [live]);

  const submit = async () => {
    if (!text.trim()) {
      toast("Renseigne la tâche");
      return;
    }
    const row = {
      text: text.trim(),
      descr: descr.trim() || null,
      tag: creator ? "CRÉATEUR" : "AGENCE",
      due: due.trim() || "—",
      creator: creator || null,
      priority,
      source: "agency" as Source,
      done: false,
      sort_order: nextOrder(rows ?? []),
    };
    const created = await dbInsert("todos", row);
    if (!created) {
      toast("Erreur — réessaie");
      return;
    }
    const createdRow = created as unknown as Row;
    setRows([createdRow, ...(rows ?? [])]);
    if (note.trim()) await saveNote(createdRow.id, note);
    // Push au créateur concerné (s'il a activé les notifs sur son téléphone).
    if (creator) notifyCreator("task", creator, text.trim());
    toast("Tâche ajoutée ✓");
    setFormOpen(false);
    setForceAgency(false);
    setText("");
    setDescr("");
    setNote("");
    setDue("");
    setPriority("moyenne");
    setCreator("");
  };

  const removeRow = (id: string) => {
    setRows((prev) => (prev ?? []).filter((r) => r.id !== id));
    setSelectedTodo((prev) => (prev?.id === id ? null : prev));
  };

  // Base : recherche + filtre créateur + filtre priorité (sans le filtre de statut).
  const filteredBase = (rows ?? []).filter((row) => {
    if (!matchQuery(query, row.text, row.descr, row.creator, row.tag)) return false;
    if (creatorFilter === "__agency__") {
      if (row.creator) return false;
    } else if (creatorFilter != null) {
      if (row.creator !== creatorFilter) return false;
    }
    if (priorityFilter != null && row.priority !== priorityFilter) return false;
    return true;
  });
  // Vue liste : on applique en plus le filtre En cours / Terminées / Toutes.
  const filtered = filteredBase.filter((row) => {
    if (todoFilter === "encours" && row.done) return false;
    if (todoFilter === "terminees" && !row.done) return false;
    return true;
  });

  const noFilterMatch =
    rows !== null &&
    rows.length > 0 &&
    filtered.length === 0 &&
    !(query.trim() && filtered.length === 0);

  // Filtre créateur en Select : le Select ne manipule que des strings, on
  // encode donc null via le sentinel "__all__" (le state garde bien null).
  const ALL = "__all__";
  const creatorSelectValue =
    creatorFilter === null ? ALL : creatorFilter;
  const onCreatorSelect = (v: string) =>
    setCreatorFilter(v === ALL ? null : (v as CreatorFilter));

  const priorityPills: { label: string; value: PriorityFilter }[] = [
    { label: "Toutes", value: null },
    { label: "Haute", value: "haute" },
    { label: "Moyenne", value: "moyenne" },
    { label: "Basse", value: "basse" },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {rows === null
            ? "Chargement…"
            : (() => {
                const openCount = rows.filter((r) => !r.done).length;
                return `${openCount} tâche${openCount > 1 ? "s" : ""} en cours`;
              })()}
        </div>
        <div className="flex items-center gap-2">
          <AddButton
            label="Tâche agence"
            onClick={() => {
              setCreator("");
              setForceAgency(true);
              setFormOpen(true);
            }}
          />
          <AddButton
            label="Tâche"
            onClick={() => {
              setForceAgency(false);
              setFormOpen(true);
            }}
          />
        </div>
      </div>

      <InlineForm
        open={formOpen}
        title={forceAgency ? "Nouvelle tâche agence" : "Nouvelle tâche"}
        onClose={() => {
          setFormOpen(false);
          setForceAgency(false);
        }}
        onSubmit={submit}
      >
        <TextField label="Tâche" value={text} onChange={setText} />
        <AutoGrowTextField label="Description" value={descr} onChange={setDescr} placeholder="Détaille la tâche — le champ s'agrandit tout seul…" className="min-w-full" />
        <TextField label="Commentaire (optionnel)" value={note} onChange={setNote} placeholder="Infos en plus, rappel, lien…" />
        <TextField
          label="Échéance"
          type="date"
          value={due}
          onChange={setDue}
        />
        <SelectField
          label="Priorité"
          value={priority}
          onChange={(v) => setPriority(v as Priority)}
          options={[
            { value: "haute", label: "Haute" },
            { value: "moyenne", label: "Moyenne" },
            { value: "basse", label: "Basse" },
          ]}
        />
        {forceAgency ? (
          <p className="text-[11px] text-faint">Tâche interne à l'agence (pas de créatrice).</p>
        ) : (
          <SelectField
            label="Pour qui"
            value={creator}
            onChange={setCreator}
            options={[
              { value: "", label: "Agence (tous)" },
              ...creators.map((c) => ({ value: c.name, label: titleCase(c.name) })),
            ]}
          />
        )}
      </InlineForm>

      {/* Barre de filtres */}
      {rows !== null && rows.length > 0 && (
        <div className="mb-4 flex flex-col gap-2.5">
          {/* Bascule de vue : liste ↔ colonnes par statut */}
          <div className="flex items-center gap-1 self-start rounded-full border border-border bg-surface p-1">
            {([["liste", "Liste", List], ["colonnes", "Colonnes", Columns3]] as const).map(([mode, label, Icon]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors",
                  viewMode === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
          {viewMode === "liste" && (
            <FilterBar
              value={todoFilter}
              onChange={(v) => setTodoFilter(v as TodoFilter)}
              options={TODO_FILTERS.map((f) => ({ value: f.id, label: f.label }))}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Select value={creatorSelectValue} onValueChange={onCreatorSelect}>
              <SelectTrigger
                className="h-9 w-auto min-w-[190px] rounded-full bg-surface"
                placeholder="Tous les créateurs"
              />
              <SelectContent>
                <SelectItem index={0} value={ALL}>
                  Tous
                </SelectItem>
                <SelectItem index={1} value="__agency__">
                  Agence
                </SelectItem>
                {creators.map((c, i) => (
                  <SelectItem key={c.id} index={i + 2} value={c.name}>
                    {titleCase(c.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <FilterBar
            value={priorityFilter ?? "__all__"}
            onChange={(v) => setPriorityFilter(v === "__all__" ? null : (v as Priority))}
            options={priorityPills.map((p) => ({ value: p.value ?? "__all__", label: p.label }))}
          />
        </div>
      )}

      {rows === null ? (
        <div className="rounded-xl border border-border bg-card shadow-sm px-4 py-3">
          <AnimatedBadge status="loading" size="sm">
            Chargement…
          </AnimatedBadge>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-border bg-card shadow-sm px-4 py-3">
          <p className="text-sm text-muted-foreground">
            Impossible de charger les tâches.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card shadow-sm px-4 py-3">
          <p className="text-sm text-muted-foreground">Aucune tâche en cours.</p>
        </div>
      ) : viewMode === "colonnes" ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {TODO_STATUS_OPTS.map((col) => {
            const colRows = filteredBase.filter((r) => todoStatus(r) === col.value);
            return (
              <div key={col.value} className="flex flex-col gap-2.5 rounded-2xl border border-border bg-panel/40 p-2.5">
                <div className="flex items-center justify-between px-1.5 pt-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", col.dot)} />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{col.label}</span>
                  </div>
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-faint">{colRows.length}</span>
                </div>
                {colRows.length === 0 ? (
                  <div className="px-2 py-8 text-center text-[11px] text-faint">Aucune tâche</div>
                ) : (
                  colRows.map((row) => (
                    <div
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedTodo(row)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedTodo(row); } }}
                      className="flex cursor-pointer flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-sm transition-colors hover:bg-rowhover"
                    >
                      <div className="flex items-start gap-2">
                        <PriorityDot priority={row.priority} />
                        <span className={cn("min-w-0 flex-1 text-[12.5px] font-medium leading-snug text-foreground", row.done && "text-muted-foreground line-through")}>
                          {row.text}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate rounded-md bg-rowhover px-2 py-[3px] text-[8px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {row.creator ? titleCase(row.creator) : "Agence"}
                        </span>
                        <div onClick={(e) => e.stopPropagation()}>
                          <StatusSelect value={todoStatus(row)} options={TODO_STATUS_OPTS} onChange={(s) => setStatus(row, s)} />
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
      ) : query.trim() && filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Aucun résultat pour « {query} »
          </div>
        </div>
      ) : noFilterMatch ? (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Aucune tâche pour ces filtres.
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((row) => {
            const updateStatus = async (status: string) => {
              if (await dbUpdate("todos", row.id, { status, done: status === "Fait" })) {
                setRows((prev) => (prev ?? []).map((r) => (r.id === row.id ? { ...r, status, done: status === "Fait" } : r)));
                setSelectedTodo((prev) => (prev?.id === row.id ? { ...prev, status, done: status === "Fait" } : prev));
              } else {
                toast("Statut non enregistré — la colonne « status » manque (lance le SQL)");
              }
            };
            return (
              <div key={row.id} className="rounded-2xl border border-border bg-card shadow-sm">
              <div
                role="button"
                tabIndex={0}
                onClick={() => setSelectedTodo(row)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedTodo(row);
                  }
                }}
                className="flex cursor-pointer items-center gap-3 rounded-2xl p-4 transition-colors hover:bg-rowhover"
              >
                {/* Case à cocher animée (barre progressive) */}
                <Checkbox
                  id={`todo-${row.id}`}
                  checked={row.done}
                  onClick={(e) => e.stopPropagation()}
                  onCheckedChange={(v) => (v === true ? setConfirmDone(row) : markDone(row, false))}
                  title={row.done ? "Marquer à refaire" : "Marquer comme fait"}
                  className="peer shrink-0"
                />

                {/* Texte + description */}
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor={`todo-${row.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                      "relative inline-block max-w-full cursor-pointer truncate align-top text-[13px] font-medium text-foreground transition-colors after:absolute after:left-0 after:top-1/2 after:h-px after:bg-current after:transition-all after:duration-300 after:content-['']",
                      row.done
                        ? "text-muted-foreground after:w-full"
                        : "after:w-0"
                    )}
                  >
                    {row.text}
                  </label>
                  {row.descr && (
                    <p className="mt-0.5 truncate text-[11px] leading-relaxed text-faint">
                      {row.descr}
                    </p>
                  )}
                  {formatCreatedAt(row.created_at) && (
                    <p className="mt-0.5 truncate text-[10px] leading-relaxed text-faint">
                      créée le {formatCreatedAt(row.created_at)}
                    </p>
                  )}
                </div>

                {/* Méta : statut + origine + créateur + priorité */}
                <div className="flex shrink-0 items-center gap-2">
                  <div onClick={(e) => e.stopPropagation()}>
                    <StatusSelect value={todoStatus(row)} options={TODO_STATUS_OPTS} onChange={updateStatus} />
                  </div>
                  {row.source === "creator" && (
                    <span className="hidden rounded-md bg-signalsoft px-2 py-[3px] text-[8px] font-semibold uppercase tracking-wider text-signaltext sm:inline">
                      Du créateur
                    </span>
                  )}
                  <span className="hidden rounded-md bg-rowhover px-2 py-[3px] text-[8px] font-semibold uppercase tracking-wider text-muted-foreground sm:inline">
                    {row.creator ? titleCase(row.creator) : "Agence"}
                  </span>
                  <PriorityDot priority={row.priority} />
                  <ActionMenu
                    items={[
                      {
                        key: "delete",
                        label: "Supprimer",
                        icon: Trash2,
                        danger: true,
                        onClick: async () => {
                          if (await dbTrash("todos", row.id, row.text, row.creator ?? undefined)) {
                            removeRow(row.id);
                            toast("Déplacé dans la corbeille");
                          } else {
                            toast("Erreur — réessaie");
                          }
                        },
                        confirm: { title: "Supprimer la tâche", message: `Supprimer « ${row.text} » ? Tu pourras la restaurer depuis la corbeille.` },
                      },
                    ]}
                  />
                </div>
              </div>

                {/* Commentaire d'avancement — directement sous la carte */}
                {noteEditId === row.id ? (
                  <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Avancement / commentaire</span>
                    <textarea
                      value={noteEditText}
                      onChange={(e) => setNoteEditText(e.target.value)}
                      rows={2}
                      autoFocus
                      placeholder="Où en es-tu ? Note ton avancement, un blocage, un lien…"
                      className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          await saveNote(row.id, noteEditText);
                          setNoteEditId(null);
                          toast("Commentaire enregistré ✓");
                        }}
                        className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
                      >
                        <Check className="h-3.5 w-3.5" /> Enregistrer
                      </button>
                      <button
                        type="button"
                        onClick={() => setNoteEditId(null)}
                        className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                        title="Annuler"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ) : notes[row.id] ? (
                  <button
                    type="button"
                    onClick={() => startNote(row.id)}
                    className="flex w-full items-start gap-2 border-t border-border px-4 py-2.5 text-left transition-colors hover:bg-rowhover"
                    title="Modifier le commentaire"
                  >
                    <MessageSquarePlus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
                    <span className="whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground">{notes[row.id]}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => startNote(row.id)}
                    className="flex w-full items-center gap-1.5 border-t border-border px-4 py-2 text-[11px] font-medium text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                  >
                    <MessageSquarePlus className="h-3.5 w-3.5" /> Ajouter un commentaire d'avancement
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Panneau de détail */}
      {selectedTodo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            setSelectedTodo(null);
            setEditing(false);
          }}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold leading-snug text-foreground">
                {editing ? "Modifier la tâche" : selectedTodo.text}
              </h2>
              <div className="flex shrink-0 items-center gap-1">
                {!editing && (
                  <button
                    type="button"
                    onClick={() => openEdit(selectedTodo)}
                    className="text-faint transition-colors hover:text-foreground"
                    title="Modifier"
                  >
                    <Pencil className="h-[18px] w-[18px]" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTodo(null);
                    setEditing(false);
                  }}
                  className="text-faint transition-colors hover:text-foreground"
                  title="Fermer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {editing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  saveEdit();
                }}
                className="flex flex-col gap-4"
              >
                <div className="flex flex-wrap items-end gap-3">
                  <TextField
                    label="Tâche"
                    value={editText}
                    onChange={setEditText}
                    className="min-w-full"
                  />
                  <AutoGrowTextField
                    label="Description"
                    value={editDescr}
                    onChange={setEditDescr}
                    className="min-w-full"
                  />
                  <TextField
                    label="Commentaire"
                    value={editNote}
                    onChange={setEditNote}
                    className="min-w-full"
                    placeholder="Infos en plus, rappel, lien…"
                  />
                  <TextField
                    label="Échéance"
                    type="date"
                    value={editDue}
                    onChange={setEditDue}
                  />
                  <SelectField
                    label="Priorité"
                    value={editPriority}
                    onChange={(v) => setEditPriority(v as Priority)}
                    options={[
                      { value: "haute", label: "Haute" },
                      { value: "moyenne", label: "Moyenne" },
                      { value: "basse", label: "Basse" },
                    ]}
                  />
                  <SelectField
                    label="Pour qui"
                    value={editCreator}
                    onChange={setEditCreator}
                    options={[
                      { value: "", label: "Agence (tous)" },
                      ...creators.map((c) => ({
                        value: c.name,
                        label: titleCase(c.name),
                      })),
                    ]}
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="h-[42px] shrink-0 rounded-lg border border-border bg-surface px-5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="h-[42px] shrink-0 rounded-lg bg-primary px-5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    Enregistrer
                  </button>
                </div>
              </form>
            ) : (
            <div className="flex flex-col gap-4">
              <DetailBlock label="Description">
                {selectedTodo.descr ? (
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
                    {selectedTodo.descr}
                  </p>
                ) : (
                  <p className="text-[13px] text-faint">Aucune description.</p>
                )}
              </DetailBlock>

              <DetailBlock label="Commentaire">
                {notes[selectedTodo.id] ? (
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
                    {notes[selectedTodo.id]}
                  </p>
                ) : (
                  <p className="text-[13px] text-faint">Aucun commentaire. Clique sur ✏️ pour en ajouter un.</p>
                )}
              </DetailBlock>

              <div className="grid grid-cols-2 gap-4">
                <DetailBlock label="Priorité">
                  <AnimatedBadge
                    status={prioOf(selectedTodo.priority).status}
                    size="sm"
                  >
                    {prioOf(selectedTodo.priority).label}
                  </AnimatedBadge>
                </DetailBlock>

                <DetailBlock label="Échéance">
                  <p className="text-[13px] text-foreground">
                    {frDate(selectedTodo.due)}
                  </p>
                </DetailBlock>

                <DetailBlock label="Créateur">
                  <p className="text-[13px] text-foreground">
                    {selectedTodo.creator
                      ? titleCase(selectedTodo.creator)
                      : "Agence"}
                  </p>
                </DetailBlock>

                <DetailBlock label="Tag">
                  <p className="text-[13px] text-foreground">
                    {selectedTodo.tag || "—"}
                  </p>
                </DetailBlock>

                <DetailBlock label="Source">
                  <p className="text-[13px] text-foreground">
                    {selectedTodo.source === "creator"
                      ? "Du créateur"
                      : "Agence"}
                  </p>
                </DetailBlock>

                {formatCreatedAt(selectedTodo.created_at) && (
                  <DetailBlock label="Créée le">
                    <p className="text-[13px] text-foreground">
                      {formatCreatedAt(selectedTodo.created_at)}
                    </p>
                  </DetailBlock>
                )}
              </div>
            </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation anti-missclick avant de marquer une tâche « faite » */}
      {confirmDone && (
        <ConfirmDialog
          title="Marquer comme fait ?"
          message={`« ${confirmDone.text} » sera marquée comme terminée.`}
          confirmLabel="Oui, c'est fait ✓"
          onCancel={() => setConfirmDone(null)}
          onConfirm={() => {
            const r = confirmDone;
            setConfirmDone(null);
            markDone(r, true);
          }}
        />
      )}
    </div>
  );
}

function DetailBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">
        {label}
      </span>
      {children}
    </div>
  );
}
