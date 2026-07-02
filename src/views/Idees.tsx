import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
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
import { useEffect, useState } from "react";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";

type Row = {
  id: string;
  text: string;
  creator: string | null;
  status: string | null;
  source: string | null;
  sort_order: number | null;
};

const STATUS_OPTIONS = [
  { value: "À explorer", label: "À explorer" },
  { value: "À faire", label: "À faire" },
  { value: "En cours", label: "En cours" },
  { value: "Publiée", label: "Publiée" },
];

export function Idees() {
  const [rows, setRows] = useState<Row[] | null>(() => getCache<Row[]>("ideas"));
  const [error, setError] = useState<boolean>(false);
  const live = useLiveKey();

  const [formOpen, setFormOpen] = useState(false);
  const [text, setText] = useState("");

  useEffect(() => {
    let active = true;
    supabase
      .from("ideas")
      .select("id, text, creator, status, source, sort_order")
      .order("sort_order")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setError(true);
          setRows([]);
          return;
        }
        const list = (data ?? []) as Row[];
        setCache("ideas", list);
        setRows(list);
      });
    return () => {
      active = false;
    };
  }, [live]);

  const submit = async () => {
    if (!text.trim()) {
      toast("Renseigne l'idée");
      return;
    }
    const row = {
      text: text.trim(),
      creator: null,
      status: "À faire",
      source: "agency",
      sort_order: nextOrder(rows ?? []),
    };
    const created = await dbInsert("ideas", row);
    if (!created) {
      toast("Erreur — réessaie");
      return;
    }
    setRows([...(rows ?? []), created as unknown as Row]);
    toast("Idée ajoutée ✓");
    setFormOpen(false);
    setText("");
  };

  const updateStatus = async (id: string, status: string) => {
    setRows((prev) =>
      (prev ?? []).map((r) => (r.id === id ? { ...r, status } : r)),
    );
    if (!(await dbUpdate("ideas", id, { status }))) {
      toast("Erreur — réessaie");
    }
  };

  const removeRow = async (id: string) => {
    if (await dbDelete("ideas", id)) {
      setRows((prev) => (prev ?? []).filter((r) => r.id !== id));
      toast("Supprimée");
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {rows === null
            ? "Chargement…"
            : `${rows.length} idée${rows.length > 1 ? "s" : ""}`}
        </div>
        <AddButton label="Idée" onClick={() => setFormOpen(true)} />
      </div>

      <InlineForm
        open={formOpen}
        title="Nouvelle idée"
        onClose={() => setFormOpen(false)}
        onSubmit={submit}
      >
        <TextField label="Idée" value={text} onChange={setText} />
      </InlineForm>

      <div className="rounded-xl border border-border bg-card shadow-sm">
        {rows === null && (
          <div className="px-4 py-3">
            <AnimatedBadge status="loading" size="sm">
              Chargement…
            </AnimatedBadge>
          </div>
        )}

        {rows !== null && rows.length === 0 && (
          <div className="px-4 py-3 text-sm text-muted-foreground">
            {error
              ? "Impossible de charger les idées."
              : "Aucune idée pour le moment."}
          </div>
        )}

        {rows !== null &&
          rows.length > 0 &&
          rows.map((row, index) => (
            <div key={row.id} className={cnRow(index)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    {row.text}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {row.creator ? titleCase(row.creator) : "Toutes"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {row.source === "creator"
                      ? "Proposée par le créateur"
                      : "Ajoutée par l'agence"}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="w-[150px]">
                    <SelectField
                      label="Statut"
                      value={row.status ?? "À faire"}
                      onChange={(v) => updateStatus(row.id, v)}
                      options={STATUS_OPTIONS}
                    />
                  </div>
                  <DeleteButton onClick={() => removeRow(row.id)} />
                </div>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

function cnRow(index: number): string {
  return cn("px-4 py-3", index > 0 && "border-t border-border");
}
