import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import { useSearch, matchQuery } from "@/lib/search";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { dbInsert, dbUpdate, dbDelete, nextOrder } from "@/lib/db";
import { toast } from "@/components/ui/toast";
import {
  AddButton,
  InlineForm,
  TextField,
  SelectField,
  DeleteButton,
} from "@/components/ui/form";
import { useCreators } from "@/lib/useCreators";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";
import { Checkbox } from "@/components/ui/checkbox";
import { useEffect, useState, type ReactNode } from "react";
import { X, Pencil } from "lucide-react";

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
  sort_order: number;
  created_at: string | null;
};

const priorityBadge: Record<
  Priority,
  { status: "danger" | "warning" | "neutral"; label: string }
> = {
  haute: { status: "danger", label: "Haute" },
  moyenne: { status: "warning", label: "Moyenne" },
  basse: { status: "neutral", label: "Basse" },
};

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
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<Priority>("moyenne");
  const [creator, setCreator] = useState("");

  const [creatorFilter, setCreatorFilter] = useState<CreatorFilter>(null);
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>(null);
  const [todoFilter, setTodoFilter] = useState<TodoFilter>("encours");
  const [selectedTodo, setSelectedTodo] = useState<Row | null>(null);

  // Édition de la tâche sélectionnée (dans le panneau de détail).
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [editDescr, setEditDescr] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editPriority, setEditPriority] = useState<Priority>("moyenne");
  const [editCreator, setEditCreator] = useState("");

  // Ouvre le mode édition en pré-remplissant depuis la tâche sélectionnée.
  const openEdit = (row: Row) => {
    setEditText(row.text);
    setEditDescr(row.descr ?? "");
    setEditDue(row.due && row.due !== "—" ? row.due : "");
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
    const patch = {
      text: editText.trim(),
      descr: editDescr.trim() || null,
      tag: editCreator ? "CRÉATEUR" : "AGENCE",
      due: editDue.trim() || "—",
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
    setEditing(false);
    toast("Tâche modifiée ✓");
  };

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("todos")
        .select("id, text, descr, tag, due, creator, priority, source, done, sort_order, created_at")
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
    setRows([created as unknown as Row, ...(rows ?? [])]);
    toast("Tâche ajoutée ✓");
    setFormOpen(false);
    setText("");
    setDescr("");
    setDue("");
    setPriority("moyenne");
    setCreator("");
  };

  const removeRow = (id: string) => {
    setRows((prev) => (prev ?? []).filter((r) => r.id !== id));
    setSelectedTodo((prev) => (prev?.id === id ? null : prev));
  };

  // Combine filtre statut + recherche + filtre créateur + filtre priorité.
  const filtered = (rows ?? []).filter((row) => {
    if (todoFilter === "encours" && row.done) return false;
    if (todoFilter === "terminees" && !row.done) return false;
    if (!matchQuery(query, row.text, row.descr, row.creator, row.tag)) return false;
    if (creatorFilter === "__agency__") {
      if (row.creator) return false;
    } else if (creatorFilter != null) {
      if (row.creator !== creatorFilter) return false;
    }
    if (priorityFilter != null && row.priority !== priorityFilter) return false;
    return true;
  });

  const noFilterMatch =
    rows !== null &&
    rows.length > 0 &&
    filtered.length === 0 &&
    !(query.trim() && filtered.length === 0);

  // Pills créateur : Tous / Agence / chaque créateur.
  const creatorPills: { label: string; value: CreatorFilter }[] = [
    { label: "Tous", value: null },
    { label: "Agence", value: "__agency__" },
    ...creators.map((c) => ({ label: titleCase(c.name), value: c.name })),
  ];

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
        <AddButton label="Tâche" onClick={() => setFormOpen(true)} />
      </div>

      <InlineForm
        open={formOpen}
        title="Nouvelle tâche"
        onClose={() => setFormOpen(false)}
        onSubmit={submit}
      >
        <TextField label="Tâche" value={text} onChange={setText} />
        <TextField label="Description" value={descr} onChange={setDescr} />
        <TextField
          label="Échéance"
          value={due}
          onChange={setDue}
          placeholder="JJ/MM ou —"
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
        <SelectField
          label="Pour qui"
          value={creator}
          onChange={setCreator}
          options={[
            { value: "", label: "Agence (tous)" },
            ...creators.map((c) => ({ value: c.name, label: titleCase(c.name) })),
          ]}
        />
      </InlineForm>

      {/* Barre de filtres */}
      {rows !== null && rows.length > 0 && (
        <div className="mb-4 flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {TODO_FILTERS.map((f) => {
              const active = todoFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setTodoFilter(f.id)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[10px] font-semibold transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-surface text-muted-foreground hover:bg-rowhover"
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {creatorPills.map((pill) => {
              const active = creatorFilter === pill.value;
              return (
                <button
                  key={pill.value ?? "__all__"}
                  type="button"
                  onClick={() => setCreatorFilter(pill.value)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[10px] font-semibold transition-colors",
                    active
                      ? "bg-foreground text-surface"
                      : "border border-border bg-surface text-muted-foreground hover:bg-rowhover"
                  )}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {priorityPills.map((pill) => {
              const active = priorityFilter === pill.value;
              return (
                <button
                  key={pill.value ?? "__all__"}
                  type="button"
                  onClick={() => setPriorityFilter(pill.value)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-[10px] font-semibold transition-colors",
                    active
                      ? "bg-foreground text-surface"
                      : "text-muted-foreground hover:bg-rowhover"
                  )}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>
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
        <div className="rounded-2xl border border-border bg-card shadow-sm px-4 sm:px-5">
          {filtered.map((row, index) => {
            const badge = priorityBadge[row.priority];
            const toggleDone = async (next: boolean) => {
              if (await dbUpdate("todos", row.id, { done: next })) {
                setRows((prev) =>
                  (prev ?? []).map((r) =>
                    r.id === row.id ? { ...r, done: next } : r
                  )
                );
                setSelectedTodo((prev) =>
                  prev?.id === row.id ? { ...prev, done: next } : prev
                );
                toast(next ? "Fait ✓" : "À refaire");
              }
            };
            return (
              <div
                key={row.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedTodo(row)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedTodo(row);
                  }
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-3 py-3 transition-colors hover:bg-rowhover/40",
                  index > 0 && "border-t border-border"
                )}
              >
                {/* Case à cocher animée (barre progressive) */}
                <Checkbox
                  id={`todo-${row.id}`}
                  checked={row.done}
                  onClick={(e) => e.stopPropagation()}
                  onCheckedChange={(v) => toggleDone(v === true)}
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

                {/* Méta : origine + créateur + priorité */}
                <div className="flex shrink-0 items-center gap-2">
                  {row.source === "creator" && (
                    <span className="hidden rounded-md bg-signalsoft px-2 py-[3px] text-[8px] font-semibold uppercase tracking-wider text-signaltext sm:inline">
                      Du créateur
                    </span>
                  )}
                  <span className="hidden rounded-md bg-rowhover px-2 py-[3px] text-[8px] font-semibold uppercase tracking-wider text-muted-foreground sm:inline">
                    {row.creator ? titleCase(row.creator) : "Agence"}
                  </span>
                  <AnimatedBadge status={badge.status} size="sm">
                    {badge.label}
                  </AnimatedBadge>
                  <DeleteButton
                    onClick={async () => {
                      if (await dbDelete("todos", row.id)) {
                        removeRow(row.id);
                        toast("Supprimé");
                      }
                    }}
                  />
                </div>
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
                  <TextField
                    label="Description"
                    value={editDescr}
                    onChange={setEditDescr}
                    className="min-w-full"
                  />
                  <TextField
                    label="Échéance"
                    value={editDue}
                    onChange={setEditDue}
                    placeholder="JJ/MM ou —"
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

              <div className="grid grid-cols-2 gap-4">
                <DetailBlock label="Priorité">
                  <AnimatedBadge
                    status={priorityBadge[selectedTodo.priority].status}
                    size="sm"
                  >
                    {priorityBadge[selectedTodo.priority].label}
                  </AnimatedBadge>
                </DetailBlock>

                <DetailBlock label="Échéance">
                  <p className="text-[13px] text-foreground">
                    {selectedTodo.due || "—"}
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
