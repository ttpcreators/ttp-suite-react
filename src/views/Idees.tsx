import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { dbInsert, dbUpdate, dbDelete, nextOrder } from "@/lib/db";
import { toast } from "@/components/ui/toast";
import {
  AddButton,
  InlineForm,
  TextField,
  DeleteButton,
} from "@/components/ui/form";
import { StatusSelect, type StatusOption } from "@/components/ui/status-select";
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

const STATUS_OPTS: StatusOption[] = [
  { value: "À explorer", label: "À explorer", dot: "bg-indigo" },
  { value: "À faire", label: "À faire", dot: "bg-primary" },
  { value: "En cours", label: "En cours", dot: "bg-cyan" },
  { value: "Publiée", label: "Publiée", dot: "bg-signal" },
];

const STATUS_FILTERS = ["À explorer", "À faire", "En cours", "Publiée"];
const ALL_STATUS = "__all__";

export function Idees() {
  const [rows, setRows] = useState<Row[] | null>(() => getCache<Row[]>("ideas"));
  const [error, setError] = useState<boolean>(false);
  const live = useLiveKey();

  const [formOpen, setFormOpen] = useState(false);
  const [text, setText] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL_STATUS);

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

  const filtered =
    rows === null
      ? null
      : statusFilter === ALL_STATUS
        ? rows
        : rows.filter((r) => (r.status ?? "À faire") === statusFilter);

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

      {/* Barre de filtres par statut */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setStatusFilter(ALL_STATUS)}
          className={cn(chipBase, statusFilter === ALL_STATUS ? chipActive : chipInactive)}
        >
          Tous
        </button>
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={cn(chipBase, statusFilter === s ? chipActive : chipInactive)}
          >
            {s}
          </button>
        ))}
      </div>

      <InlineForm
        open={formOpen}
        title="Nouvelle idée"
        onClose={() => setFormOpen(false)}
        onSubmit={submit}
      >
        <TextField label="Idée" value={text} onChange={setText} />
      </InlineForm>

      {rows === null ? (
        <div className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
          <AnimatedBadge status="loading" size="sm">Chargement…</AnimatedBadge>
        </div>
      ) : filtered !== null && filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground shadow-sm">
          {error
            ? "Impossible de charger les idées."
            : rows.length > 0
              ? "Aucune idée pour ce filtre."
              : "Aucune idée pour le moment. Ajoute la première 💡"}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {(filtered ?? []).map((row) => (
            <div
              key={row.id}
              className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-rowhover"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{row.text}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {row.creator ? titleCase(row.creator) : "Toutes"} ·{" "}
                    {row.source === "creator" ? "Proposée par le créateur" : "Ajoutée par l'agence"}
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:shrink-0">
                  <div className="flex-1 sm:w-[160px] sm:flex-none">
                    <StatusSelect
                      value={row.status ?? "À faire"}
                      options={STATUS_OPTS}
                      onChange={(v) => updateStatus(row.id, v)}
                    />
                  </div>
                  <DeleteButton onClick={() => removeRow(row.id)} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const chipBase =
  "rounded-full px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors";
const chipActive = "bg-primary text-primary-foreground";
const chipInactive = "border border-border bg-surface text-muted-foreground hover:bg-rowhover hover:text-foreground";
