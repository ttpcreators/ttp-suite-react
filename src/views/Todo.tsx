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
import { useEffect, useState } from "react";

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
};

const priorityBadge: Record<
  Priority,
  { status: "danger" | "warning" | "neutral"; label: string }
> = {
  haute: { status: "danger", label: "Haute" },
  moyenne: { status: "warning", label: "Moyenne" },
  basse: { status: "neutral", label: "Basse" },
};

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

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("todos")
        .select("id, text, descr, tag, due, creator, priority, source, done, sort_order")
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

  const filtered = (rows ?? []).filter((row) =>
    matchQuery(query, row.text, row.descr, row.creator, row.tag)
  );

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
      ) : (
        <div className="rounded-2xl border border-border bg-card shadow-sm px-4 sm:px-5">
          {filtered.map((row, index) => {
            const badge = priorityBadge[row.priority];
            const markDone = async () => {
              if (await dbUpdate("todos", row.id, { done: true })) {
                setRows((prev) =>
                  (prev ?? []).filter((r) => r.id !== row.id)
                );
                toast("Fait ✓");
              }
            };
            return (
              <div
                key={row.id}
                className={cn(
                  "flex items-center gap-3 py-3",
                  index > 0 && "border-t border-border"
                )}
              >
                {/* Case à cocher */}
                <button
                  type="button"
                  onClick={markDone}
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
                        setRows((prev) =>
                          (prev ?? []).filter((r) => r.id !== row.id)
                        );
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
    </div>
  );
}
