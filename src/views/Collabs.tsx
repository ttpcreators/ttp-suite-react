import { useStickyState } from "@/lib/useStickyState";
import { TtpClock, TtpContacts, TtpGains, TtpNote, TtpPackage, TtpTrophy } from "@/components/icons/ttp-icons";
import { supabase } from "@/lib/supabase";
import { Spin } from "@/components/ui/loader";
import { useSearch, matchQuery } from "@/lib/search";
import { cn, titleCase } from "@/lib/utils";
import { ArrowRight, Pencil, Trash2, X, UserRound, XCircle, Archive, CircleDot, Check, ListChecks, ChevronDown, ChevronLeft, RotateCcw, LayoutGrid, List as ListIcon, PanelsTopLeft, RefreshCw, Heart, MessageCircle, ExternalLink } from "@/components/icons";
import { Tabs } from "@/components/ui/animated-tabs";
import { FilterPanel, type FilterGroup } from "@/components/ui/filter-panel";
import { StatsBento } from "@/components/ui/stats-bento";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { MailAvatar } from "@/components/mail-avatar";
import { brandDomainFrom, brandInitials, siteDomain } from "@/lib/mailAvatar";
import { getAppState, mergeAppStateKey, useAppState, type AppState } from "@/lib/appState";
import { CollabTakeCard } from "@/components/collab-take";
import { billingFor, cashModeFor, commissionInvoiceLabel, mandatesFrom, readSettings } from "@/lib/compta";
import { commissionMap, DEFAULT_COMMISSION, rateFor } from "@/lib/commission";
import { totalsOf } from "@/lib/invoice";
import { StatusPill } from "@/components/ui/status-pill";
import { useEffect, useState, type ReactElement } from "react";
import { dbInsert, dbUpdate, nextOrder } from "@/lib/db";
import { dbTrash } from "@/lib/trash";
import { toast } from "@/components/ui/toast";
import { AddButton, InlineForm, TextField, AutoGrowTextField, Picker } from "@/components/ui/form";
import { ActionMenu } from "@/components/ui/action-menu";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { useCreators } from "@/lib/useCreators";
import { useLiveKey } from "@/lib/useLive";
import { fmtDay, fmtDayAny } from "@/lib/dates";
import { getCache, setCache } from "@/lib/viewCache";
import { STEPS, STEP_COUNT, PHASES, stepDef, phaseOf, isDone, type PhaseKey } from "@/lib/collabs";
import { PageHeaderRow } from "@/components/ui/page-header";
import { FolderTabs, type FolderTabItem } from "@/components/ui/folder-tabs";
import { COLLAB_TABS, normalizeCollabTab, type CollabTab } from "@/lib/collabTabs";
import { Gifting } from "@/views/Gifting";
import { Prospection } from "@/views/Prospection";
import { requestIntent, useIntent } from "@/lib/openIntent";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { fmtCompact } from "@/lib/timeSeries";
import { igRefresh, igWhyText, postKind, useIgColumn, type IgCollab } from "@/lib/instagram";
import type { TtCollab } from "@/lib/tiktok";
import type { YtCollab } from "@/lib/youtube";
import { CreatorPickerField } from "@/components/ui/creator-picker";
import { useBlockedCreators } from "@/lib/useExclusivites";
import { CollabLinkedPanel, useCollabAutoTasks } from "@/components/collab-links";
import { CollabExcluPanel } from "@/components/exclu-alert";
import { createStepTask } from "@/lib/collabLinksDb";
import { autoTaskFor, cachetAmount } from "@/lib/collabLinks";
import { putInvoicePrefill } from "@/lib/invoicePrefill";
import { useIsWide } from "@/lib/iosUi";

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

/** « 4 oct. » (format commun de dates.ts). */
function whenLabel(iso: string): string {
  return fmtDay(iso);
}

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
  // Adresses des contacts (marque → e-mail) : sert à trouver le logo de chaque marque.
  const [brandContacts, setBrandContacts] = useState<{ brand: string | null; email: string | null }[]>([]);
  useEffect(() => {
    let alive = true;
    void supabase.from("contacts").select("brand, email").then(({ data, error }) => {
      if (alive && !error) setBrandContacts((data as { brand: string | null; email: string | null }[] | null) ?? []);
    });
    return () => {
      alive = false;
    };
  }, []);
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
  // Affichage : détail (liste par phase + fiche à droite, par défaut), cartes ou liste.
  // Retenu sur l'appareil.
  const [layout, changeLayout] = useStickyState("collabs:vue", ["detail", "cards", "list"] as const, "detail");
  // Classeur : Payées (les collabs) · Gifting · Négociations (src/lib/collabTabs.ts).
  const [onglet, setOnglet] = useStickyState<CollabTab>("collabs:onglet", COLLAB_TABS, "payees");
  useIntent("collabs:tab", (t) => setOnglet(normalizeCollabTab(t)));
  // Collab ouverte dans l'affichage détail (retenue sur l'appareil) ; sur petit écran,
  // la fiche s'ouvre à la place de la liste.
  const [selId, setSelId] = useState<string | null>(() => {
    try {
      return localStorage.getItem("ttp:ui:collabs:ouverte");
    } catch {
      return null;
    }
  });
  const [phoneDetail, setPhoneDetail] = useState(false);
  const wide = useIsWide();
  const pick = (id: string) => {
    setSelId(id);
    setPhoneDetail(true);
    try {
      localStorage.setItem("ttp:ui:collabs:ouverte", id);
    } catch {
      /* stockage indisponible */
    }
  };

  // formulaire de création
  const [formOpen, setFormOpen] = useState(false);
  // « Nouvelle collab » de la palette ⌘K : ouvre le formulaire de création.
  useIntent("collab:new", () => {
    setOnglet("payees");
    setFormOpen(true);
  });
  // « Ouvrir » d'une collab bloquée (Aujourd'hui) : affichage détail, filtres levés, fiche ouverte.
  useIntent("collab:open", (id) => {
    if (!id) return;
    setOnglet("payees");
    changeLayout("detail");
    if (statusFilter !== "__all__" && statusFilter !== "active") setStatusFilter("active");
    setPhaseFilter("__all__");
    setCreatorFilter("");
    pick(id);
  });
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
  // Créateurs en exclusivité avec un concurrent de la marque saisie : signalés, jamais en tête.
  const blockedNew = useBlockedCreators(brand);
  const blockedEdit = useBlockedCreators(eBrand);
  const [eContact, setEContact] = useState("");
  const [eTitle, setETitle] = useState("");
  const [eDeliverables, setEDeliverables] = useState("");
  const [eCachet, setECachet] = useState("");
  const [eCreator, setECreator] = useState("");
  const [eNote, setENote] = useState("");
  const [eSite, setESite] = useState("");
  // Sites des marques saisis par l'agence (blob partagé `brandSites` : clé = nom de marque
  // en minuscules → domaine). Sert à afficher le logo quand aucun contact ne le donne.
  const { data: brandSites } = useAppState<Record<string, string>>((st) => (st["brandSites"] as Record<string, string>) ?? {});
  const siteOf = (brand: string) => brandSites?.[brand.trim().toLowerCase()] ?? "";

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
                <span className="shrink-0 text-faint">{fmtDayAny(p.at)}</span>
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
                <span className="shrink-0 text-faint">{fmtDayAny(p.at)}</span>
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
                <span className="shrink-0 text-faint">{fmtDayAny(p.at)}</span>
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

  /**
   * Repère visuel d'une collab : le logo de la marque (trouvé comme dans Contacts et
   * Mails, sinon sa lettre teintée de la phase), avec la photo du créateur en médaillon.
   */
  const brandMark = (row: Row, size: "sm" | "lg", onAccent = false) => {
    const key = row.brand.trim().toLowerCase();
    const email = brandContacts.find((c) => (c.brand ?? "").trim().toLowerCase() === key && c.email)?.email ?? null;
    return (
      <span className="relative shrink-0">
        <MailAvatar
          name={row.brand}
          email={email}
          brand={row.brand}
          brandDomain={siteOf(row.brand) || brandDomainFrom(brandContacts, row.brand)}
          className={size === "lg" ? "h-14 w-14 rounded-[16px]" : "h-9 w-9 rounded-[11px]"}
          // Pas de logo trouvé : monogramme encre, comme un logo de marque (« PI », « OA »).
          fallback={brandInitials(row.brand)}
          fallbackClassName={cn(
            "font-semibold tracking-[-0.02em]",
            size === "lg" ? "text-[20px]" : "text-[12.5px]",
            onAccent ? "bg-primary-foreground text-primary" : "bg-foreground text-background",
          )}
        />
        {row.creator && (
          <CreatorAvatar
            name={row.creator}
            photoUrl={photoOf(row.creator)}
            className={cn(
              "absolute rounded-full ring-2",
              size === "lg" ? "-bottom-1.5 -right-1.5 h-7 w-7 text-[10px]" : "-bottom-1.5 -right-1.5 h-[18px] w-[18px] text-[8px]",
              onAccent ? "ring-primary" : "ring-surface",
            )}
          />
        )}
      </span>
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
    setESite(siteOf(row.brand));
  };
  const saveEdit = async (id: string) => {
    if (!eBrand.trim()) return toast("Renseigne la marque");
    const patch = {
      brand: eBrand.trim(), contact: eContact.trim() || null, title: eTitle.trim() || null,
      deliverables: eDeliverables.trim() || null, cachet: eCachet.trim() || null,
      creator: eCreator || null, note: eNote.trim() || null,
    };
    if (!(await dbUpdate("collabs", id, patch))) return toast("Erreur, réessaie");
    setRows((rows ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
    // Site de la marque (pour son logo) : partagé avec toute l'équipe, rangé par nom de marque.
    const key = patch.brand.toLowerCase();
    const domain = siteDomain(eSite);
    if (eSite.trim() && !domain) toast("Site de la marque non reconnu, ex. seoni.fr");
    else if (domain !== siteOf(patch.brand)) {
      const ok = domain ? await mergeAppStateKey("brandSites", { [key]: domain }) : await mergeAppStateKey("brandSites", {}, [key]);
      if (!ok) toast("Site de la marque non enregistré, réessaie");
    }
    toast("Collab mise à jour ✓");
    setEditId(null);
  };

  // Tâche créée à chaque étape franchie (réglage d'équipe, activé par défaut).
  const [autoTasks] = useCollabAutoTasks();
  // « Créer la facture » : Facturation s'ouvre sur un brouillon prérempli. Selon qui encaisse
  // (bloc « Ce que je prends », src/lib/compta.ts) : la facture à la marque (cachet), ou la
  // facture de la commission de l'agence au créateur quand la marque paie le créateur.
  const createInvoice = async (row: Row) => {
    const amount = cachetAmount(row.cachet);
    const st = await getAppState().catch(() => ({}) as AppState);
    const mode = cashModeFor(row.id, row.creator, (st.collabCashMode as Record<string, string>) ?? {}, mandatesFrom(st.contractHistory));
    let ok: boolean;
    if (mode === "createur") {
      const rate = rateFor(row.creator, commissionMap(creators), (st.creatorCommission as Record<string, number>) ?? {}, DEFAULT_COMMISSION);
      const commission = totalsOf([{ id: "c", label: "", qty: 1, unit: amount }], true, 0, rate).commission;
      ok = putInvoicePrefill({
        creator: "",
        brand: titleCase(row.creator ?? "") || "Créateur",
        lines: [{ label: commissionInvoiceLabel(row.brand, rate), unit: commission }],
        collabId: row.id,
        kind: "commission",
        franchise: readSettings(st.comptaSettings).vatRegime !== "assujetti",
      });
    } else {
      ok = putInvoicePrefill({
        creator: row.creator ?? "",
        brand: row.brand,
        lines: [{ label: row.deliverables?.trim() || row.title?.trim() || `Collab ${row.brand}`, unit: amount }],
        collabId: row.id,
        // Au nom de l'agence, ou du créateur (mandat) : choix de la collab, sinon le réglage de la page Compta.
        onBehalf: billingFor(row.id, (st.collabCashMode as Record<string, string>) ?? {}, readSettings(st.comptaSettings)) === "mandat",
      });
    }
    if (!ok) return toast("Impossible de préparer la facture");
    window.dispatchEvent(new CustomEvent("ttp-navigate", { detail: "facturation" }));
  };

  // « Préparer le bilan » (étape 11) : la page Bilan s'ouvre sur le bilan prérempli de la collab.
  const prepareRecap = (row: Row) => {
    requestIntent("collab:recap", row.id);
    window.dispatchEvent(new CustomEvent("ttp-navigate", { detail: "debrief" }));
  };

  // Faire avancer / positionner l'étape (le trigger côté base date le changement).
  const setStep = async (row: Row, next: number) => {
    const clamped = Math.min(STEP_COUNT, Math.max(1, next));
    if (clamped === row.step) return;
    const prev = row.step;
    setRows((rs) => (rs ?? []).map((r) => (r.id === row.id ? { ...r, step: clamped } : r)));
    if (!(await dbUpdate("collabs", row.id, { step: clamped }))) {
      setRows((rs) => (rs ?? []).map((r) => (r.id === row.id ? { ...r, step: prev } : r)));
      return toast("Erreur, réessaie");
    }
    // Reflète le changement dans l'historique local (pour les dates, sans re-fetch).
    setSteps((m) => ({ ...m, [row.id]: [...(m[row.id] ?? []), { collab_id: row.id, step: clamped, reached_at: new Date().toISOString() }] }));
    if (clamped > prev) {
      toast(`Étape ${clamped} · ${stepDef(clamped).short} ✓`);
      if (autoTasks && autoTaskFor(clamped, row)) {
        void createStepTask({ id: row.id, brand: row.brand, creator: row.creator, step: clamped, status: row.status }, clamped).then((r) => {
          if (r === "created") toast(`Tâche ajoutée : ${autoTaskFor(clamped, row)?.text ?? ""}`);
          else if (r === "error") toast("Tâche de l'étape non créée");
        });
      }
    }
  };

  const setStatus = async (row: Row, status: string) => {
    const prev = row.status;
    setRows((rs) => (rs ?? []).map((r) => (r.id === row.id ? { ...r, status } : r)));
    if (!(await dbUpdate("collabs", row.id, { status }))) {
      setRows((rs) => (rs ?? []).map((r) => (r.id === row.id ? { ...r, status: prev } : r)));
      toast("Erreur, réessaie");
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
        { key: "won", label: "Marquer gagnée", icon: TtpTrophy, onClick: () => setStatus(row, "gagnee") },
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
                {d && <span className="shrink-0 tabular-nums text-faint">{fmtDayAny(d)}</span>}
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
            <CreatorPickerField label="Créateur" value={eCreator} onChange={setECreator} creators={creators} blocked={blockedEdit} />
            <TextField label="Libellé de la collab" value={eTitle} onChange={setETitle} placeholder="ex Campagne été" />
            <TextField label="Contact marque" value={eContact} onChange={setEContact} />
            <TextField label="Livrables" value={eDeliverables} onChange={setEDeliverables} placeholder="ex 3 posts · 1 reel" />
            <TextField label="Cachet" value={eCachet} onChange={setECachet} />
            <TextField label="Site de la marque (pour son logo)" value={eSite} onChange={setESite} placeholder="ex. seoni.fr" />
            <AutoGrowTextField label="Note" value={eNote} onChange={setENote} placeholder="Contexte, angle, points d'attention…" mentions={creators} />
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
        {/* En-tête : logo + marque + menu */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            {brandMark(row, "sm")}
            <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold tracking-tight text-foreground">{row.brand}</h2>
            {row.title && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{row.title}</p>}
          </div>
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
                <TtpClock className="h-3 w-3" /> {stale} j à cette étape
              </span>
            )}
          </div>
          <div className="mt-1 text-[13px] font-semibold text-foreground">{def.label}</div>
          {/* progression segmentée (11 segments, remplis jusqu'à l'étape courante) */}
          <div className="mt-2">{progressFor(row)}</div>
          {reached && (
            <div className="mt-1.5 text-[10px] text-faint">Depuis le {fmtDayAny(reached)}</div>
          )}
        </div>

        {/* Note de création */}
        {row.note && (
          <div className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <TtpNote className="mt-0.5 h-3 w-3 shrink-0 text-faint" />
            <span className="line-clamp-2 whitespace-pre-line">{row.note}</span>
          </div>
        )}

        {/* Livrables + cachet */}
        {(row.deliverables || row.cachet) && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-panel px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <TtpPackage className="h-3 w-3" /> Livrables
              </div>
              <div className="mt-1 truncate text-[12px] font-medium text-foreground">{row.deliverables || "—"}</div>
            </div>
            <div className="rounded-xl bg-panel px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <TtpGains className="h-3 w-3" /> Cachet
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
            <div className="flex min-w-0 items-center gap-2.5">
              {brandMark(row, "sm")}
              <div className="min-w-0">
              <h2 className="truncate text-[14px] font-semibold tracking-tight text-foreground">{row.brand}</h2>
              <p className="truncate text-[11px] text-muted-foreground">
                {[row.title, row.cachet].filter(Boolean).join(" · ") || "Collab"}
              </p>
            </div>
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
                  <TtpClock className="h-3 w-3" /> {stale} j
                </span>
              )}
            </div>
            <div className="mt-1.5">{progressFor(row)}</div>
            {reached && <div className="mt-1 text-[10px] text-faint">Depuis le {fmtDayAny(reached)}</div>}
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

  // ── affichage détail : liste par phase (gauche) + fiche de la collab (droite) ──
  const firstName = (name?: string | null) => (name ? titleCase(name).split(" ")[0] : "");
  const renderMaster = (list: Row[], selected: Row | undefined): ReactElement => (
    <div className="flex flex-col gap-3 rounded-[22px] bg-surface p-3 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto">
      {PHASES.map((p) => {
        const inPhase = list.filter((r) => phaseOf(r.step) === p.key);
        if (!inPhase.length) return null;
        return (
          <section key={p.key}>
            <h3 className="px-2 pb-1 pt-1.5 text-[12px] font-semibold text-muted-foreground">{p.label}</h3>
            <div className="flex flex-col gap-0.5">
              {inPhase.map((r) => {
                // Sans détail à côté (téléphone, tablette), aucune ligne n'est « active ».
                const on = wide && selected?.id === r.id;
                const d = daysSince(reachedAt(r));
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => pick(r.id)}
                    aria-current={on ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[14px] px-2.5 py-2 text-left transition-[background-color,transform] duration-[var(--dur-press)] active:scale-[0.99]",
                      on ? "bg-primary text-primary-foreground" : "hover:bg-rowhover",
                    )}
                  >
                    {brandMark(r, "sm", on)}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold">
                        {r.brand}
                        {r.creator ? ` × ${firstName(r.creator)}` : ""}
                      </span>
                      <span className={cn("block truncate text-[12px]", on ? "text-primary-foreground/80" : "text-muted-foreground")}>{stepDef(r.step).short}</span>
                    </span>
                    {d !== null && <span className={cn("shrink-0 text-[12px] font-semibold tabular-nums", on ? "text-primary-foreground/90" : "text-muted-foreground")}>{d} j</span>}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );

  /** Frise des 11 étapes : franchies cochées, étape en cours cerclée ; clic = aller à l'étape. */
  const stepperFor = (row: Row) => (
    <div className="overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ol className="flex min-w-[600px]">
        {STEPS.map((st, i) => {
          const done = st.n < row.step || isDone(row.step);
          const current = st.n === row.step && !isDone(row.step);
          return (
            <li key={st.n} className="relative flex flex-1 flex-col items-center">
              {i > 0 && <span aria-hidden className={cn("absolute right-1/2 top-[13px] h-[2px] w-full", st.n <= row.step ? "bg-primary" : "bg-border")} />}
              <button
                type="button"
                onClick={() => setStep(row, st.n)}
                title={`${st.n}. ${st.label}`}
                className={cn(
                  "relative z-10 grid h-7 w-7 place-items-center rounded-full transition-transform duration-[var(--dur-press)] active:scale-90",
                  done ? "bg-primary text-primary-foreground" : current ? "bg-surface ring-[3px] ring-inset ring-primary" : "bg-field",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : current ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
              </button>
              <span className={cn("mt-2 px-0.5 text-center text-[11px] leading-tight", current ? "font-semibold text-foreground" : done ? "text-foreground/80" : "text-muted-foreground")}>{st.short}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );

  const renderDetail = (row: Row): ReactElement => {
    if (editId === row.id) return renderCard(row);
    const def = stepDef(row.step);
    const reached = reachedAt(row);
    const d = daysSince(reached);
    const stale = staleDays(row);
    const statusMeta = statusMetaFor(row);
    const history = [...(steps[row.id] ?? [])].reverse();
    const facts = [
      { icon: TtpPackage, label: "Livrables", value: row.deliverables },
      { icon: TtpGains, label: "Cachet", value: row.cachet },
      { icon: TtpContacts, label: "Contact marque", value: row.contact },
    ].filter((f) => f.value);
    return (
      <div className="flex min-w-0 flex-col gap-5 rounded-[22px] bg-surface p-5 md:p-6">
        {/* En-tête : marque × créateur, actions */}
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          {brandMark(row, "lg")}
          <div className="min-w-[12rem] flex-1">
            <h2 className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-foreground">
              {row.brand}
              {row.creator ? ` × ${titleCase(row.creator)}` : ""}
            </h2>
            <p className="mt-0.5 text-[14px] text-muted-foreground">
              {[row.title, row.deliverables].filter(Boolean).join(" · ") || "Collab"} · étape {row.step} sur {STEP_COUNT}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {row.status !== "active" && <AnimatedBadge status={statusMeta.variant} size="sm">{statusMeta.label}</AnimatedBadge>}
            <button
              type="button"
              onClick={() => startEdit(row)}
              className="flex h-9 items-center gap-1.5 rounded-full bg-field px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-rowhover"
            >
              <Pencil className="h-3.5 w-3.5" /> Modifier
            </button>
            {menuFor(row)}
            {isDone(row.step) ? (
              <span className="flex h-9 items-center gap-1.5 rounded-full bg-ok-soft px-4 text-[13px] font-semibold text-ok">
                <Check className="h-4 w-4" /> Collab bouclée
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setStep(row, row.step + 1)}
                className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Passer à : {stepDef(row.step + 1).short} <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {stepperFor(row)}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* Étape en cours */}
          <div className="flex flex-col gap-3 rounded-[20px] bg-panel p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[17px] font-semibold text-foreground">{def.label}</h3>
              {!isDone(row.step) && row.status === "active" && (
                <StatusPill tone={stale !== null ? "wait" : "progress"}>
                  {stale !== null ? <TtpClock className="h-3 w-3" /> : null}
                  En cours{d !== null ? ` · ${d} j` : ""}
                </StatusPill>
              )}
            </div>
            {reached && <p className="-mt-2 text-[12px] text-muted-foreground">Depuis le {fmtDayAny(reached)}</p>}
            {facts.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {facts.map((f) => (
                  <div key={f.label} className="flex items-center gap-2.5 rounded-[12px] bg-surface px-3 py-2">
                    <f.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-[13px] text-muted-foreground">{f.label}</span>
                    <span className="ml-auto truncate text-[13px] font-medium text-foreground">{f.value}</span>
                  </div>
                ))}
              </div>
            )}
            {row.note && (
              <div className="flex items-start gap-2 rounded-[12px] bg-surface px-3 py-2 text-[13px] text-foreground/80">
                <TtpNote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="whitespace-pre-line">{row.note}</span>
              </div>
            )}
            {igBlockFor(row)}
          </div>

          {/* Activité : chaque étape franchie, datée (historique de la collab) */}
          <div className="rounded-[20px] bg-panel p-4">
            <h3 className="mb-3 text-[17px] font-semibold text-foreground">Activité</h3>
            {history.length ? (
              <ol className="flex flex-col">
                {history.slice(0, 12).map((h, i) => (
                  <li key={`${h.step}-${h.reached_at}`} className="relative flex gap-3 pb-3 last:pb-0">
                    {i < Math.min(history.length, 12) - 1 && <span aria-hidden className="absolute left-[4px] top-3 h-full w-px bg-border" />}
                    <span className={cn("relative mt-1.5 h-[9px] w-[9px] shrink-0 rounded-full", PHASE_DOT[phaseOf(h.step)])} />
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium text-foreground">Étape « {stepDef(h.step).short} » atteinte</span>
                      <span className="block text-[12px] text-muted-foreground">{whenLabel(h.reached_at)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[13px] text-muted-foreground">Les étapes franchies s'afficheront ici, datées.</p>
            )}
          </div>
        </div>

        <CollabTakeCard collab={{ id: row.id, brand: row.brand, creator: row.creator, cachet: row.cachet }} />

        <CollabLinkedPanel
          collab={{ id: row.id, brand: row.brand, creator: row.creator, step: row.step, status: row.status, cachet: row.cachet }}
          onCreateInvoice={() => void createInvoice(row)}
          onPrepareRecap={() => prepareRecap(row)}
        />
        {/* Exclusivité signée avec cette marque (points clés) ou exclusivité qui la bloque. */}
        <CollabExcluPanel creator={row.creator} brand={row.brand} />
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
    const selected = filtered.find((r) => r.id === selId) ?? filtered[0];
    content = layout === "detail" ? (
      <div className="grid items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className={cn(phoneDetail && "max-lg:hidden")}>{renderMaster(filtered, selected)}</div>
        {selected && (
          <div className={cn("min-w-0", !phoneDetail && "max-lg:hidden")}>
            <button type="button" onClick={() => setPhoneDetail(false)} className="mb-2 flex items-center gap-1 text-[14px] font-medium text-primary lg:hidden">
              <ChevronLeft className="h-4 w-4" /> Collabs
            </button>
            {renderDetail(selected)}
          </div>
        )}
      </div>
    ) : layout === "list" ? (
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-sm">{filtered.map((r) => renderRow(r))}</div>
    ) : (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map((r) => renderCard(r))}</div>
    );
  }

  const activeRows = (rows ?? []).filter((r) => r.status === "active");

  const folderItems: FolderTabItem[] = [
    { value: "payees", label: "Payées" },
    { value: "gifting", label: "Gifting" },
    { value: "negociations", label: "Négociations" },
  ];

  return (
    <div>
      {/* En-tête : celui de l'onglet ouvert (Gifting et Négociations ont le leur). */}
      {onglet === "payees" && (
        <PageHeaderRow>
          <div className="text-sm text-muted-foreground">
            {rows === null ? "Chargement…" : `${rows.length} collab${rows.length > 1 ? "s" : ""}`}
          </div>
          <AddButton label="Collab" onClick={() => setFormOpen(true)} />
        </PageHeaderRow>
      )}
      <FolderTabs label="Collabs, gifting et négociations" orderKey="collabs" items={folderItems} value={onglet} onValueChange={(v) => setOnglet(normalizeCollabTab(v))}>
      {onglet === "gifting" ? (
        <Gifting embedded />
      ) : onglet === "negociations" ? (
        <Prospection embedded />
      ) : (
      <>

      {/* Synthèse (bento) */}
      {rows !== null && rows.length > 0 && (() => {
        const byPhase = PHASES.map((p) => activeRows.filter((r) => phaseOf(r.step) === p.key).length);
        const staleCount = activeRows.filter((r) => staleDays(r) !== null).length;
        const won = (rows ?? []).filter((r) => r.status === "gagnee" || (r.status === "active" && isDone(r.step))).length;
        const prod = activeRows.filter((r) => phaseOf(r.step) === "production").length;
        return (
          <StatsBento phoneStrip
            className="mb-5"
            primary={{ eyebrow: "Collabs en cours", value: String(activeRows.length), caption: `sur ${rows.length} collab${rows.length > 1 ? "s" : ""} au total.` }}
            bars={{ label: "En production", value: String(prod), series: byPhase }}
            small={{ value: String(staleCount), label: `Bloquées depuis ${STALE_DAYS} j ou +` }}
            accent={{ value: String(won), label: "Bouclées / gagnées", icon: TtpTrophy }}
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
                onValueChange={(v) => changeLayout(v as "detail" | "cards" | "list")}
                items={[
                  { value: "detail", label: "Détail", icon: <PanelsTopLeft className="h-3.5 w-3.5" />, hideLabel: "mobile" },
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
        <CreatorPickerField label="Créateur" value={creator} onChange={setCreator} creators={creators} blocked={blockedNew} />
        <TextField label="Libellé de la collab" value={title} onChange={setTitle} placeholder="ex Campagne été" />
        <TextField label="Contact marque" value={contact} onChange={setContact} />
        <TextField label="Livrables" value={deliverables} onChange={setDeliverables} placeholder="ex 3 posts · 1 reel" />
        <TextField label="Cachet" value={cachet} onChange={setCachet} />
        <AutoGrowTextField label="Note" value={note} onChange={setNote} placeholder="Contexte, angle, points d'attention…" className="min-w-full" mentions={creators} />
      </InlineForm>

      {content}
      </>
      )}
      </FolderTabs>
    </div>
  );
}
