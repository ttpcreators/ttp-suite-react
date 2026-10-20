import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Eye, FileDown, FileText, ListFilter, PenLine, Search, Send, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppState, type AppState } from "@/lib/appState";
import { useCreators } from "@/lib/useCreators";
import { printHtml } from "@/lib/printPdf";
import { myDisplayName } from "@/lib/team";
import { representationHTML } from "@/lib/representationContract";
import { toast } from "@/components/ui/toast";
import { AddMenuButton, Picker } from "@/components/ui/form";
import { ActionMenu } from "@/components/ui/action-menu";
import { PageHeaderRow } from "@/components/ui/page-header";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { MotionTabs, MotionTabsList, MotionTabsTrigger } from "@/components/ui/motion-tabs";
import { Overlay } from "@/components/mobile/ios-sheet";
import { ContractRelanceDialog } from "@/components/contracts/contract-relance";
import {
  CT_TYPES,
  STATUSES,
  STATUS_META,
  TYPE_META,
  buildCategories,
  buildRows,
  countByStatus,
  filterRows,
  fmtDate,
  plural,
  rowName,
  sortRows,
  type ContractRow,
  type ContractStatus,
  type CtType,
  type SortKey,
  type StatusTab,
} from "@/lib/contractRegistry";
import { deleteContractRow, setContractStatus } from "@/lib/contractRegistryDb";

/*
 * Page d'arrivée « Contrats » : tous les contrats enregistrés (Marque × Créateur, UGC,
 * Représentation), leur statut de signature, les catégories (= types de contrat) et
 * l'action utile sur chaque ligne. Les générateurs s'ouvrent via « Nouveau contrat »
 * et « Modifier » (callbacks de la page Contrats).
 */

type Raw = Record<string, unknown>;
type Hist = { brand: unknown; repr: unknown };

const rowKey = (r: Pick<ContractRow, "key" | "id">) => `${r.key}:${r.id}`;

const outlineBtn =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border border-border bg-surface px-4 text-[12.5px] font-medium text-foreground transition-colors hover:bg-rowhover";
const primaryBtn =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90";

const TAB_LABEL: Record<StatusTab, string> = { all: "Tous", signed: "Signés", pending: "Action requise", changes: "Modifs demandées" };
const SORT_OPTS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "Plus récents" },
  { value: "name", label: "Nom A→Z" },
];

export function ContractsHome({
  active = true,
  onNew,
  onEdit,
  resume,
}: {
  /** Page affichée (sinon gardée montée et masquée : recherche, onglet et filtres restent). */
  active?: boolean;
  onNew: (type: CtType) => void;
  onEdit: (row: ContractRow, raw: Raw) => void;
  /** Un générateur a été ouvert pendant la session : on peut y revenir sans perdre la saisie. */
  resume?: { label: string; onClick: () => void } | null;
}) {
  const creators = useCreators();
  const { data, loading } = useAppState<Hist>((s: AppState) => ({ brand: s["brandContractHistory"], repr: s["contractHistory"] }));
  // Écritures réussies appliquées tout de suite ; le blob live redevient la source dès qu'il change.
  const [statusOver, setStatusOver] = useState<Record<string, ContractStatus>>({});
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setStatusOver({});
    setRemoved(new Set());
  }, [data]);

  const rawById = useMemo(() => {
    const m = new Map<string, Raw>();
    const put = (key: string, list: unknown) => {
      for (const e of Array.isArray(list) ? list : []) if (e && typeof e === "object" && typeof (e as Raw).id === "string") m.set(`${key}:${(e as Raw).id}`, e as Raw);
    };
    put("brandContractHistory", data?.brand);
    put("contractHistory", data?.repr);
    return m;
  }, [data]);

  const rows = useMemo(
    () => buildRows(data?.brand, data?.repr).filter((r) => !removed.has(rowKey(r))).map((r) => (statusOver[rowKey(r)] ? { ...r, status: statusOver[rowKey(r)] } : r)),
    [data, removed, statusOver],
  );

  const [tab, setTab] = useState<StatusTab>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [fCreator, setFCreator] = useState("");
  const [fType, setFType] = useState<"" | CtType>("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [preview, setPreview] = useState<{ title: string; html: string } | null>(null);
  const [relance, setRelance] = useState<ContractRow | null>(null);
  const [myName, setMyName] = useState("");
  useEffect(() => {
    let alive = true;
    void myDisplayName().then((n) => alive && setMyName(n === "Agence" ? "" : n));
    return () => {
      alive = false;
    };
  }, []);

  const counts = countByStatus(rows);
  const visible = sortRows(filterRows(rows, { tab, q, creator: fCreator, type: fType }), sort);
  const categories = buildCategories(rows);
  const photoOf = (name: string) => creators.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase())?.photo_url ?? null;
  const activeFilters = (fCreator ? 1 : 0) + (fType ? 1 : 0);
  const creatorOpts = useMemo(() => {
    const names: string[] = [];
    for (const r of rows) {
      const n = r.creator ?? r.creatorLabel;
      if (n && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
    }
    return names.sort((a, b) => a.localeCompare(b, "fr"));
  }, [rows]);

  const htmlOf = (r: ContractRow): string | null => {
    const raw = rawById.get(rowKey(r));
    if (!raw) return null;
    if (r.key === "brandContractHistory") return typeof raw.html === "string" ? raw.html : null;
    return raw.config && typeof raw.config === "object" ? representationHTML(raw.config as Record<string, string>) : null;
  };
  const view = (r: ContractRow) => {
    const html = htmlOf(r);
    if (html) setPreview({ title: rowName(r), html });
    else toast("Contrat introuvable, actualise la page");
  };
  const pdf = (r: ContractRow) => {
    const html = htmlOf(r);
    if (html) printHtml(html);
  };
  const edit = (r: ContractRow) => {
    const raw = rawById.get(rowKey(r));
    if (raw) onEdit(r, raw);
  };
  const changeStatus = async (r: ContractRow, status: ContractStatus) => {
    if (status === r.status) return;
    const k = rowKey(r);
    setStatusOver((o) => ({ ...o, [k]: status }));
    if (await setContractStatus(r.key, r.id, status)) return toast(`${rowName(r)} : ${STATUS_META[status].label.toLowerCase()} ✓`);
    setStatusOver((o) => {
      const next = { ...o };
      delete next[k];
      return next;
    });
    toast("Statut non enregistré, réessaie");
  };
  const remove = async (r: ContractRow) => {
    const res = await deleteContractRow(r);
    if (res === "error") return toast("Erreur, réessaie");
    setRemoved((s) => new Set(s).add(rowKey(r)));
    toast(res === "partial" ? "Contrat retiré, mais toujours visible dans Documents. Supprime-le là-bas" : "Contrat supprimé");
  };

  const pending = counts.pending;

  return (
    <>
      {active && (
        <PageHeaderRow>
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
            <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-border bg-surface px-3.5 transition-shadow focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 sm:w-64 sm:flex-none">
              <Search className="h-4 w-4 shrink-0 text-faint" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" aria-label="Rechercher un contrat (marque, créateur, référence)" className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-faint" />
              {q && (
                <button type="button" onClick={() => setQ("")} aria-label="Effacer la recherche" className="grid h-5 w-5 place-items-center rounded-full text-faint hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
            <AddMenuButton
              label="Nouveau contrat"
              items={CT_TYPES.map((t) => ({ key: t, label: TYPE_META[t].label, hint: TYPE_META[t].hint, icon: FileText, onClick: () => onNew(t) }))}
            />
          </div>
        </PageHeaderRow>
      )}

      {resume && (
        <button type="button" onClick={resume.onClick} className="mb-3 flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground">
          <PenLine className="h-3.5 w-3.5" /> Reprendre le contrat en cours ({resume.label})
        </button>
      )}

      {/* Bandeau d'accueil : ce qui attend une signature */}
      {pending > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 sm:px-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-wait-soft text-[13px] font-semibold text-wait">{pending}</span>
          <p className="min-w-0 flex-1 text-[14px] text-foreground">
            {myName && <span className="font-semibold">Re, {myName} ! </span>}
            <span className={myName ? "text-muted-foreground" : undefined}>{pending > 1 ? `${pending} contrats attendent une signature.` : "1 contrat attend une signature."}</span>
          </p>
          {tab !== "pending" && (
            <button type="button" onClick={() => setTab("pending")} className="text-[13px] font-medium text-primary underline-offset-4 hover:underline">
              Voir
            </button>
          )}
        </div>
      )}

      {/* Onglets de statut (soulignés) */}
      <div className="relative">
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-border" />
        <MotionTabs variant="underline" value={tab} onValueChange={(v) => setTab(v as StatusTab)}>
          <MotionTabsList aria-label="Statut des contrats">
            {(["all", "signed", "pending", "changes"] as StatusTab[]).map((t) => (
              <MotionTabsTrigger key={t} value={t} indicatorClassName="h-0.5">
                {TAB_LABEL[t]}
                {t === "pending" && pending > 0 && <span className="ml-1.5 rounded-full bg-danger/10 px-1.5 py-px text-[11px] font-semibold tabular-nums text-dangertext">{pending}</span>}
              </MotionTabsTrigger>
            ))}
          </MotionTabsList>
        </MotionTabs>
      </div>

      {/* ── Catégories ── */}
      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-[16px] font-semibold text-foreground">Catégories</h2>
          <button type="button" onClick={() => setFilterOpen((o) => !o)} aria-expanded={filterOpen} className={cn(outlineBtn, "h-8 px-3", activeFilters > 0 && "border-foreground")}>
            <ListFilter className="h-3.5 w-3.5" /> Filtrer
            {activeFilters > 0 && <span className="rounded-full bg-foreground px-1.5 text-[11px] font-semibold tabular-nums text-background">{activeFilters}</span>}
          </button>
        </div>
        {filterOpen && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface p-3">
            <Picker
              size="sm"
              className="w-full sm:w-56"
              ariaLabel="Filtrer par créateur"
              value={fCreator}
              onChange={setFCreator}
              options={[{ value: "", label: "Tous les créateurs" }, ...creatorOpts.map((n) => ({ value: n, label: rows.find((r) => (r.creator ?? r.creatorLabel) === n)?.creatorLabel ?? n, img: photoOf(n) }))]}
            />
            <Picker
              size="sm"
              className="w-full sm:w-56"
              ariaLabel="Filtrer par type"
              value={fType}
              onChange={(v) => setFType(v as "" | CtType)}
              options={[{ value: "", label: "Tous les types" }, ...CT_TYPES.map((t) => ({ value: t, label: TYPE_META[t].label }))]}
            />
            {activeFilters > 0 && (
              <button type="button" onClick={() => { setFCreator(""); setFType(""); }} className="px-2 text-[12.5px] font-medium text-muted-foreground hover:text-foreground">
                Tout effacer
              </button>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 gap-2 rounded-2xl bg-panel p-2 sm:grid-cols-3 sm:gap-3 sm:p-3">
          {categories.map((c) => {
            const on = fType === c.type;
            const shown = c.creators.slice(0, 3);
            return (
              <div
                key={c.type}
                role="button"
                tabIndex={0}
                aria-pressed={on}
                onClick={() => setFType(on ? "" : c.type)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setFType(on ? "" : c.type);
                  }
                }}
                className={cn(
                  "flex min-w-0 cursor-pointer flex-col rounded-2xl border bg-card p-4 text-left transition-colors hover:border-foreground/30 sm:p-5",
                  on ? "border-foreground" : "border-border",
                )}
              >
                <div className="flex items-start gap-2.5">
                  <span className={cn("mt-2 h-2.5 w-2.5 shrink-0 rounded-full", TYPE_META[c.type].dot)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[18px] font-semibold leading-snug text-foreground">{TYPE_META[c.type].label}</div>
                    <div className="mt-1 text-[13px] text-muted-foreground">{c.count ? plural(c.count, "document", "documents") : "Aucun document"}</div>
                  </div>
                  <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <ActionMenu
                      buttonClassName="h-8 w-8"
                      items={[
                        { key: "new", label: `Nouveau contrat ${TYPE_META[c.type].label}`, icon: FileText, onClick: () => onNew(c.type) },
                        { key: "only", label: on ? "Voir tous les types" : "Voir seulement ce type", icon: ListFilter, onClick: () => setFType(on ? "" : c.type) },
                      ]}
                    />
                  </div>
                </div>
                <div className="mt-5 flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px] text-muted-foreground">
                  {c.creators.length > 0 ? (
                    <>
                      <span>Partagé avec</span>
                      <span className="flex -space-x-1.5">
                        {shown.map((n) => (
                          <CreatorAvatar key={n} name={n} photoUrl={photoOf(n)} className="h-7 w-7 rounded-full border-2 border-card text-[10px]" />
                        ))}
                        {c.creators.length > shown.length && (
                          <span className="grid h-7 min-w-7 place-items-center rounded-full border-2 border-card bg-muted px-1 text-[10px] font-semibold text-muted-foreground">+{c.creators.length - shown.length}</span>
                        )}
                      </span>
                      {c.brands.length > 0 && <span className="text-foreground">+{plural(c.brands.length, "marque", "marques")}</span>}
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNew(c.type);
                      }}
                      className="font-medium text-primary hover:underline"
                    >
                      Créer le premier
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Tes contrats ── */}
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-[16px] font-semibold text-foreground">Tes contrats</h2>
          <span className="text-[12.5px] tabular-nums text-muted-foreground">{visible.length}</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[12.5px] text-muted-foreground max-sm:hidden">Trier par</span>
            <Picker size="sm" className="w-40" ariaLabel="Trier par" value={sort} onChange={(v) => setSort(v as SortKey)} options={SORT_OPTS} />
          </div>
        </div>
        <div className="space-y-2 rounded-2xl bg-panel p-2 sm:p-3">
          {loading && !data ? (
            <div className="rounded-xl border border-border bg-card px-5 py-10 text-center text-[13px] text-faint">Chargement des contrats…</div>
          ) : visible.length === 0 ? (
            <div className="rounded-xl border border-border bg-card px-5 py-10 text-center text-[13px] text-muted-foreground">
              {rows.length === 0 ? "Aucun contrat enregistré pour l'instant. Crée le premier avec « Nouveau contrat »." : "Aucun contrat ne correspond à ces critères."}
            </div>
          ) : (
            visible.map((r) => (
              <ContractLine
                key={rowKey(r)}
                row={r}
                onView={() => view(r)}
                onPdf={() => pdf(r)}
                onEdit={() => edit(r)}
                onRelance={() => setRelance(r)}
                onStatus={(s) => void changeStatus(r, s)}
                onDelete={() => void remove(r)}
              />
            ))
          )}
        </div>
      </section>

      {preview && (
        <Overlay className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:p-6" onClose={() => setPreview(null)} label={preview.title}>
          <div className="my-2 w-full max-w-3xl rounded-2xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
              <div className="truncate text-sm font-semibold text-foreground">{preview.title}</div>
              <button type="button" onClick={() => setPreview(null)} aria-label="Fermer" className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4">
              <iframe title={preview.title} srcDoc={preview.html} sandbox="allow-same-origin" className="h-[70vh] w-full rounded-lg border border-border bg-white" />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
              <button type="button" className={outlineBtn} onClick={() => setPreview(null)}>Fermer</button>
              <button type="button" className={primaryBtn} onClick={() => printHtml(preview.html)}>
                <FileDown className="h-3.5 w-3.5" /> Enregistrer en PDF
              </button>
            </div>
          </div>
        </Overlay>
      )}
      {relance && <ContractRelanceDialog row={relance} onClose={() => setRelance(null)} />}
    </>
  );
}

/** Une ligne « Tes contrats » : empilée sur téléphone, en colonnes dès md. */
function ContractLine({
  row,
  onView,
  onPdf,
  onEdit,
  onRelance,
  onStatus,
  onDelete,
}: {
  row: ContractRow;
  onView: () => void;
  onPdf: () => void;
  onEdit: () => void;
  onRelance: () => void;
  onStatus: (s: ContractStatus) => void;
  onDelete: () => void;
}) {
  const main =
    row.status === "pending" ? (
      <button type="button" onClick={onRelance} className={primaryBtn}>
        <Send className="h-3.5 w-3.5" /> Relancer
      </button>
    ) : row.status === "changes" ? (
      <button type="button" onClick={onEdit} className={outlineBtn}>
        <PenLine className="h-3.5 w-3.5" /> Modifier
      </button>
    ) : (
      <button type="button" onClick={onView} className={outlineBtn}>
        <Eye className="h-3.5 w-3.5" /> Voir
      </button>
    );
  return (
    <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card px-4 py-3.5 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] md:items-center md:gap-4 md:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-surface text-foreground">
          <FileText className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-foreground">{rowName(row)}</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TYPE_META[row.type].dot)} />
            <span className="truncate tabular-nums">{[TYPE_META[row.type].label, row.ref].filter(Boolean).join(" · ")}</span>
          </div>
        </div>
      </div>
      {/* Téléphone : les trois infos côte à côte sous le titre */}
      <div className="grid grid-cols-3 gap-3 md:contents">
        <Cell label="Créé le">
          <span className="text-[13px] font-medium tabular-nums text-foreground">{fmtDate(row.ts)}</span>
        </Cell>
        <Cell label="Créateur">
          <span className="block truncate text-[12px] font-semibold uppercase tracking-[0.04em] text-foreground">{row.creatorLabel}</span>
        </Cell>
        <Cell label="Statut">
          <StatusButton value={row.status} onChange={onStatus} />
        </Cell>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        {main}
        <ActionMenu
          items={[
            ...(row.status !== "signed" ? [{ key: "view", label: "Voir", icon: Eye, onClick: onView }] : []),
            ...(row.status !== "changes" ? [{ key: "edit", label: "Modifier", icon: PenLine, onClick: onEdit }] : []),
            ...(row.status !== "pending" ? [{ key: "relance", label: "Relancer", icon: Send, onClick: onRelance }] : []),
            { key: "pdf", label: "Enregistrer en PDF", icon: FileDown, onClick: onPdf },
            {
              key: "del",
              label: "Supprimer",
              icon: Trash2,
              danger: true,
              onClick: onDelete,
              confirm: {
                title: "Supprimer définitivement",
                message: `Retirer « ${rowName(row)} » des contrats enregistrés ?${row.type === "repr" && row.creator ? " Il sera aussi retiré de l'espace du créateur." : ""} Cette action est irréversible.`,
                confirmLabel: "Supprimer définitivement",
              },
            },
          ]}
        />
      </div>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-0.5 text-[11.5px] text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

/** Statut cliquable : pastille de couleur + libellé, petit menu pour le changer. */
function StatusButton({ value, onChange }: { value: ContractStatus; onChange: (s: ContractStatus) => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const meta = STATUS_META[value];
  const W = 200;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const up = !!rect && vh - rect.bottom < 150;
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={!!rect}
        title="Changer le statut"
        onClick={() => setRect(rect ? null : (btn.current?.getBoundingClientRect() ?? null))}
        className={cn("-mx-1.5 flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[13px] font-semibold transition-colors hover:bg-rowhover", meta.text)}
      >
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta.dot)} />
        <span className="truncate">{meta.label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
      </button>
      {rect &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[70]" onClick={() => setRect(null)} />
            <div
              role="menu"
              className="fixed z-[71] rounded-xl border border-border bg-surface p-1 shadow-xl"
              style={{ ...(up ? { bottom: vh - rect.top + 6 } : { top: rect.bottom + 6 }), left: Math.min(Math.max(8, rect.left), vw - W - 8), width: W }}
            >
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setRect(null);
                    onChange(s);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-rowhover"
                >
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_META[s].dot)} />
                  <span className="flex-1">{s === "pending" ? "En attente de signature" : STATUS_META[s].label}</span>
                  {s === value && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
