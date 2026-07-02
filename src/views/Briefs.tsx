import { supabase } from "@/lib/supabase";
import { useSearch, matchQuery } from "@/lib/search";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { cn } from "@/lib/utils";
import { CalendarClock, Wallet, Target, Package, Pencil, X } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";
import { dbInsert, dbUpdate, dbDelete, nextOrder } from "@/lib/db";
import { toast } from "@/components/ui/toast";
import { AddButton, InlineForm, TextField, SelectField, DeleteButton } from "@/components/ui/form";
import { useCreators } from "@/lib/useCreators";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";

type Row = {
  id: string;
  brand: string;
  creator: string;
  deliverables: string;
  due: string;
  status: string;
  budget: string;
  objectif: string;
  sort_order: number;
};

type BadgeStatus = "success" | "warning" | "danger" | "neutral" | "info" | "loading";

function statusMeta(status: string): { variant: BadgeStatus; label: string; dot: string } {
  const s = String(status).toLowerCase();
  if (s.includes("valider") || s.includes("attente")) {
    return { variant: "warning", label: "À valider", dot: "bg-amber" };
  }
  if (s.includes("cours")) {
    return { variant: "info", label: "En cours", dot: "bg-cyan" };
  }
  if (s.includes("termine")) {
    return { variant: "success", label: "Terminé", dot: "bg-signal" };
  }
  return { variant: "neutral", label: status, dot: "bg-muted-foreground" };
}

export function Briefs() {
  const [rows, setRows] = useState<Row[] | null>(() => getCache<Row[]>("briefs"));
  const [error, setError] = useState(false);
  const { query } = useSearch();
  const creators = useCreators();
  const live = useLiveKey();

  const [formOpen, setFormOpen] = useState(false);
  const [brand, setBrand] = useState("");
  const [creator, setCreator] = useState("");
  const [deliverables, setDeliverables] = useState("");
  const [due, setDue] = useState("");
  const [budget, setBudget] = useState("");
  const [objectif, setObjectif] = useState("");
  const [status, setStatus] = useState("attente");

  const [editId, setEditId] = useState<string | null>(null);
  const [editBrand, setEditBrand] = useState("");
  const [editDeliverables, setEditDeliverables] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editObjectif, setEditObjectif] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("briefs")
        .select("id, brand, creator, deliverables, due, status, budget, objectif, sort_order")
        .order("sort_order");
      if (!active) return;
      if (error) {
        setError(true);
        setRows([]);
        return;
      }
      const list = (data as Row[]) ?? [];
      setCache("briefs", list);
      setRows(list);
    })();
    return () => {
      active = false;
    };
  }, [live]);

  const submit = async () => {
    if (!brand.trim()) {
      toast("Renseigne la marque");
      return;
    }
    const row = {
      brand: brand.trim(),
      creator: creator || "",
      who: creator || "",
      deliverables,
      due: due || "—",
      status,
      tone: "cyan",
      consignes: "",
      budget: budget || "—",
      objectif: objectif.trim() || "—",
      sort_order: nextOrder(rows ?? []),
    };
    const created = await dbInsert("briefs", row);
    if (!created) {
      toast("Erreur — réessaie");
      return;
    }
    setRows([created as unknown as Row, ...(rows ?? [])]);
    toast("Brief ajouté ✓");
    setFormOpen(false);
    setBrand("");
    setCreator("");
    setDeliverables("");
    setDue("");
    setBudget("");
    setObjectif("");
    setStatus("attente");
  };

  const startEdit = (row: Row) => {
    setEditId(row.id);
    setEditBrand(row.brand);
    setEditDeliverables(row.deliverables === "—" ? "" : row.deliverables);
    setEditDue(row.due === "—" ? "" : row.due);
    setEditObjectif(row.objectif === "—" ? "" : row.objectif);
  };

  const cancelEdit = () => {
    setEditId(null);
  };

  const saveEdit = async (id: string) => {
    if (!editBrand.trim()) {
      toast("Renseigne la marque");
      return;
    }
    const patch = {
      brand: editBrand.trim(),
      deliverables: editDeliverables.trim() || "—",
      due: editDue.trim() || "—",
      objectif: editObjectif.trim() || "—",
    };
    if (!(await dbUpdate("briefs", id, patch))) {
      toast("Erreur — réessaie");
      return;
    }
    setRows((rows ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
    toast("Brief mis à jour ✓");
    setEditId(null);
  };

  const changeStatus = async (id: string, next: string) => {
    if (!(await dbUpdate("briefs", id, { status: next }))) {
      toast("Erreur — réessaie");
      return;
    }
    setRows((rows ?? []).map((r) => (r.id === id ? { ...r, status: next } : r)));
  };

  const creatorOptions = [
    { value: "", label: "—" },
    ...creators.map((c) => ({ value: c.name, label: c.name })),
  ];

  const statusOptions = [
    { value: "attente", label: "En attente" },
    { value: "valider", label: "À valider" },
    { value: "cours", label: "En cours" },
    { value: "terminé", label: "Terminé" },
  ];

  const filtered = (rows ?? []).filter((row) =>
    matchQuery(query, row.brand, row.creator, row.deliverables, row.status)
  );

  const header = (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="text-sm text-muted-foreground">
        {rows === null ? "Chargement…" : `${rows.length} brief${rows.length > 1 ? "s" : ""}`}
      </div>
      <AddButton label="Brief" onClick={() => setFormOpen(true)} />
    </div>
  );

  const form = (
    <InlineForm open={formOpen} title="Nouveau brief" onClose={() => setFormOpen(false)} onSubmit={submit}>
      <TextField label="Marque" value={brand} onChange={setBrand} />
      <SelectField label="Créateur" value={creator} onChange={setCreator} options={creatorOptions} />
      <TextField label="Livrables" value={deliverables} onChange={setDeliverables} placeholder="ex 3 posts · 1 reel" />
      <TextField label="Échéance" value={due} onChange={setDue} />
      <TextField label="Budget" value={budget} onChange={setBudget} />
      <TextField label="Objectif" value={objectif} onChange={setObjectif} />
      <SelectField label="Statut" value={status} onChange={setStatus} options={statusOptions} />
    </InlineForm>
  );

  let content: ReactElement;
  if (rows === null) {
    content = (
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <AnimatedBadge status="loading" size="sm">Chargement…</AnimatedBadge>
      </div>
    );
  } else if (error) {
    content = (
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <p className="text-sm text-muted-foreground">
          Une erreur est survenue lors du chargement des briefs.
        </p>
      </div>
    );
  } else if (rows.length === 0) {
    content = (
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <p className="text-sm text-muted-foreground">Aucun brief pour le moment.</p>
      </div>
    );
  } else if (query.trim() && filtered.length === 0) {
    content = (
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          Aucun résultat pour « {query} »
        </div>
      </div>
    );
  } else {
    content = (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((row) => {
          const meta = statusMeta(row.status);
          const editing = editId === row.id;
          if (editing) {
            return (
              <div
                key={row.id}
                className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-sm"
              >
                <div className="mb-3.5 flex items-center justify-between">
                  <div className="text-sm font-semibold">Modifier le brief</div>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="text-faint transition-colors hover:text-foreground"
                    title="Annuler"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-col gap-3">
                  <TextField label="Marque" value={editBrand} onChange={setEditBrand} />
                  <TextField
                    label="Livrables"
                    value={editDeliverables}
                    onChange={setEditDeliverables}
                    placeholder="ex 3 posts · 1 reel"
                  />
                  <TextField label="Échéance" value={editDue} onChange={setEditDue} />
                  <TextField label="Objectif" value={editObjectif} onChange={setEditObjectif} />
                  <button
                    type="button"
                    onClick={() => saveEdit(row.id)}
                    className="h-[42px] shrink-0 rounded-lg bg-primary px-5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div
              key={row.id}
              className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-sm transition-colors hover:bg-rowhover"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-[7px] w-[7px] shrink-0 rounded-full", meta.dot)} />
                    <h2 className="truncate text-[15px] font-semibold tracking-tight text-foreground">
                      {row.brand}
                    </h2>
                  </div>
                  <p className="mt-1.5 truncate text-xs text-muted-foreground">
                    {row.creator || "—"} · échéance {row.due || "—"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <AnimatedBadge status={meta.variant} size="sm">
                    {meta.label}
                  </AnimatedBadge>
                  <button
                    type="button"
                    onClick={() => startEdit(row)}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                    title="Modifier"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <DeleteButton
                    onClick={async () => {
                      if (await dbDelete("briefs", row.id)) {
                        setRows((rows ?? []).filter((r) => r.id !== row.id));
                        toast("Supprimé");
                      }
                    }}
                  />
                </div>
              </div>

              <div className="mt-4 rounded-xl bg-panel px-4 py-3">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                  <Package className="h-3 w-3" />
                  Livrables
                </div>
                <div className="mt-1.5 text-[13px] font-medium leading-snug text-foreground">
                  {row.deliverables || "—"}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-panel px-4 py-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                    <Wallet className="h-3 w-3" />
                    Budget
                  </div>
                  <div className="mt-1.5 truncate text-[13px] font-medium text-foreground">
                    {row.budget || "—"}
                  </div>
                </div>
                <div className="rounded-xl bg-panel px-4 py-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                    <Target className="h-3 w-3" />
                    Objectif
                  </div>
                  <div className="mt-1.5 truncate text-[13px] font-medium text-foreground">
                    {row.objectif || "—"}
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <SelectField
                  label="Statut"
                  value={row.status}
                  onChange={(v) => changeStatus(row.id, v)}
                  options={statusOptions}
                />
              </div>

              <div className="mt-4 flex items-center gap-1.5 border-t border-border pt-3 text-[11px] text-muted-foreground">
                <CalendarClock className="h-3.5 w-3.5 shrink-0 text-faint" />
                <span className="truncate">Échéance {row.due || "—"}</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      {header}
      {form}
      {content}
    </div>
  );
}
