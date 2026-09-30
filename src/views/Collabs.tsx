import { supabase } from "@/lib/supabase";
import { useSearch, matchQuery } from "@/lib/search";
import { cn, titleCase } from "@/lib/utils";
import {
  ArrowRight, Pencil, Trash2, X, UserRound, Package, Wallet, Clock, Trophy,
  XCircle, Archive, CircleDot, Check, ListChecks, ChevronDown, RotateCcw, StickyNote,
} from "lucide-react";
import { FilterPanel, type FilterGroup } from "@/components/ui/filter-panel";
import { StatsBento } from "@/components/ui/stats-bento";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { useEffect, useState, type ReactElement } from "react";
import { dbInsert, dbUpdate, nextOrder } from "@/lib/db";
import { dbTrash } from "@/lib/trash";
import { toast } from "@/components/ui/toast";
import { AddButton, InlineForm, TextField, AutoGrowTextField, SelectField } from "@/components/ui/form";
import { ActionMenu } from "@/components/ui/action-menu";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { useCreators } from "@/lib/useCreators";
import { useLiveKey } from "@/lib/useLive";
import { frDate } from "@/lib/dates";
import { getCache, setCache } from "@/lib/viewCache";
import { STEPS, STEP_COUNT, PHASES, stepDef, phaseOf, isDone, type PhaseKey } from "@/lib/collabs";
import { PageHeaderRow } from "@/components/ui/page-header";

type Row = {
  id: string;
  brand: string;
  creator: string | null;
  contact: string | null;
  title: string | null;
  deliverables: string | null;
  cachet: string | null;
  step: number;
  status: string;
  note: string | null;
  sort_order: number;
  updated_at?: string | null;
};
type StepRow = { collab_id: string; step: number; reached_at: string };

const STATUS_OPTS = [
  { value: "active", label: "En cours", dot: "bg-cyan" },
  { value: "gagnee", label: "Gagnée", dot: "bg-signal" },
  { value: "perdue", label: "Perdue", dot: "bg-rose-500" },
  { value: "archivee", label: "Archivée", dot: "bg-muted-foreground" },
];
/** Une collab stagne si elle est restée trop longtemps sur l'étape courante. */
const STALE_DAYS = 7;

/** Couleur de pastille de la phase (mêmes tokens que le reste de l'app). */
const PHASE_DOT: Record<PhaseKey, string> = {
  negociation: "bg-primary",
  production: "bg-cyan",
  mesure: "bg-indigo",
  facturation: "bg-amber",
  cloture: "bg-signal",
};

function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

export function Collabs() {
  const [rows, setRows] = useState<Row[] | null>(() => getCache<Row[]>("collabs"));
  const [steps, setSteps] = useState<Record<string, StepRow[]>>({});
  const [missing, setMissing] = useState(false); // table pas encore créée (migration à lancer)
  const [error, setError] = useState(false);
  const { query } = useSearch();
  const creators = useCreators();
  const live = useLiveKey();

  const [phaseFilter, setPhaseFilter] = useState<string>("__all__");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [creatorFilter, setCreatorFilter] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // formulaire de création
  const [formOpen, setFormOpen] = useState(false);
  const [brand, setBrand] = useState("");
  const [creator, setCreator] = useState("");
  const [contact, setContact] = useState("");
  const [title, setTitle] = useState("");
  const [deliverables, setDeliverables] = useState("");
  const [cachet, setCachet] = useState("");
  const [note, setNote] = useState("");

  // édition
  const [editId, setEditId] = useState<string | null>(null);
  const [eBrand, setEBrand] = useState("");
  const [eContact, setEContact] = useState("");
  const [eTitle, setETitle] = useState("");
  const [eDeliverables, setEDeliverables] = useState("");
  const [eCachet, setECachet] = useState("");
  const [eCreator, setECreator] = useState("");
  const [eNote, setENote] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await supabase
        .from("collabs")
        .select("id, brand, creator, contact, title, deliverables, cachet, step, status, note, sort_order, updated_at")
        .order("sort_order");
      if (!active) return;
      if (res.error) {
        // 42P01 = table inexistante → la migration n'a pas encore été appliquée.
        if (res.error.code === "42P01" || /does not exist/i.test(res.error.message)) setMissing(true);
        else setError(true);
        setRows([]);
        return;
      }
      const list = (res.data as Row[]) ?? [];
      setCache("collabs", list);
      setRows(list);
      // historique daté des étapes (best-effort ; sert aux dates + à la détection de stagnation)
      const st = await supabase.from("collab_steps").select("collab_id, step, reached_at").order("reached_at");
      if (!active) return;
      if (!st.error && st.data) {
        const map: Record<string, StepRow[]> = {};
        for (const s of st.data as StepRow[]) (map[s.collab_id] ??= []).push(s);
        setSteps(map);
      }
    })();
    return () => {
      active = false;
    };
  }, [live]);

  const photoOf = (name?: string | null) =>
    name ? creators.find((c) => c.name.toLowerCase() === name.toLowerCase())?.photo_url ?? null : null;

  /** Date à laquelle l'étape courante d'une collab a été atteinte (pour « depuis X j »). */
  const reachedAt = (row: Row): string | null => {
    const list = steps[row.id];
    if (list && list.length) {
      const hit = [...list].reverse().find((s) => s.step === row.step);
      if (hit) return hit.reached_at;
    }
    return row.updated_at ?? null;
  };
  const staleDays = (row: Row): number | null => {
    if (isDone(row.step) || row.status !== "active") return null;
    const d = daysSince(reachedAt(row));
    return d !== null && d >= STALE_DAYS ? d : null;
  };

  const resetForm = () => {
    setBrand(""); setCreator(""); setContact(""); setTitle(""); setDeliverables(""); setCachet(""); setNote("");
  };

  const submit = async () => {
    if (!brand.trim()) return toast("Renseigne la marque");
    const row = {
      brand: brand.trim(), creator: creator || null, contact: contact.trim() || null,
      title: title.trim() || null, deliverables: deliverables.trim() || null,
      cachet: cachet.trim() || null, note: note.trim() || null,
      step: 1, status: "active", sort_order: nextOrder(rows ?? []),
    };
    const created = await dbInsert("collabs", row);
    if (!created) return toast("Erreur — la migration collabs est-elle lancée ?");
    setRows([created as unknown as Row, ...(rows ?? [])]);
    toast("Collab créée ✓");
    setFormOpen(false);
    resetForm();
  };

  const startEdit = (row: Row) => {
    setEditId(row.id);
    setEBrand(row.brand);
    setEContact(row.contact ?? "");
    setETitle(row.title ?? "");
    setEDeliverables(row.deliverables ?? "");
    setECachet(row.cachet ?? "");
    setECreator(row.creator ?? "");
    setENote(row.note ?? "");
  };
  const saveEdit = async (id: string) => {
    if (!eBrand.trim()) return toast("Renseigne la marque");
    const patch = {
      brand: eBrand.trim(), contact: eContact.trim() || null, title: eTitle.trim() || null,
      deliverables: eDeliverables.trim() || null, cachet: eCachet.trim() || null,
      creator: eCreator || null, note: eNote.trim() || null,
    };
    if (!(await dbUpdate("collabs", id, patch))) return toast("Erreur — réessaie");
    setRows((rows ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
    toast("Collab mise à jour ✓");
    setEditId(null);
  };

  // Faire avancer / positionner l'étape (le trigger côté base date le changement).
  const setStep = async (row: Row, next: number) => {
    const clamped = Math.min(STEP_COUNT, Math.max(1, next));
    if (clamped === row.step) return;
    const prev = row.step;
    setRows((rs) => (rs ?? []).map((r) => (r.id === row.id ? { ...r, step: clamped } : r)));
    if (!(await dbUpdate("collabs", row.id, { step: clamped }))) {
      setRows((rs) => (rs ?? []).map((r) => (r.id === row.id ? { ...r, step: prev } : r)));
      return toast("Erreur — réessaie");
    }
    // Reflète le changement dans l'historique local (pour les dates, sans re-fetch).
    setSteps((m) => ({ ...m, [row.id]: [...(m[row.id] ?? []), { collab_id: row.id, step: clamped, reached_at: new Date().toISOString() }] }));
    if (clamped > prev) toast(`Étape ${clamped} · ${stepDef(clamped).short} ✓`);
  };

  const setStatus = async (row: Row, status: string) => {
    const prev = row.status;
    setRows((rs) => (rs ?? []).map((r) => (r.id === row.id ? { ...r, status } : r)));
    if (!(await dbUpdate("collabs", row.id, { status }))) {
      setRows((rs) => (rs ?? []).map((r) => (r.id === row.id ? { ...r, status: prev } : r)));
      toast("Erreur — réessaie");
    }
  };

  const del = async (row: Row) => {
    if (await dbTrash("collabs", row.id, row.brand, row.creator || undefined)) {
      setRows((rows ?? []).filter((r) => r.id !== row.id));
      toast("Déplacée dans la corbeille");
    } else toast("Erreur, réessaie");
  };

  const toggleExpand = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const creatorOptions = [{ value: "", label: "—" }, ...creators.map((c) => ({ value: c.name, label: c.name, img: c.photo_url }))];

  const ALL = "__all__";
  // Tous les filtres, sauf éventuellement une facette (pour compter ses pastilles sur les autres filtres).
  const matchesExcept = (row: Row, skip: "phase" | "statut" | null): boolean => {
    if (!matchQuery(query, row.brand, row.creator ?? "", row.title ?? "", row.contact ?? "")) return false;
    if (skip !== "statut" && statusFilter !== ALL && row.status !== statusFilter) return false;
    if (skip !== "phase" && phaseFilter !== ALL && phaseOf(row.step) !== phaseFilter) return false;
    if (creatorFilter !== "" && (row.creator ?? "").toLowerCase() !== creatorFilter.toLowerCase()) return false;
    return true;
  };
  const filtered = (rows ?? []).filter((row) => matchesExcept(row, null));

  // ── carte d'une collab ──
  const renderCard = (row: Row): ReactElement => {
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
            <TextField label="Marque" value={eBrand} onChange={setEBrand} />
            <TextField label="Libellé de la collab" value={eTitle} onChange={setETitle} placeholder="ex Campagne été" />
            <TextField label="Contact marque" value={eContact} onChange={setEContact} />
            <TextField label="Livrables" value={eDeliverables} onChange={setEDeliverables} placeholder="ex 3 posts · 1 reel" />
            <TextField label="Cachet" value={eCachet} onChange={setECachet} />
            <SelectField label="Créatrice" value={eCreator} onChange={setECreator} options={creatorOptions} />
            <AutoGrowTextField label="Note" value={eNote} onChange={setENote} placeholder="Contexte, angle, points d'attention…" />
            <button
              type="button"
              onClick={() => saveEdit(row.id)}
              className="h-[42px] shrink-0 rounded-lg bg-primary px-5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Enregistrer
            </button>
          </div>
        </div>
      );
    }

    const def = stepDef(row.step);
    const done = isDone(row.step);
    const stale = staleDays(row);
    const reached = reachedAt(row);
    const isOpen = expanded.has(row.id);
    const stepHits = steps[row.id] ?? [];
    const dateForStep = (n: number): string | null => {
      const hit = [...stepHits].reverse().find((s) => s.step === n);
      return hit ? hit.reached_at : null;
    };

    const statusMeta =
      row.status === "gagnee" ? { variant: "success" as const, label: "Gagnée" }
      : row.status === "perdue" ? { variant: "danger" as const, label: "Perdue" }
      : row.status === "archivee" ? { variant: "neutral" as const, label: "Archivée" }
      : done ? { variant: "success" as const, label: "Bouclée" }
      : { variant: "info" as const, label: "En cours" };

    return (
      <div key={row.id} className="flex flex-col rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-rowhover">
        {/* En-tête : marque + menu */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold tracking-tight text-foreground">{row.brand}</h2>
            {row.title && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{row.title}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <AnimatedBadge status={statusMeta.variant} size="sm">{statusMeta.label}</AnimatedBadge>
            <ActionMenu
              items={[
                { key: "edit", label: "Modifier", icon: Pencil, onClick: () => startEdit(row) },
                ...(row.status !== "active" ? [{ key: "reopen", label: "Remettre en cours", icon: RotateCcw, onClick: () => setStatus(row, "active") }] : []),
                { key: "won", label: "Marquer gagnée", icon: Trophy, onClick: () => setStatus(row, "gagnee") },
                { key: "lost", label: "Marquer perdue", icon: XCircle, onClick: () => setStatus(row, "perdue") },
                { key: "archive", label: "Archiver", icon: Archive, onClick: () => setStatus(row, "archivee") },
                { key: "delete", label: "Mettre à la corbeille", icon: Trash2, danger: true, onClick: () => del(row), confirm: { title: "Mettre à la corbeille", message: `Déplacer la collab « ${row.brand} » vers la corbeille ? Tu pourras la restaurer.`, confirmLabel: "Mettre à la corbeille" } },
              ]}
            />
          </div>
        </div>

        {/* Créatrice + contact */}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {row.creator ? (
            <span className="flex items-center gap-1.5">
              <CreatorAvatar name={row.creator} photoUrl={photoOf(row.creator)} className="h-5 w-5 rounded-full text-[9px]" />
              {titleCase(row.creator)}
            </span>
          ) : (
            <span className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5 text-faint" /> Aucune créatrice</span>
          )}
          {row.contact && <span className="truncate">Contact · {row.contact}</span>}
        </div>

        {/* Étape courante */}
        <div className="mt-3 rounded-xl bg-panel px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
              <span className={cn("size-2 rounded-full", PHASE_DOT[def.phase])} />
              Étape {row.step} / {STEP_COUNT}
            </div>
            {stale !== null && (
              <span className="flex items-center gap-1 rounded-full bg-amber/15 px-2 py-0.5 text-[9px] font-semibold text-amber">
                <Clock className="h-3 w-3" /> {stale} j à cette étape
              </span>
            )}
          </div>
          <div className="mt-1 text-[13px] font-semibold text-foreground">{def.label}</div>
          {/* progression segmentée (11 segments, remplis jusqu'à l'étape courante) */}
          <div className="mt-2 flex gap-1">
            {STEPS.map((s) => (
              <button
                key={s.n}
                type="button"
                title={`${s.n}. ${s.label}`}
                onClick={() => setStep(row, s.n)}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  s.n <= row.step ? PHASE_DOT[s.phase] : "bg-border hover:bg-muted-foreground/40",
                )}
              />
            ))}
          </div>
          {reached && (
            <div className="mt-1.5 text-[10px] text-faint">Depuis le {frDate(reached)}</div>
          )}
        </div>

        {/* Note de création */}
        {row.note && (
          <div className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-faint" />
            <span className="line-clamp-2 whitespace-pre-line">{row.note}</span>
          </div>
        )}

        {/* Livrables + cachet */}
        {(row.deliverables || row.cachet) && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-panel px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Package className="h-3 w-3" /> Livrables
              </div>
              <div className="mt-1 truncate text-[12px] font-medium text-foreground">{row.deliverables || "—"}</div>
            </div>
            <div className="rounded-xl bg-panel px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Wallet className="h-3 w-3" /> Cachet
              </div>
              <div className="mt-1 truncate text-[12px] font-medium text-foreground">{row.cachet || "—"}</div>
            </div>
          </div>
        )}

        {/* Action : faire avancer d'une étape */}
        <div className="mt-3 flex items-center gap-2">
          {done ? (
            <div className="flex h-[38px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-signal/30 bg-signal/[0.08] text-[11px] font-semibold text-signal">
              <Check className="h-3.5 w-3.5" /> Collab bouclée
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setStep(row, row.step + 1)}
              className="flex h-[38px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              {stepDef(row.step + 1).short} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => toggleExpand(row.id)}
            className="flex h-[38px] items-center gap-1 rounded-lg border border-border px-3 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
            title="Voir toutes les étapes"
          >
            <ListChecks className="h-3.5 w-3.5" />
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} />
          </button>
        </div>

        {/* Historique détaillé des 11 étapes (dates) */}
        {isOpen && (
          <ol className="mt-3 flex flex-col gap-0.5 border-t border-border pt-3">
            {STEPS.map((s) => {
              const reachedStep = s.n < row.step;
              const current = s.n === row.step;
              const d = dateForStep(s.n);
              return (
                <li key={s.n}>
                  <button
                    type="button"
                    onClick={() => setStep(row, s.n)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] transition-colors hover:bg-rowhover",
                      current ? "font-semibold text-foreground" : reachedStep ? "text-muted-foreground" : "text-faint",
                    )}
                  >
                    {reachedStep ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-signal" />
                    ) : current ? (
                      <CircleDot className="h-3.5 w-3.5 shrink-0 text-primary" />
                    ) : (
                      <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-border" />
                    )}
                    <span className="flex-1 truncate">{s.n}. {s.label}</span>
                    {d && <span className="shrink-0 tabular-nums text-faint">{frDate(d)}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    );
  };

  // ── contenu ──
  let content: ReactElement;
  if (rows === null) {
    content = (
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <AnimatedBadge status="loading" size="sm">Chargement…</AnimatedBadge>
      </div>
    );
  } else if (missing) {
    content = (
      <div className="rounded-xl border border-dashed border-primary/30 bg-primary/[0.04] px-4 py-8 text-center text-sm text-muted-foreground shadow-sm">
        La table des collabs n'est pas encore active.
        <br />
        Lance la migration <span className="font-mono text-[12px] text-foreground">2026-09-27-collabs.sql</span> dans le SQL Editor, puis recharge.
      </div>
    );
  } else if (error) {
    content = <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">Erreur de chargement.</div>;
  } else if (rows.length === 0) {
    content = <div className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-sm">Aucune collab pour le moment. Crée la première ✍️</div>;
  } else if (filtered.length === 0) {
    content = <div className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-sm">{query.trim() ? `Aucun résultat pour « ${query} »` : "Aucune collab pour ces filtres."}</div>;
  } else {
    content = <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map((r) => renderCard(r))}</div>;
  }

  const activeRows = (rows ?? []).filter((r) => r.status === "active");

  return (
    <div>
      <PageHeaderRow>
        <div className="text-sm text-muted-foreground">
          {rows === null ? "Chargement…" : `${rows.length} collab${rows.length > 1 ? "s" : ""}`}
        </div>
        <AddButton label="Collab" onClick={() => setFormOpen(true)} />
      </PageHeaderRow>

      {/* Synthèse (bento) */}
      {rows !== null && rows.length > 0 && (() => {
        const byPhase = PHASES.map((p) => activeRows.filter((r) => phaseOf(r.step) === p.key).length);
        const staleCount = activeRows.filter((r) => staleDays(r) !== null).length;
        const won = (rows ?? []).filter((r) => r.status === "gagnee" || (r.status === "active" && isDone(r.step))).length;
        const prod = activeRows.filter((r) => phaseOf(r.step) === "production").length;
        return (
          <StatsBento
            className="mb-5"
            primary={{ eyebrow: "Collabs en cours", value: String(activeRows.length), caption: `sur ${rows.length} collab${rows.length > 1 ? "s" : ""} au total.` }}
            bars={{ label: "Par phase", value: `${prod} en production`, series: byPhase }}
            small={{ value: String(staleCount), label: `À relancer (> ${STALE_DAYS} j)` }}
            accent={{ value: String(won), label: "Bouclées / gagnées", icon: Trophy }}
          />
        );
      })()}

      {/* Filtres */}
      {rows !== null && rows.length > 0 && (() => {
        const activeCount = (phaseFilter !== ALL ? 1 : 0) + (statusFilter !== "active" ? 1 : 0) + (creatorFilter !== "" ? 1 : 0);
        // Compteurs à facettes : chaque groupe compte selon les AUTRES filtres (recherche, créatrice…).
        const phaseBase = (rows ?? []).filter((r) => matchesExcept(r, "phase"));
        const statusBase = (rows ?? []).filter((r) => matchesExcept(r, "statut"));
        const groups: FilterGroup[] = [
          {
            id: "phase",
            label: "Phase",
            value: phaseFilter,
            onChange: setPhaseFilter,
            options: [
              { value: ALL, label: "Toutes", count: phaseBase.length },
              ...PHASES.map((p) => ({ value: p.key, label: p.label, count: phaseBase.filter((r) => phaseOf(r.step) === p.key).length })),
            ],
          },
          {
            id: "statut",
            label: "Statut",
            value: statusFilter,
            onChange: setStatusFilter,
            options: [
              { value: ALL, label: "Tous", count: statusBase.length },
              ...STATUS_OPTS.map((s) => ({ value: s.value, label: s.label, count: statusBase.filter((r) => r.status === s.value).length })),
            ],
          },
        ];
        return (
          <FilterPanel
            className="mb-4"
            activeCount={activeCount}
            groups={groups}
            onClear={() => { setPhaseFilter(ALL); setStatusFilter("active"); setCreatorFilter(""); }}
            extra={creators.length > 0 ? (
              <div className="flex flex-col gap-2">
                <span className="text-[12px] font-medium text-muted-foreground">Créatrice</span>
                <div className="flex items-center gap-2">
                  <UserRound className="h-4 w-4 shrink-0 text-faint" />
                  <select
                    value={creatorFilter}
                    onChange={(e) => setCreatorFilter(e.target.value)}
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-medium text-foreground outline-none focus:border-primary"
                  >
                    <option value="">Toutes les créatrices</option>
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

      <InlineForm open={formOpen} title="Nouvelle collab" onClose={() => setFormOpen(false)} onSubmit={submit}>
        <TextField label="Marque" value={brand} onChange={setBrand} />
        <SelectField label="Créatrice" value={creator} onChange={setCreator} options={creatorOptions} />
        <TextField label="Libellé de la collab" value={title} onChange={setTitle} placeholder="ex Campagne été" />
        <TextField label="Contact marque" value={contact} onChange={setContact} />
        <TextField label="Livrables" value={deliverables} onChange={setDeliverables} placeholder="ex 3 posts · 1 reel" />
        <TextField label="Cachet" value={cachet} onChange={setCachet} />
        <AutoGrowTextField label="Note" value={note} onChange={setNote} placeholder="Contexte, angle, points d'attention…" className="min-w-full" />
      </InlineForm>

      {content}
    </div>
  );
}
