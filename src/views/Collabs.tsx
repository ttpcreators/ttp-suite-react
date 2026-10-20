import { useStickyState } from "@/lib/useStickyState";
import { supabase } from "@/lib/supabase";
import { Spin } from "@/components/ui/loader";
import { useSearch, matchQuery } from "@/lib/search";
import { cn, titleCase } from "@/lib/utils";
import { ArrowRight, Pencil, Trash2, X, UserRound, Package, Wallet, Clock, Trophy, XCircle, Archive, CircleDot, Check, ListChecks, ChevronDown, RotateCcw, StickyNote, LayoutGrid, List as ListIcon, RefreshCw, Heart, MessageCircle, ExternalLink } from "lucide-react";
import { Tabs } from "@/components/ui/animated-tabs";
import { FilterPanel, type FilterGroup } from "@/components/ui/filter-panel";
import { StatsBento } from "@/components/ui/stats-bento";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { useEffect, useState, type ReactElement } from "react";
import { dbInsert, dbUpdate, nextOrder } from "@/lib/db";
import { dbTrash } from "@/lib/trash";
import { toast } from "@/components/ui/toast";
import { AddButton, InlineForm, TextField, AutoGrowTextField, SelectField, Picker } from "@/components/ui/form";
import { ActionMenu } from "@/components/ui/action-menu";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { useCreators } from "@/lib/useCreators";
import { useLiveKey } from "@/lib/useLive";
import { frDate } from "@/lib/dates";
import { getCache, setCache } from "@/lib/viewCache";
import { STEPS, STEP_COUNT, PHASES, stepDef, phaseOf, isDone, type PhaseKey } from "@/lib/collabs";
import { PageHeaderRow } from "@/components/ui/page-header";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { fmtCompact } from "@/lib/timeSeries";
import { igRefresh, igWhyText, postKind, useIgColumn, type IgCollab } from "@/lib/instagram";
import type { TtCollab } from "@/lib/tiktok";
import type { YtCollab } from "@/lib/youtube";

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
  { value: "active", label: "En cours", dot: "bg-progress" },
  { value: "gagnee", label: "Gagnée", dot: "bg-ok" },
  { value: "perdue", label: "Perdue", dot: "bg-closed" },
  { value: "archivee", label: "Archivée", dot: "bg-closed" },
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

/** Nombre de publications attendues d'après les livrables (« 3 posts · 1 reel » → 4 ; stories exclues). */
function expectedPosts(d?: string | null): number {
  let n = 0;
  for (const m of (d ?? "").matchAll(/(\d+)\s*(posts?|reels?|carrousels?|carousels?|publications?|vid[ée]os?)/gi)) n += Number(m[1]);
  return n;
}

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
  // Publications de la marque repérées sur Instagram (ig-sync, chaque nuit dès l'étape 4).
  const [igCollabs, putIgCollab] = useIgColumn<IgCollab>("collabs", "id");
  const [igBusy, setIgBusy] = useState<string | null>(null);
  const [ttCollabs, setTtCollabs] = useState<Record<string, TtCollab>>({});
  const [ytCollabs, setYtCollabs] = useState<Record<string, YtCollab>>({});
  const [error, setError] = useState(false);
  const { query } = useSearch();
  const creators = useCreators();
  const live = useLiveKey();
  // Vidéos TikTok repérées (tt-sync) ; colonne absente avant le SQL TikTok : rien.
  useEffect(() => {
    let alive = true;
    void supabase.from("collabs").select("id, tt").not("tt", "is", null).then(({ data, error }) => {
      if (!alive || error) return;
      const m: Record<string, TtCollab> = {};
      for (const r of (data as { id: string; tt: TtCollab | null }[] | null) ?? []) if (r.tt) m[r.id] = r.tt;
      setTtCollabs(m);
    });
    // Pareil pour YouTube (yt-sync) ; requête à part : colonne absente avant son SQL.
    void supabase.from("collabs").select("id, yt").not("yt", "is", null).then(({ data, error }) => {
      if (!alive || error) return;
      const m: Record<string, YtCollab> = {};
      for (const r of (data as { id: string; yt: YtCollab | null }[] | null) ?? []) if (r.yt?.posts?.length) m[r.id] = r.yt;
      setYtCollabs(m);
    });
    return () => {
      alive = false;
    };
  }, [live]);

  const [phaseFilter, setPhaseFilter] = useState<string>("__all__");
  const [statusFilter, setStatusFilter] = useStickyState<string>("collabs:statut", ["__all__", ...STATUS_OPTS.map((o) => o.value)], "active");
  const [creatorFilter, setCreatorFilter] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Affichage : cartes (grille) ou liste (une collab par ligne). Retenu sur l'appareil.
  const [layout, setLayout] = useState<"cards" | "list">(() => {
    try {
      return localStorage.getItem("ttp:collabs-layout") === "list" ? "list" : "cards";
    } catch {
      return "cards";
    }
  });
  const changeLayout = (v: "cards" | "list") => {
    setLayout(v);
    try {
      localStorage.setItem("ttp:collabs-layout", v);
    } catch {
      /* stockage indisponible */
    }
  };

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
        // Rafraîchissement raté : on garde les collabs déjà affichées (l'erreur ne
        // s'affiche que s'il n'y a rien à montrer).
        setRows((prev) => prev ?? []);
        return;
      }
      const list = (res.data as Row[]) ?? [];
      setError(false);
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

  const checkIg = async (row: Row) => {
    setIgBusy(row.id);
    const r = await igRefresh<IgCollab>("collab", row.id);
    setIgBusy(null);
    if (!r.ig) return toast(r.error === "meta_non_configure" ? "Instagram n'est pas encore relié à Meta" : "Vérification impossible, réessaie");
    putIgCollab(row.id, r.ig);
    const n = r.ig.posts?.length ?? 0;
    toast(r.ig.why ? `Instagram : ${igWhyText(r.ig.why)}` : n ? `${n} publication${n > 1 ? "s" : ""} repérée${n > 1 ? "s" : ""} ✓` : "Rien de publié qui cite la marque pour l'instant");
  };
  /** Bloc « Publications repérées » (dès l'étape Tournage). */
  const igBlockFor = (row: Row) => {
    if (row.step < 4) return null;
    const ig = igCollabs[row.id];
    const posts = ig?.posts ?? [];
    // Vidéos TikTok de la créatrice qui citent la marque (tt-sync, si elle a connecté son TikTok).
    const ttPosts = ttCollabs[row.id]?.posts ?? [];
    const ytPosts = ytCollabs[row.id]?.posts ?? [];
    const total = posts.length + ttPosts.length + ytPosts.length;
    const expected = expectedPosts(row.deliverables);
    return (
      <div className="mt-2 rounded-xl bg-panel px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <PlatformIcon platform="instagram" className="h-3 w-3" /> Publications repérées
            {(expected > 0 || total > 0) && (
              <span className={cn("font-semibold", expected > 0 && total >= expected ? "text-signaltext" : "text-foreground")}>
                · {total}{expected > 0 ? ` / ${expected}` : ""}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void checkIg(row)}
            disabled={igBusy === row.id}
            title="Chercher maintenant les posts qui citent la marque"
            className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50"
          >
            {igBusy === row.id ? <Spin size={12} /> : <RefreshCw className="h-3 w-3" />} Vérifier
          </button>
        </div>
        {total > 0 ? (
          <div className="mt-1.5 flex flex-col gap-1">
            {posts.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg bg-surface px-2 py-1.5 text-[11px] transition-colors hover:bg-rowhover">
                <span className="shrink-0 font-semibold text-foreground">{postKind(p)}</span>
                <span className="shrink-0 text-faint">{frDate(p.at)}</span>
                <span className="ml-auto flex shrink-0 items-center gap-2 tabular-nums text-muted-foreground">
                  {p.likes != null && <span className="flex items-center gap-0.5"><Heart className="h-3 w-3" />{fmtCompact(p.likes)}</span>}
                  <span className="flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />{fmtCompact(p.comments)}</span>
                  {p.reach != null && <span title="Comptes touchés">{fmtCompact(p.reach)} touchés</span>}
                  <ExternalLink className="h-3 w-3 text-faint" />
                </span>
              </a>
            ))}
            {ttPosts.map((p) => (
              <a key={`tt${p.id}`} href={p.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg bg-surface px-2 py-1.5 text-[11px] transition-colors hover:bg-rowhover">
                <span className="flex shrink-0 items-center gap-1 font-semibold text-foreground"><PlatformIcon platform="tiktok" className="h-3 w-3" />TikTok</span>
                <span className="shrink-0 text-faint">{frDate(p.at)}</span>
                <span className="ml-auto flex shrink-0 items-center gap-2 tabular-nums text-muted-foreground">
                  {p.views != null && <span title="Vues">{fmtCompact(p.views)} vues</span>}
                  {p.likes != null && <span className="flex items-center gap-0.5"><Heart className="h-3 w-3" />{fmtCompact(p.likes)}</span>}
                  {p.comments != null && <span className="flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />{fmtCompact(p.comments)}</span>}
                  <ExternalLink className="h-3 w-3 text-faint" />
                </span>
              </a>
            ))}
            {ytPosts.map((p) => (
              <a key={`yt${p.id}`} href={p.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg bg-surface px-2 py-1.5 text-[11px] transition-colors hover:bg-rowhover">
                <span className="flex shrink-0 items-center gap-1 font-semibold text-foreground"><PlatformIcon platform="youtube" className="h-3 w-3" />{p.short ? "Short" : "YouTube"}</span>
                <span className="shrink-0 text-faint">{frDate(p.at)}</span>
                <span className="ml-auto flex shrink-0 items-center gap-2 tabular-nums text-muted-foreground">
                  {p.views != null && <span title="Vues">{fmtCompact(p.views)} vues</span>}
                  {p.likes != null && <span className="flex items-center gap-0.5"><Heart className="h-3 w-3" />{fmtCompact(p.likes)}</span>}
                  {p.comments != null && <span className="flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />{fmtCompact(p.comments)}</span>}
                  <ExternalLink className="h-3 w-3 text-faint" />
                </span>
              </a>
            ))}
            {row.step < 6 && <div className="mt-0.5 text-[10px] font-medium text-signaltext">C'est en ligne : tu peux passer à l'étape « Publication ».</div>}
          </div>
        ) : (
          <div className="mt-1 text-[11px] text-faint">
            {ig?.why ? igWhyText(ig.why) : ig?.at ? "Rien de publié qui cite la marque pour l'instant." : "Vérifié chaque nuit : posts et reels qui citent la marque (@, # ou nom). Les stories ne sont pas visibles."}
          </div>
        )}
      </div>
    );
  };

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
    if (!created) return toast("Erreur, réessaie");
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

  // ── éléments partagés par la carte et la ligne ──
  const statusMetaFor = (row: Row) =>
    row.status === "gagnee" ? { variant: "success" as const, label: "Gagnée" }
    : row.status === "perdue" ? { variant: "danger" as const, label: "Perdue" }
    : row.status === "archivee" ? { variant: "neutral" as const, label: "Archivée" }
    : isDone(row.step) ? { variant: "success" as const, label: "Bouclée" }
    : { variant: "info" as const, label: "En cours" };

  const menuFor = (row: Row) => (
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
  );

  /** Progression segmentée (11 segments, remplis jusqu'à l'étape courante) ; clic = aller à l'étape. */
  const progressFor = (row: Row) => (
    <div className="flex gap-1">
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
  );

  /** Historique détaillé des 11 étapes (dates), affiché en dépliant. */
  const stepsListFor = (row: Row) => {
    const stepHits = steps[row.id] ?? [];
    const dateForStep = (n: number): string | null => {
      const hit = [...stepHits].reverse().find((s) => s.step === n);
      return hit ? hit.reached_at : null;
    };
    return (
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
    );
  };

  /** Bouton « étape suivante » (ou « Collab bouclée ») + bouton de dépliage des étapes. */
  const actionsFor = (row: Row, compact = false) => {
    const isOpen = expanded.has(row.id);
    const h = compact ? "h-8" : "h-[38px]";
    return (
      <>
        {isDone(row.step) ? (
          <div className={cn("flex items-center justify-center gap-1.5 rounded-lg border border-signal/30 bg-signal/[0.08] px-3 text-[11px] font-semibold text-signal", h, compact ? "max-md:flex-1" : "flex-1")}>
            <Check className="h-3.5 w-3.5" /> Collab bouclée
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setStep(row, row.step + 1)}
            className={cn("flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90", h, compact ? "max-md:flex-1" : "flex-1")}
          >
            {stepDef(row.step + 1).short} <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => toggleExpand(row.id)}
          className={cn("flex shrink-0 items-center gap-1 rounded-full border border-border px-3 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground", h)}
          title="Voir toutes les étapes"
          aria-expanded={isOpen}
        >
          <ListChecks className="h-3.5 w-3.5" />
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} />
        </button>
      </>
    );
  };

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
            <SelectField label="Créateur" value={eCreator} onChange={setECreator} options={creatorOptions} />
            <TextField label="Libellé de la collab" value={eTitle} onChange={setETitle} placeholder="ex Campagne été" />
            <TextField label="Contact marque" value={eContact} onChange={setEContact} />
            <TextField label="Livrables" value={eDeliverables} onChange={setEDeliverables} placeholder="ex 3 posts · 1 reel" />
            <TextField label="Cachet" value={eCachet} onChange={setECachet} />
            <AutoGrowTextField label="Note" value={eNote} onChange={setENote} placeholder="Contexte, angle, points d'attention…" />
            <button
              type="button"
              onClick={() => saveEdit(row.id)}
              className="h-[42px] shrink-0 rounded-full bg-primary px-5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Enregistrer
            </button>
          </div>
        </div>
      );
    }

    const def = stepDef(row.step);
    const stale = staleDays(row);
    const reached = reachedAt(row);
    const isOpen = expanded.has(row.id);
    const statusMeta = statusMetaFor(row);

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
            {menuFor(row)}
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
            <span className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5 text-faint" /> Aucun créateur</span>
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
          <div className="mt-2">{progressFor(row)}</div>
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

        {igBlockFor(row)}

        {/* Action : faire avancer d'une étape */}
        <div className="mt-3 flex items-center gap-2">{actionsFor(row)}</div>

        {/* Historique détaillé des 11 étapes (dates) */}
        {isOpen && stepsListFor(row)}
      </div>
    );
  };

  // ── ligne d'une collab (affichage Liste) ──
  const renderRow = (row: Row): ReactElement => {
    // Modification : même formulaire que la carte, sur toute la largeur.
    if (editId === row.id) return <div key={row.id} className="p-3">{renderCard(row)}</div>;
    const def = stepDef(row.step);
    const stale = staleDays(row);
    const reached = reachedAt(row);
    const statusMeta = statusMetaFor(row);
    return (
      <div key={row.id} className="px-4 py-3.5 transition-colors hover:bg-rowhover/60">
        <div className="grid grid-cols-1 items-center gap-x-5 gap-y-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.5fr)_21rem]">
          {/* Marque + libellé, avec statut et menu sur mobile */}
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-[14px] font-semibold tracking-tight text-foreground">{row.brand}</h2>
              <p className="truncate text-[11px] text-muted-foreground">
                {[row.title, row.cachet].filter(Boolean).join(" · ") || "Collab"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1 md:hidden">
              <AnimatedBadge status={statusMeta.variant} size="sm">{statusMeta.label}</AnimatedBadge>
              {menuFor(row)}
            </div>
          </div>

          {/* Créatrice + contact */}
          <div className="min-w-0 text-[12px] text-muted-foreground">
            {row.creator ? (
              <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                <CreatorAvatar name={row.creator} photoUrl={photoOf(row.creator)} className="h-5 w-5 shrink-0 rounded-full text-[9px]" />
                <span className="truncate">{titleCase(row.creator)}</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5 text-faint" /> Aucun créateur</span>
            )}
            {row.contact && <span className="mt-0.5 block truncate text-[11px]">Contact · {row.contact}</span>}
          </div>

          {/* Étape courante + progression */}
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2 text-[12px]">
              <span className={cn("size-2 shrink-0 rounded-full", PHASE_DOT[def.phase])} />
              <span className="shrink-0 font-medium text-muted-foreground">{row.step} / {STEP_COUNT}</span>
              <span className="min-w-0 truncate font-semibold text-foreground">{def.label}</span>
              {stale !== null && (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber/15 px-2 py-0.5 text-[9px] font-semibold text-amber">
                  <Clock className="h-3 w-3" /> {stale} j
                </span>
              )}
            </div>
            <div className="mt-1.5">{progressFor(row)}</div>
            {reached && <div className="mt-1 text-[10px] text-faint">Depuis le {frDate(reached)}</div>}
            {(igCollabs[row.id]?.posts?.length ?? 0) > 0 && (
              <div className="mt-1 flex items-center gap-1 text-[10px] font-medium text-signaltext">
                <PlatformIcon platform="instagram" className="h-3 w-3" /> {igCollabs[row.id]?.posts?.length} publication{(igCollabs[row.id]?.posts?.length ?? 0) > 1 ? "s" : ""} repérée{(igCollabs[row.id]?.posts?.length ?? 0) > 1 ? "s" : ""}
              </div>
            )}
            {(ttCollabs[row.id]?.posts?.length ?? 0) > 0 && (
              <div className="mt-1 flex items-center gap-1 text-[10px] font-medium text-signaltext">
                <PlatformIcon platform="tiktok" className="h-3 w-3" /> {ttCollabs[row.id]?.posts?.length} vidéo{(ttCollabs[row.id]?.posts?.length ?? 0) > 1 ? "s" : ""} TikTok repérée{(ttCollabs[row.id]?.posts?.length ?? 0) > 1 ? "s" : ""}
              </div>
            )}
            {(ytCollabs[row.id]?.posts?.length ?? 0) > 0 && (
              <div className="mt-1 flex items-center gap-1 text-[10px] font-medium text-signaltext">
                <PlatformIcon platform="youtube" className="h-3 w-3" /> {ytCollabs[row.id]?.posts?.length} vidéo{(ytCollabs[row.id]?.posts?.length ?? 0) > 1 ? "s" : ""} YouTube repérée{(ytCollabs[row.id]?.posts?.length ?? 0) > 1 ? "s" : ""}
              </div>
            )}
          </div>

          {/* Statut + actions */}
          <div className="flex min-w-0 items-center gap-2 md:justify-end">
            <span className="max-md:hidden"><AnimatedBadge status={statusMeta.variant} size="sm">{statusMeta.label}</AnimatedBadge></span>
            <div className="flex flex-1 items-center gap-2 md:flex-none">{actionsFor(row, true)}</div>
            <span className="max-md:hidden">{menuFor(row)}</span>
          </div>
        </div>
        {expanded.has(row.id) && stepsListFor(row)}
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
        Les collabs ne sont pas encore activées. Détails dans Réglages › Diagnostic.
      </div>
    );
  } else if (error && rows.length === 0) {
    content = <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">Erreur de chargement.</div>;
  } else if (rows.length === 0) {
    content = <div className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-sm">Aucune collab pour le moment. Crée la première ✍️</div>;
  } else if (filtered.length === 0) {
    content = <div className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-sm">{query.trim() ? `Aucun résultat pour « ${query} »` : "Aucune collab pour ces filtres."}</div>;
  } else {
    content = layout === "list" ? (
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-sm">{filtered.map((r) => renderRow(r))}</div>
    ) : (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map((r) => renderCard(r))}</div>
    );
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
            bars={{ label: "En production", value: String(prod), series: byPhase }}
            small={{ value: String(staleCount), label: `Bloquées depuis ${STALE_DAYS} j ou +` }}
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
            right={
              <Tabs
                size="sm"
                label="Affichage des collabs"
                value={layout}
                onValueChange={(v) => changeLayout(v as "cards" | "list")}
                items={[
                  { value: "cards", label: "Cartes", icon: <LayoutGrid className="h-3.5 w-3.5" />, hideLabel: "mobile" },
                  { value: "list", label: "Liste", icon: <ListIcon className="h-3.5 w-3.5" />, hideLabel: "mobile" },
                ]}
              />
            }
            extra={creators.length > 0 ? (
              <div className="flex flex-col gap-2">
                <span className="text-[12px] font-medium text-muted-foreground">Créateur</span>
                <div className="flex items-center gap-2">
                  <UserRound className="h-4 w-4 shrink-0 text-faint" />
                  <Picker size="sm" ariaLabel="Filtrer par créateur" className="min-w-[200px]" value={creatorFilter} onChange={setCreatorFilter}
                    options={[{ value: "", label: "Tous les créateurs" }, ...creators.map((c) => ({ value: c.name, label: titleCase(c.name), img: c.photo_url }))]} />
                </div>
              </div>
            ) : undefined}
          />
        );
      })()}

      <InlineForm open={formOpen} title="Nouvelle collab" onClose={() => setFormOpen(false)} onSubmit={submit}>
        <TextField label="Marque" value={brand} onChange={setBrand} />
        <SelectField label="Créateur" value={creator} onChange={setCreator} options={creatorOptions} />
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
