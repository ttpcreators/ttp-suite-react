import { supabase } from "@/lib/supabase";
import { useSearch, matchQuery } from "@/lib/search";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { cn, titleCase } from "@/lib/utils";
import { CalendarClock, Wallet, Target, Package, Pencil, X, Columns3, List as ListIcon, Trash2, FileDown, Paperclip, FileText, UserRound, Clock } from "lucide-react";
import { FilterPanel, type FilterGroup } from "@/components/ui/filter-panel";
import { StatsBento } from "@/components/ui/stats-bento";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { dbInsert, dbUpdate, nextOrder } from "@/lib/db";
import { dbTrash } from "@/lib/trash";
import { printHtml } from "@/lib/printPdf";
import { pdfShell, pdfHeading, pdfMeta, pdfSection } from "@/lib/pdfDoc";
import { toast } from "@/components/ui/toast";
import { AddButton, InlineForm, TextField, AutoGrowTextField, SelectField } from "@/components/ui/form";
import { ActionMenu } from "@/components/ui/action-menu";
import { StatusSelect, type StatusOption } from "@/components/ui/status-select";
import { useCreators } from "@/lib/useCreators";
import { useLiveKey } from "@/lib/useLive";
import { toISODate, frDate } from "@/lib/dates";
import { getCache, setCache } from "@/lib/viewCache";
import { notifyCreator } from "@/lib/push";

type Row = {
  id: string;
  brand: string;
  creator: string;
  deliverables: string;
  due: string;
  status: string;
  budget: string;
  objectif: string;
  /** Script / consignes en texte libre (écrit par l'agence ou la créatrice) —
   *  c'est le corps du document PDF envoyé à la marque. Colonne `consignes` en base. */
  consignes: string;
  sort_order: number;
  /** PDF joint (facultatif) : uploadé dans le bucket documents, aussi inséré comme
   *  ligne `documents` (type brief) → visible dans Docs + le portail créateur. */
  pdf?: { name: string; path: string; docId?: string } | null;
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

function escHtml(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Brief + script en HTML « pro » → impression navigateur → « Enregistrer en PDF ».
 *  Document destiné à la MARQUE : même DA que la facture / le bilan de campagne. */
/** PDF du brief — identité de document partagée (cf. `src/lib/pdfDoc.ts`). */
function briefHTML(row: Row): string {
  const script = (row.consignes || "").trim();
  const body =
    pdfMeta([
      ["Créateur", row.creator ? titleCase(row.creator) : ""],
      ["Livrables", row.deliverables],
      ["Objectif", row.objectif],
      ["Budget", row.budget],
      ["Échéance", frDate(row.due)],
    ]) +
    pdfSection(
      "Script",
      script
        ? `<div class="pre">${escHtml(script)}</div>`
        : `<p class="muted">Aucun script renseigné.</p>`,
    );
  return pdfShell({
    // Le <title> devient le nom de fichier proposé à l'enregistrement PDF.
    title: `Brief ${row.brand}${row.creator ? " x " + titleCase(row.creator) : ""}`,
    eyebrow: "Brief & script",
    heading: pdfHeading(row.brand, row.creator ? titleCase(row.creator) : undefined),
    body,
  });
}

export function Briefs() {
  const [rows, setRows] = useState<Row[] | null>(() => getCache<Row[]>("briefs"));
  const [error, setError] = useState(false);
  const { query } = useSearch();
  const creators = useCreators();
  const live = useLiveKey();

  const [view, setView] = useState<"board" | "list">("list");
  const [statusFilter, setStatusFilter] = useState<string>("__all__");
  const [creatorFilter, setCreatorFilter] = useState<string>("");
  const [formOpen, setFormOpen] = useState(false);
  const [brand, setBrand] = useState("");
  const [creator, setCreator] = useState("");
  const [deliverables, setDeliverables] = useState("");
  const [due, setDue] = useState("");
  const [budget, setBudget] = useState("");
  const [objectif, setObjectif] = useState("");
  const [script, setScript] = useState("");
  const [status, setStatus] = useState("attente");

  const [editId, setEditId] = useState<string | null>(null);
  const [editBrand, setEditBrand] = useState("");
  const [editDeliverables, setEditDeliverables] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editObjectif, setEditObjectif] = useState("");
  const [editScript, setEditScript] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("briefs")
        .select("id, brand, creator, deliverables, due, status, budget, objectif, consignes, sort_order, pdf")
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
      consignes: script.trim(),
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
    if (creator) notifyCreator("brief", creator, brand.trim()); // push au créateur (s'il a activé les notifs)
    toast("Brief ajouté ✓");
    setFormOpen(false);
    setBrand("");
    setCreator("");
    setDeliverables("");
    setDue("");
    setBudget("");
    setObjectif("");
    setScript("");
    setStatus("attente");
  };

  const startEdit = (row: Row) => {
    setEditId(row.id);
    setEditBrand(row.brand);
    setEditDeliverables(row.deliverables === "—" ? "" : row.deliverables);
    setEditDue(toISODate(row.due));
    setEditObjectif(row.objectif === "—" ? "" : row.objectif);
    setEditScript(row.consignes ?? "");
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
      consignes: editScript.trim(),
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
    const prevStatus = (rows ?? []).find((r) => r.id === id)?.status;
    setRows((prev) => (prev ?? []).map((r) => (r.id === id ? { ...r, status: next } : r)));
    if (!(await dbUpdate("briefs", id, { status: next }))) {
      // Échec (RLS/réseau) : on remet l'ancien statut au lieu de laisser l'UI mentir.
      setRows((prev) => (prev ?? []).map((r) => (r.id === id ? { ...r, status: prevStatus ?? r.status } : r)));
      toast("Erreur — réessaie");
    }
  };
  const del = async (row: Row) => {
    if (await dbTrash("briefs", row.id, row.brand, row.creator || undefined)) {
      setRows((rows ?? []).filter((r) => r.id !== row.id));
      toast("Déplacé dans la corbeille");
    }
  };

  // ── PDF joint au brief → aussi inséré comme ligne `documents` (type brief) pour
  //    apparaître dans Documents (agence) ET l'espace/portail du créateur. ──
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const attachTargetRef = useRef<Row | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  const patchRow = (id: string, patch: Partial<Row>) =>
    setRows((prev) => {
      const next = (prev ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r));
      setCache("briefs", next);
      return next;
    });

  const triggerAttach = (row: Row) => {
    attachTargetRef.current = row;
    pdfInputRef.current?.click();
  };

  const onPdfPicked = async (files: FileList | null) => {
    const file = files?.[0];
    const row = attachTargetRef.current;
    if (pdfInputRef.current) pdfInputRef.current.value = "";
    attachTargetRef.current = null;
    if (!file || !row) return;
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) return toast("Choisis un fichier PDF");
    if (file.size > 20 * 1024 * 1024) return toast("PDF trop lourd (max 20 Mo)");
    setPdfBusy(row.id);
    try {
      // Remplace un PDF existant : on nettoie l'ancien fichier + son doc.
      if (row.pdf?.path) await supabase.storage.from("documents").remove([row.pdf.path]).catch(() => {});
      if (row.pdf?.docId) await supabase.from("documents").delete().eq("id", row.pdf.docId).then(() => {}, () => {});
      const slug = (row.brand || "brief").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brief";
      const path = `briefs/${slug}-${Date.now()}.pdf`;
      const up = await supabase.storage.from("documents").upload(path, file, { contentType: "application/pdf", upsert: false });
      if (up.error) return toast("Upload échoué — réessaie");
      const docName = `Brief — ${row.brand}${row.creator ? ` — ${titleCase(row.creator)}` : ""}`;
      const doc = await dbInsert("documents", { creator: row.creator || null, name: docName, type: "brief", size: `${Math.max(1, Math.round(file.size / 1024))} Ko`, path, sort_order: 0 });
      const pdf = { name: file.name, path, docId: (doc as { id?: string } | null)?.id };
      if (!(await dbUpdate("briefs", row.id, { pdf }))) {
        await supabase.storage.from("documents").remove([path]).catch(() => {});
        return toast("Erreur — lance le SQL « briefs.pdf » ?");
      }
      patchRow(row.id, { pdf });
      if (row.creator) notifyCreator("brief", row.creator, `PDF joint au brief ${row.brand}`);
      toast("PDF joint ✓ — visible dans Documents et le portail créateur");
    } finally {
      setPdfBusy(null);
    }
  };

  const openPdf = async (row: Row) => {
    if (!row.pdf?.path) return;
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(row.pdf.path, 3600);
    if (error || !data?.signedUrl) return toast("Lien indisponible — réessaie");
    window.open(data.signedUrl, "_blank");
  };

  const removePdf = async (row: Row) => {
    const pdf = row.pdf;
    patchRow(row.id, { pdf: null });
    await dbUpdate("briefs", row.id, { pdf: null });
    if (pdf?.path) await supabase.storage.from("documents").remove([pdf.path]).catch(() => {});
    if (pdf?.docId) await supabase.from("documents").delete().eq("id", pdf.docId).then(() => {}, () => {});
    toast("PDF retiré");
  };

  const creatorOptions = [{ value: "", label: "—" }, ...creators.map((c) => ({ value: c.name, label: c.name }))];

  const ALL = "__all__";
  const filtered = (rows ?? []).filter((row) => {
    if (!matchQuery(query, row.brand, row.creator, row.deliverables, row.status)) return false;
    if (statusFilter !== ALL && colKey(row.status) !== statusFilter) return false;
    if (creatorFilter !== "" && (row.creator ?? "").toLowerCase() !== creatorFilter.toLowerCase()) return false;
    return true;
  });

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
            <AutoGrowTextField
              label="Script"
              value={editScript}
              onChange={setEditScript}
              placeholder="Le script à envoyer à la marque…"
              className="min-w-full"
            />
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
                { key: "pdf", label: "Script en PDF", icon: FileDown, onClick: () => printHtml(briefHTML(row)) },
                ...(row.pdf
                  ? [
                      { key: "pdfopen", label: "Ouvrir le PDF joint", icon: FileText, onClick: () => openPdf(row) },
                      { key: "pdfreplace", label: "Remplacer le PDF", icon: Paperclip, onClick: () => triggerAttach(row) },
                      { key: "pdfremove", label: "Retirer le PDF joint", icon: X, danger: true, onClick: () => removePdf(row) },
                    ]
                  : [{ key: "attach", label: pdfBusy === row.id ? "Envoi du PDF…" : "Joindre un PDF", icon: Paperclip, onClick: () => triggerAttach(row) }]),
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

        {row.pdf && (
          <button
            type="button"
            onClick={() => openPdf(row)}
            title="Ouvrir le PDF joint"
            className="mt-3 flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/[0.06] px-3 py-2 text-left text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
          >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{row.pdf.name}</span>
          </button>
        )}

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
    content = <div className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-sm">{query.trim() ? `Aucun résultat pour « ${query} »` : "Aucun brief pour ces filtres."}</div>;
  } else {
    content = <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map((r) => renderCard(r, false))}</div>;
  }

  return (
    <div>
      {/* Input caché pour joindre un PDF à un brief (cible = attachTargetRef) */}
      <input ref={pdfInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => onPdfPicked(e.target.files)} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">{rows === null ? "Chargement…" : `${rows.length} brief${rows.length > 1 ? "s" : ""}`}</div>
        <AddButton label="Brief" onClick={() => setFormOpen(true)} />
      </div>

      {/* Synthèse (bento) */}
      {rows !== null && rows.length > 0 && (() => {
        const cnt = (k: string) => rows.filter((r) => colKey(r.status) === k).length;
        const attente = cnt("attente"), valider = cnt("valider"), cours = cnt("cours"), termine = cnt("terminé");
        return (
          <StatsBento
            className="mb-5"
            primary={{ eyebrow: "Briefs terminés", value: String(termine), caption: `sur ${rows.length} brief${rows.length > 1 ? "s" : ""} au total.` }}
            bars={{ label: "Par statut", value: `${cours} en cours`, series: [attente, valider, cours, termine] }}
            small={{ value: String(attente), label: "En attente" }}
            accent={{ value: String(valider), label: "À valider", icon: Clock }}
          />
        );
      })()}

      {/* Panneau de filtres */}
      {rows !== null && rows.length > 0 && (() => {
        const activeCount = (statusFilter !== ALL ? 1 : 0) + (creatorFilter !== "" ? 1 : 0);
        const groups: FilterGroup[] = [
          {
            id: "statut",
            label: "Statut",
            value: statusFilter,
            onChange: setStatusFilter,
            options: [
              { value: ALL, label: "Tous", count: rows.length },
              ...STATUS_OPTS.map((s) => ({
                value: s.value,
                label: s.label,
                count: rows.filter((r) => colKey(r.status) === s.value).length,
              })),
            ],
          },
        ];
        return (
          <FilterPanel
            className="mb-4"
            activeCount={activeCount}
            groups={groups}
            onClear={() => { setStatusFilter(ALL); setCreatorFilter(""); }}
            right={
              <div className="flex items-center gap-1 rounded-full border border-border bg-surface p-1">
                {([
                  { id: "list", label: "Liste", icon: ListIcon },
                  { id: "board", label: "Colonnes", icon: Columns3 },
                ] as const).map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setView(v.id)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors",
                      view === v.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <v.icon className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{v.label}</span>
                  </button>
                ))}
              </div>
            }
            extra={creators.length > 0 ? (
              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">Créateur</span>
                <div className="flex items-center gap-2">
                  <UserRound className="h-4 w-4 shrink-0 text-faint" />
                  <select
                    value={creatorFilter}
                    onChange={(e) => setCreatorFilter(e.target.value)}
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-medium text-foreground outline-none focus:border-primary"
                  >
                    <option value="">Tous les créateurs</option>
                    {creators.map((c) => (
                      <option key={c.id} value={c.name}>{titleCase(c.name)}</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : undefined}
          />
        );
      })()}

      <InlineForm open={formOpen} title="Nouveau brief" onClose={() => setFormOpen(false)} onSubmit={submit}>
        <TextField label="Marque" value={brand} onChange={setBrand} />
        <SelectField label="Créateur" value={creator} onChange={setCreator} options={creatorOptions} />
        <TextField label="Livrables" value={deliverables} onChange={setDeliverables} placeholder="ex 3 posts · 1 reel" />
        <TextField label="Échéance" type="date" value={due} onChange={setDue} />
        <TextField label="Budget" value={budget} onChange={setBudget} />
        <TextField label="Objectif" value={objectif} onChange={setObjectif} />
        <SelectField label="Statut" value={status} onChange={setStatus} options={STATUS_OPTS.map((s) => ({ value: s.value, label: s.label }))} />
        <AutoGrowTextField
          label="Script"
          value={script}
          onChange={setScript}
          placeholder="Colle ici le script (écrit par toi ou la créatrice) — il devient le corps du PDF envoyé à la marque…"
          className="min-w-full"
        />
      </InlineForm>

      {content}
    </div>
  );
}
