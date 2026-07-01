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
import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";

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

export function Todo() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const { query } = useSearch();
  const creators = useCreators();

  const [formOpen, setFormOpen] = useState(false);
  const [text, setText] = useState("");
  const [descr, setDescr] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<Priority>("moyenne");
  const [creator, setCreator] = useState("");

  const [creatorFilter, setCreatorFilter] = useState<CreatorFilter>(null);
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>(null);
  const [selectedTodo, setSelectedTodo] = useState<Row | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("todos")
        .select("id, text, descr, tag, due, creator, priority, source, done, sort_order, created_at")
        .eq("done", false)
        .order("sort_order");
      if (!active) return;
      if (error) {
        setError(true);
        setRows([]);
        return;
      }
      setRows((data as Row[]) ?? []);
    })();
    return () => {
      active = false;
    };
  }, []);

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

  // Combine recherche + filtre créateur + filtre priorité.
  const filtered = (rows ?? []).filter((row) => {
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
            : `${rows.length} tâche${rows.length > 1 ? "s" : ""} en cours`}
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
            const markDone = async () => {
              if (await dbUpdate("todos", row.id, { done: true })) {
                removeRow(row.id);
                toast("Fait ✓");
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
                {/* Case à cocher */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    markDone();
                  }}
                  title="Marquer comme fait"
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border-[1.5px] border-faint transition-colors hover:border-signal"
                />

                {/* Texte + description */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">
                    {row.text}
                  </p>
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
          onClick={() => setSelectedTodo(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold leading-snug text-foreground">
                {selectedTodo.text}
              </h2>
              <button
                type="button"
                onClick={() => setSelectedTodo(null)}
                className="shrink-0 text-faint transition-colors hover:text-foreground"
                title="Fermer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

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
