import { supabase } from "@/lib/supabase";
import { useSearch, matchQuery } from "@/lib/search";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { cn } from "@/lib/utils";
import { CalendarClock, Wallet, Target, Package, Pencil, X, Columns3, List as ListIcon, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";
import { dbInsert, dbUpdate, nextOrder } from "@/lib/db";
import { dbTrash } from "@/lib/trash";
import { toast } from "@/components/ui/toast";
import { AddButton, InlineForm, TextField, SelectField } from "@/components/ui/form";
import { ActionMenu } from "@/components/ui/action-menu";
import { StatusSelect, type StatusOption } from "@/components/ui/status-select";
import { useCreators } from "@/lib/useCreators";
import { useLiveKey } from "@/lib/useLive";
import { toISODate, frDate } from "@/lib/dates";
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

const STATUS_OPTS: StatusOption[] = [
  { value: "attente", label: "En attente", dot: "bg-amber" },
  { value: "valider", label: "À valider", dot: "bg-primary" },
  { value: "cours", label: "En cours", dot: "bg-cyan" },
  { value: "terminé", label: "Terminé", dot: "bg-signal" },
];

/** Colonne (canonique) d'un brief selon son statut stocké. */
function colKey(status: string): string {
  // Insensible aux accents : "terminé" (é précomposé) ne contient PAS "termine".
  const s = String(status).toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (s.includes("termin")) return "terminé";
  if (s.includes("cours")) return "cours";
  if (s.includes("valider")) return "valider";
  return "attente";
}
function statusMeta(status: string): { variant: BadgeStatus; label: string } {
  const k = colKey(status);
  if (k === "terminé") return { variant: "success", label: "Terminé" };
  if (k === "cours") return { variant: "info", label: "En cours" };
  if (k === "valider") return { variant: "warning", label: "À valider" };
  return { variant: "warning", label: "En attente" };
}

export function Briefs() {
  const [rows, setRows] = useState<Row[] | null>(() => getCache<Row[]>("briefs"));
  const [error, setError] = useState(false);
  const { query } = useSearch();
  const creators = useCreators();
  const live = useLiveKey();

  const [view, setView] = useState<"board" | "list">("list");
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
    setEditDue(toISODate(row.due));
    setEditObjectif(row.objectif === "—" ? "" : row.objectif);
  };
  const saveEdit = async (id: string) => {
    if (!editBrand.trim()) {
      toast("Renseigne la marque");
      return;
    }
    // Préserve une échéance legacy illisible (texte libre) si le champ date est resté vide.
    const oldDue = (rows ?? []).find((r) => r.id === id)?.due ?? "";
    const dueVal = editDue.trim()
      ? editDue.trim()
      : oldDue && oldDue !== "—" && !toISODate(oldDue)
        ? oldDue
        : "—";
    const patch = {
      brand: editBrand.trim(),
      deliverables: editDeliverables.trim() || "—",
      due: dueVal,
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
    // MAJ optimiste → la carte se déplace immédiatement dans la bonne colonne.
    setRows((prev) => (prev ?? []).map((r) => (r.id === id ? { ...r, status: next } : r)));
    if (!(await dbUpdate("briefs", id, { status: next }))) toast("Erreur — réessaie");
  };
  const del = async (row: Row) => {
    if (await dbTrash("briefs", row.id, row.brand, row.creator || undefined)) {
      setRows((rows ?? []).filter((r) => r.id !== row.id));
      toast("Déplacé dans la corbeille");
    }
  };

  const creatorOptions = [{ value: "", label: "—" }, ...creators.map((c) => ({ value: c.name, label: c.name }))];

  const filtered = (rows ?? []).filter((row) => matchQuery(query, row.brand, row.creator, row.deliverables, row.status));

  // ---- rendu d'une carte (compacte pour le board, riche pour la liste) ----
  const renderCard = (row: Row, compact: boolean): ReactElement => {
    if (editId === row.id) {
      return (
        <div key={row.id} className="flex flex-col rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">Modifier</div>
            <button type="button" onClick={() => setEditId(null)} className="text-faint hover:text-foreground" title="Annuler">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-col gap-3">
            <TextField label="Marque" value={editBrand} onChange={setEditBrand} />
            <TextField label="Livrables" value={editDeliverables} onChange={setEditDeliverables} placeholder="ex 3 posts · 1 reel" />
            <TextField label="Échéance" type="date" value={editDue} onChange={setEditDue} />
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
    const meta = statusMeta(row.status);
    return (
      <div key={row.id} className="flex flex-col rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-rowhover">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold tracking-tight text-foreground">{row.brand}</h2>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{row.creator || "—"}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {!compact && (
              <AnimatedBadge status={meta.variant} size="sm">
                {meta.label}
              </AnimatedBadge>
            )}
            <ActionMenu
              items={[
                { key: "edit", label: "Modifier", icon: Pencil, onClick: () => startEdit(row) },
                { key: "delete", label: "Mettre à la corbeille", icon: Trash2, danger: true, onClick: () => del(row), confirm: { title: "Mettre à la corbeille", message: `Déplacer le brief « ${row.brand} » vers la corbeille ? Tu pourras le restaurer.`, confirmLabel: "Mettre à la corbeille" } },
              ]}
            />
          </div>
        </div>

        <div className="mt-3 rounded-xl bg-panel px-3 py-2">
          <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">
            <Package className="h-3 w-3" /> Livrables
          </div>
          <div className="mt-1 text-[12px] font-medium leading-snug text-foreground">{row.deliverables || "—"}</div>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-panel px-3 py-2">
            <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">
              <Wallet className="h-3 w-3" /> Budget
            </div>
            <div className="mt-1 truncate text-[12px] font-medium text-foreground">{row.budget || "—"}</div>
          </div>
          <div className="rounded-xl bg-panel px-3 py-2">
            <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">
              <Target className="h-3 w-3" /> Objectif
            </div>
            <div className="mt-1 truncate text-[12px] font-medium text-foreground">{row.objectif || "—"}</div>
          </div>
        </div>

        <div className="mt-3">
          <StatusSelect value={colKey(row.status)} options={STATUS_OPTS} onChange={(v) => changeStatus(row.id, v)} />
        </div>

        <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-2.5 text-[11px] text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5 shrink-0 text-faint" />
          <span className="truncate">Échéance {frDate(row.due)}</span>
        </div>
      </div>
    );
  };

  let content: ReactElement;
  if (rows === null) {
    content = (
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <AnimatedBadge status="loading" size="sm">Chargement…</AnimatedBadge>
      </div>
    );
  } else if (error) {
    content = <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">Erreur de chargement.</div>;
  } else if (rows.length === 0) {
    content = <div className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-sm">Aucun brief pour le moment. Ajoute le premier 📋</div>;
  } else if (view === "board") {
    content = (
      <div className="flex items-start gap-4 overflow-x-auto pb-4 [-ms-overflow-style:none] [scrollbar-width:thin]">
        {STATUS_OPTS.map((col) => {
          const items = filtered.filter((r) => colKey(r.status) === col.value);
          return (
            <div key={col.value} className="flex w-[280px] shrink-0 flex-col">
              <div className="mb-3 flex items-center gap-2 px-1">
                <span className={cn("size-2 rounded-full", col.dot)} />
                <span className="text-[12px] font-semibold text-foreground">{col.label}</span>
                <span className="ml-auto rounded-full bg-rowhover px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{items.length}</span>
              </div>
              <div className="flex flex-col gap-3 rounded-2xl bg-panel/60 p-2 min-h-[120px]">
                {items.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-[11px] text-faint">Vide</div>
                ) : (
                  items.map((r) => renderCard(r, true))
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  } else if (filtered.length === 0) {
    content = <div className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-sm">{query.trim() ? `Aucun résultat pour « ${query} »` : "Aucun brief."}</div>;
  } else {
    content = <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map((r) => renderCard(r, false))}</div>;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-foreground">{rows === null ? "Chargement…" : `${rows.length} brief${rows.length > 1 ? "s" : ""}`}</div>
          {/* Toggle vue */}
          <div className="flex gap-1 rounded-lg bg-panel p-0.5">
            {([
              { id: "list", label: "Liste", icon: ListIcon },
              { id: "board", label: "Colonnes", icon: Columns3 },
            ] as const).map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors",
                  view === v.id ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <v.icon className="h-3.5 w-3.5" /> {v.label}
              </button>
            ))}
          </div>
        </div>
        <AddButton label="Brief" onClick={() => setFormOpen(true)} />
      </div>

      <InlineForm open={formOpen} title="Nouveau brief" onClose={() => setFormOpen(false)} onSubmit={submit}>
        <TextField label="Marque" value={brand} onChange={setBrand} />
        <SelectField label="Créateur" value={creator} onChange={setCreator} options={creatorOptions} />
        <TextField label="Livrables" value={deliverables} onChange={setDeliverables} placeholder="ex 3 posts · 1 reel" />
        <TextField label="Échéance" type="date" value={due} onChange={setDue} />
        <TextField label="Budget" value={budget} onChange={setBudget} />
        <TextField label="Objectif" value={objectif} onChange={setObjectif} />
        <SelectField label="Statut" value={status} onChange={setStatus} options={STATUS_OPTS.map((s) => ({ value: s.value, label: s.label }))} />
      </InlineForm>

      {content}
    </div>
  );
}
