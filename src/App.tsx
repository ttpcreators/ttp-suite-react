import { lazy, Suspense, useEffect, useLayoutEffect, useState, useRef, useCallback, type ComponentType, type MouseEvent as ReactMouseEvent } from "react";
import { ChevronRight, Moon, Sun, Loader2, X, Columns2, SquareArrowRight, Plus, LogOut, Pin, PinOff, Star, House, CircleEllipsis, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { restoreTabs, navigateTab, addTab, closeTab as closeTabState } from "@/lib/tabs";
import type { Session } from "@supabase/supabase-js";
import { ExpandableTabs } from "@/components/ui/be-ui-expandable-tabs";
import { GlobalSearch } from "@/components/GlobalSearch";
import { Toaster } from "@/components/ui/toast";
import { UndoSendBar } from "@/components/ui/undo-send";
import { Notifications } from "@/components/ui/notifications";
import { useNotifications } from "@/lib/useNotifications";
import { useCreators } from "@/lib/useCreators";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { maybeAutoRun } from "@/lib/diagnostics";
import { getThemePref, setThemePref } from "@/lib/accent";
import { Sidebar } from "@/components/Sidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PageFrame } from "@/components/ui/page-header";
import { Login } from "@/components/Login";
import { NAV, findItem, findPinnable, viewTitle, type NavItem, type ViewId } from "@/lib/nav";
import { NavSubContext, NavSubSetContext } from "@/lib/navSub";
import { setTeamSession } from "@/lib/team";
import { supabase } from "@/lib/supabase";
import { SearchContext } from "@/lib/search";
import { ThemeContext } from "@/lib/theme";
import { AgencyAvatar, MyName } from "@/components/ui/agency-avatar";
import { useIosUi, useIsPhone } from "@/lib/iosUi";
import { IosBackButton, IosBarIcon, IosNavBar, IosTabBar, type IosTab } from "@/components/mobile/ios-shell";
import { MoreScreen } from "@/components/mobile/more-screen";

// Vues chargées à la demande (code-splitting → démarrage plus léger, mobile compris).
const RosterTabs = lazy(() => import("@/views/RosterTabs").then((m) => ({ default: m.RosterTabs })));
const Apercu = lazy(() => import("@/views/Apercu").then((m) => ({ default: m.Apercu })));
const Stats = lazy(() => import("@/views/Stats").then((m) => ({ default: m.Stats })));
const Facturation = lazy(() => import("@/views/Facturation").then((m) => ({ default: m.Facturation })));
const Briefs = lazy(() => import("@/views/Briefs").then((m) => ({ default: m.Briefs })));
const Collabs = lazy(() => import("@/views/Collabs").then((m) => ({ default: m.Collabs })));
const AgentView = lazy(() => import("@/views/Agent").then((m) => ({ default: m.AgentView })));
const WhatsappView = lazy(() => import("@/views/Whatsapp").then((m) => ({ default: m.WhatsappView })));
const Gifting = lazy(() => import("@/views/Gifting").then((m) => ({ default: m.Gifting })));
const Idees = lazy(() => import("@/views/Idees").then((m) => ({ default: m.Idees })));
const Todo = lazy(() => import("@/views/Todo").then((m) => ({ default: m.Todo })));
const Planning = lazy(() => import("@/views/Planning").then((m) => ({ default: m.Planning })));
const Documents = lazy(() => import("@/views/Documents").then((m) => ({ default: m.Documents })));
const Contacts = lazy(() => import("@/views/Contacts").then((m) => ({ default: m.Contacts })));
const Mails = lazy(() => import("@/views/Mails").then((m) => ({ default: m.Mails })));
const Contrats = lazy(() => import("@/views/Contrats").then((m) => ({ default: m.Contrats })));
const Prospection = lazy(() => import("@/views/Prospection").then((m) => ({ default: m.Prospection })));
const Vivier = lazy(() => import("@/views/Vivier").then((m) => ({ default: m.Vivier })));
const Acces = lazy(() => import("@/views/Acces").then((m) => ({ default: m.Acces })));
const Objectifs = lazy(() => import("@/views/Objectifs").then((m) => ({ default: m.Objectifs })));
const Debrief = lazy(() => import("@/views/Debrief").then((m) => ({ default: m.Debrief })));
const Checklist = lazy(() => import("@/views/Checklist").then((m) => ({ default: m.Checklist })));
const Mediakit = lazy(() => import("@/views/Mediakit").then((m) => ({ default: m.Mediakit })));
const Templates = lazy(() => import("@/views/Templates").then((m) => ({ default: m.Templates })));
const CreatorDetail = lazy(() => import("@/views/CreatorDetail").then((m) => ({ default: m.CreatorDetail })));
const CreatorSpace = lazy(() => import("@/views/CreatorSpace").then((m) => ({ default: m.CreatorSpace })));
const Corbeille = lazy(() => import("@/views/Corbeille").then((m) => ({ default: m.Corbeille })));
const Activite = lazy(() => import("@/views/Activite").then((m) => ({ default: m.Activite })));
const Reversements = lazy(() => import("@/views/Reversements").then((m) => ({ default: m.Reversements })));
const Relances = lazy(() => import("@/views/Relances").then((m) => ({ default: m.Relances })));
const Echeances = lazy(() => import("@/views/Echeances").then((m) => ({ default: m.Echeances })));
const Parametres = lazy(() => import("@/views/Parametres").then((m) => ({ default: m.Parametres })));
const Diagnostique = lazy(() => import("@/views/Diagnostique").then((m) => ({ default: m.Diagnostique })));
const EngagementSuivi = lazy(() => import("@/views/EngagementSuivi").then((m) => ({ default: m.EngagementSuivi })));
const Engagement = lazy(() => import("@/views/Engagement").then((m) => ({ default: m.Engagement })));

const BASE = import.meta.env.BASE_URL;

const VIEWS: Partial<Record<ViewId, ComponentType>> = {
  apercu: Apercu,
  agent: AgentView,
  stats: Stats,
  facturation: Facturation,
  reversements: Reversements,
  relances: Relances,
  echeances: Echeances,
  briefs: Briefs,
  collabs: Collabs,
  gifting: Gifting,
  ideas: Idees,
  todo: Todo,
  planning: Planning,
  documents: Documents,
  contacts: Contacts,
  whatsapp: WhatsappView,
  mails: Mails,
  contrats: Contrats,
  prospection: Prospection,
  vivier: Vivier,
  acces: Acces,
  objectifs: Objectifs,
  debrief: Debrief,
  checklist: Checklist,
  mediakit: Mediakit,
  templates: Templates,
  parametres: Parametres,
  diagnostique: Diagnostique,
  suivi: EngagementSuivi,
  engagement: Engagement,
  corbeille: Corbeille,
  activite: Activite,
};

// `roster` est une vue valide gérée à part (pas dans VIEWS). hasOwn : `in`
// traverserait la chaîne de prototypes ("constructor"… passerait).
const isNavView = (id: string) => Object.hasOwn(VIEWS, id) || id === "roster";

function MobileMenu({
  items,
  onSelect,
}: {
  items: NavItem[];
  onSelect: (id: ViewId, sub?: string) => void;
}) {
  return (
    <div className="flex max-h-[60dvh] w-[15rem] flex-col gap-0.5 overflow-y-auto">
      {items.map((item) => (
        <div key={item.id}>
          <button
            type="button"
            onClick={() => onSelect(item.id)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <item.icon className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1">{item.label}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
          {/* Sous-pages (ex. Prospection → Mails), comme dans le menu ordinateur */}
          {item.children && item.children.length > 0 && (
            <div className="mb-1 ml-[1.15rem] flex flex-col gap-0.5 border-l border-foreground/10 pl-2.5">
              {item.children.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelect(item.id, c.id)}
                  className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ViewContent({
  active,
  onOpenCreator,
}: {
  active: ViewId;
  onOpenCreator: (name: string) => void;
}) {
  const item = findItem(active);
  if (active === "roster") return <RosterTabs onOpen={onOpenCreator} />;
  const View = VIEWS[active];
  if (View) return <View />;
  return (
    <div className="grid min-h-[40vh] place-items-center rounded-xl border border-dashed border-border bg-surface/50">
      <div className="text-center">
        {item && <item.icon className="mx-auto h-8 w-8 text-muted-foreground" />}
        <div className="mt-3 text-sm font-medium">
          {item?.label} — migration en cours
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Cette vue sera branchée sur tes vraies données très bientôt.
        </div>
      </div>
    </div>
  );
}

const PANE_FALLBACK = (
  <div className="grid min-h-[50vh] place-items-center">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

// En-tête d'un volet en mode split (titre + fermeture pour le volet de droite).
function PaneHeader({ title, onClose }: { title: string; onClose?: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5 md:px-6">
      <h2 className="truncate text-[15px] font-semibold tracking-tight">{title}</h2>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="ml-auto grid h-9 w-9 place-items-center rounded-md text-faint transition-colors hover:bg-rowhover hover:text-foreground"
          title="Fermer le volet"
          aria-label="Fermer le volet"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// Barre d'onglets façon navigateur (desktop). Chaque page ouverte = un onglet.
function TabBar({
  tabs,
  active,
  onSelect,
  onClose,
  onNew,
}: {
  tabs: ViewId[];
  active: ViewId;
  onSelect: (id: ViewId) => void;
  onClose: (id: ViewId) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-3 pt-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((id) => {
        const item = findItem(id);
        const isActive = id === active;
        return (
          <div
            key={id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(id)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(id)}
            className={cn(
              "group flex shrink-0 cursor-pointer items-center gap-2 rounded-t-lg border border-b-0 px-3 py-2 text-[12px] transition-colors",
              isActive
                ? "border-border bg-panel font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:bg-rowhover",
            )}
          >
            {item && <item.icon className="h-3.5 w-3.5 shrink-0" />}
            <span className="max-w-[130px] truncate">{item?.label ?? id}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose(id);
              }}
              className="grid h-4 w-4 shrink-0 place-items-center rounded text-faint transition-colors hover:bg-border hover:text-foreground"
              aria-label={`Fermer ${item?.label ?? id}`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onNew}
        className="ml-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-rowhover hover:text-foreground"
        title="Nouvel onglet"
        aria-label="Nouvel onglet"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [active, setActive] = useState<ViewId>(() => {
    // Restaure la dernière page ouverte (évite de retomber sur l'Aperçu à chaque refresh).
    try {
      const saved = localStorage.getItem("ttp:view");
      if (saved && isNavView(saved)) return saved as ViewId;
    } catch {
      /* localStorage indisponible */
    }
    return "apercu";
  });
  // Onglets ouverts (façon navigateur). L'onglet actif = `active`.
  const [tabs, setTabs] = useState<ViewId[]>(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem("ttp:tabs");
    } catch {
      /* localStorage indisponible */
    }
    return restoreTabs(raw, active, isNavView) as ViewId[];
  });
  // Ref vers l'onglet actif : navigateCurrentTab (stable) lit la valeur à jour.
  const activeRef = useRef(active);
  activeRef.current = active;
  // Sous-onglet demandé (3e niveau de nav : Media kit → Agence…). Transitoire : posé au
  // clic d'une sous-page, lu par la vue à son montage. Réinitialisé sur toute autre nav.
  const [sub, setSub] = useState<string | null>(null);
  // Volet secondaire (multi-pages côte à côte, desktop) + son menu contextuel.
  const [splitView, setSplitView] = useState<ViewId | null>(() => {
    try {
      const saved = localStorage.getItem("ttp:split");
      // isNavView (et pas seulement VIEWS) → 'roster' est une cible de split valide,
      // donc restaurable après un refresh comme les autres vues.
      if (saved && isNavView(saved)) return saved as ViewId;
    } catch {
      /* localStorage indisponible */
    }
    return null;
  });
  const [ctxMenu, setCtxMenu] = useState<{ id: ViewId; x: number; y: number } | null>(null);
  // Thème mémorisé PAR APPAREIL (avant : jamais sauvegardé → l'app repartait
  // toujours en clair au rechargement). Classe déjà posée par initAccent().
  const [dark, setDark] = useState(() => getThemePref());
  const [mobileTab, setMobileTab] = useState<string | null>(null);
  // Mode iPhone : écran « Plus » ou « Rechercher » affiché par-dessus la page courante.
  const [phoneScreen, setPhoneScreen] = useState<null | "more" | "search">(null);
  const [query, setQuery] = useState("");
  const [detailCreator, setDetailCreator] = useState<string | null>(null);
  // Cache keep-alive : les vues déjà visitées restent MONTÉES (masquées) pour
  // préserver leur état (saisie Media kit, sous-page, scroll) — que la navigation
  // passe par les onglets, la sidebar (qui remplace le contenu de l'onglet) ou le
  // retour d'une fiche. Capé aux plus récentes pour borner la mémoire.
  const [visitedIds, setVisitedIds] = useState<ViewId[]>([]);
  const [space, setSpace] = useState<"agency" | "portal">("agency");
  const [portalCreator, setPortalCreator] = useState<string | null>(null);
  const creators = useCreators();
  // Pages épinglées (dossier « Raccourcis » en haut de la sidebar) — blob agence.
  const { data: pinnedData } = useAppState<ViewId[]>((s: AppState) => (s["pinnedPages"] as ViewId[]) ?? []);
  const [localPins, setLocalPins] = useState<ViewId[] | null>(null);
  const pinned = localPins ?? pinnedData ?? [];
  const togglePin = async (id: ViewId) => {
    invalidateAppState();
    const fresh = ((await getAppState())["pinnedPages"] as ViewId[]) ?? [];
    const next = fresh.includes(id) ? fresh.filter((x) => x !== id) : [...fresh, id];
    setLocalPins(next);
    if (!(await saveAppStateKey("pinnedPages", next))) setLocalPins(fresh);
  };
  const [profile, setProfile] = useState<
    { role: string; creator_name: string | null } | null | undefined
  >(undefined);
  // Chargement du profil : échec persistant après réessais → écran de secours (pas de
  // spinner infini). `profileReload` permet de relancer la tentative depuis l'UI.
  const [profileError, setProfileError] = useState(false);
  const [profileReload, setProfileReload] = useState(0);
  // Niveau agence : 'founder' (Marc & Gianni, accès total) | 'member' (tout sauf
  // Finance & Accès). Défaut 'pending' (non fondateur) : les pages fondateur restent
  // masquées tant que le rôle n'est pas chargé, et aussi en cas d'erreur.
  const [agencyRole, setAgencyRole] = useState<string>("pending");

  // Navigue l'onglet COURANT vers `id` (comme un lien dans Chrome) : remplace la
  // page de l'onglet actif, ou bascule dessus s'il est déjà ouvert.
  const navigateCurrentTab = useCallback((id: ViewId) => {
    setTabs((prev) => navigateTab(prev, activeRef.current, id) as ViewId[]);
    setActive(id);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    setThemePref(dark);
  }, [dark]);

  // Mémorise la page courante pour la rouvrir au prochain refresh.
  useEffect(() => {
    try {
      localStorage.setItem("ttp:view", active);
    } catch {
      /* localStorage indisponible */
    }
  }, [active]);

  // Mémorise la liste d'onglets ouverts.
  useEffect(() => {
    try {
      localStorage.setItem("ttp:tabs", JSON.stringify(tabs));
    } catch {
      /* localStorage indisponible */
    }
  }, [tabs]);

  // Invariant : l'onglet actif fait toujours partie de la liste.
  useEffect(() => {
    setTabs((prev) => (prev.includes(active) ? prev : [...prev, active]));
  }, [active]);

  // Mémorise les vues visitées (cache keep-alive), 8 max.
  useEffect(() => {
    setVisitedIds((prev) => (prev.includes(active) ? prev : [...prev, active].slice(-8)));
  }, [active]);

  // Anti double-montage : jamais la MÊME vue dans les deux volets (évite les ids
  // SVG / compteurs de module dupliqués). Si ça arrive, on ferme le volet droit.
  useEffect(() => {
    if (splitView && splitView === active) setSplitView(null);
  }, [splitView, active]);

  // Mémorise le volet secondaire (ou l'efface quand il est fermé).
  useEffect(() => {
    try {
      if (splitView) localStorage.setItem("ttp:split", splitView);
      else localStorage.removeItem("ttp:split");
    } catch {
      /* localStorage indisponible */
    }
  }, [splitView]);

  // Ferme le menu contextuel sur Échap.
  useEffect(() => {
    if (!ctxMenu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setCtxMenu(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctxMenu]);

  // Navigation déclenchée par une vue (ex. clic sur une échéance brief/to-do dans le Planning).
  useEffect(() => {
    const onNav = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id && isNavView(id)) {
        navigateCurrentTab(id as ViewId);
        setDetailCreator(null);
        setSpace("agency");
        setMobileTab(null);
      }
    };
    window.addEventListener("ttp-navigate", onNav);
    return () => window.removeEventListener("ttp-navigate", onNav);
  }, [navigateCurrentTab]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setSession(s),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  // Rôle de l'utilisateur connecté (agence vs créateur). Clé = id utilisateur (pas
  // l'objet session, renouvelé à chaque rafraîchissement du jeton).
  const uid = session ? session.user.id : session;
  useEffect(() => {
    // Nouvelle session : on repart de zéro → le rôle de l'utilisateur précédent ne
    // fuit jamais et le spinner s'affiche avant la coque.
    setProfile(uid === null ? null : undefined);
    setAgencyRole("pending");
    setTeamSession(null);
    if (!uid) return;
    let alive = true;
    let attempt = 0;
    setProfileError(false);
    const load = () => {
      supabase
        .from("profiles")
        .select("role,creator_name,agency_role")
        .eq("user_id", uid)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!alive) return;
          if (error) {
            console.error("Chargement du profil échoué:", error);
            // Réessais bornés. Sur échec réseau/RLS, NE PAS basculer en « agence » :
            // un créateur atterrirait dans le mauvais espace. On réessaie puis, si
            // l'échec persiste, on montre un écran de secours (Réessayer / Se déconnecter)
            // au lieu d'un spinner infini. Un défaut réseau ne change JAMAIS le rôle.
            if (attempt < 3) {
              attempt += 1;
              setTimeout(load, 800 * attempt);
            } else {
              setProfileError(true);
            }
            return;
          }
          // Ligne absente = compte non rattaché (écran dédié, jamais la coque agence).
          const row = data as { role: string; creator_name: string | null; agency_role?: string | null } | null;
          setAgencyRole(row?.agency_role || "member");
          // Session agence : ses actions préviennent le reste de l'équipe (« qui fait quoi »).
          setTeamSession(row?.role === "agency" ? uid : null);
          setProfile(row ? { role: row.role, creator_name: row.creator_name } : { role: "none", creator_name: null });
        });
    };
    load();
    return () => {
      alive = false;
    };
  }, [uid, profileReload]);

  // Audit de santé auto (matin/soir) : au chargement, si le dernier date de +8 h.
  // Réservé au fondateur (les checks lisent des données finance/RLS).
  useEffect(() => {
    if (profile?.role === "agency" && agencyRole === "founder") void maybeAutoRun();
  }, [profile, agencyRole]);

  const select = (id: ViewId, subId?: string) => {
    navigateCurrentTab(id);
    setSub(subId ?? null); // sous-page ciblée (ou reset si nav normale)
    setMobileTab(null);
    setPhoneScreen(null);
    setQuery("");
    setDetailCreator(null);
    setSpace("agency");
  };
  // Ouvre `id` dans un NOUVEL onglet (ou bascule dessus s'il est déjà ouvert).
  const openInNewTab = (id: ViewId) => {
    setTabs((prev) => addTab(prev, id) as ViewId[]);
    setActive(id);
    setSub(null);
    setMobileTab(null);
    setQuery("");
    setDetailCreator(null);
    setSpace("agency");
  };
  // Ferme un onglet ; si c'était l'actif, bascule sur un voisin.
  const closeTab = (id: ViewId) => {
    const res = closeTabState(tabs, active, id);
    setTabs(res.tabs as ViewId[]);
    if (res.active !== active) setActive(res.active as ViewId);
    if (splitView === id) setSplitView(null);
  };
  const newTab = () => openInNewTab("apercu");
  // Clic sur un onglet : bascule dessus (et referme un éventuel drill-down).
  const switchTab = (id: ViewId) => {
    setActive(id);
    setSub(null);
    setDetailCreator(null);
    setSpace("agency");
  };
  // Clic droit sur un élément du menu (desktop) → menu contextuel.
  const onItemContext = (id: ViewId, e: ReactMouseEvent) => {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 230);
    const y = Math.min(e.clientY, window.innerHeight - 150);
    setCtxMenu({ id, x, y });
  };
  const toggleTheme = () => setDark((d) => !d);
  const logout = () => supabase.auth.signOut();
  const openDetail = (name: string) => {
    setDetailCreator(name);
    setPhoneScreen(null);
  };
  // Navigation depuis la recherche globale : garde la requête pour que la vue
  // cible filtre dessus (contrairement à `select` qui remet à zéro).
  const gotoSearch = (id: ViewId) => {
    navigateCurrentTab(id);
    setDetailCreator(null);
    setSpace("agency");
    setMobileTab(null);
    setPhoneScreen(null);
  };
  const openPortal = (name: string) => {
    setPortalCreator(name);
    setDetailCreator(null);
    setSpace("portal");
  };
  const changeSpace = (s: "agency" | "portal") => {
    setSpace(s);
    setDetailCreator(null);
  };

  // Rôle agence : fondateur = accès total ; membre = tout SAUF Finance & Accès.
  const isFounder = agencyRole === "founder";
  const FOUNDER_ONLY: ViewId[] = ["facturation", "reversements", "relances", "echeances", "acces", "diagnostique", "agent"];
  const hiddenIds = isFounder ? [] : FOUNDER_ONLY;
  const canSee = (id: ViewId) => !hiddenIds.includes(id);
  // Volet secondaire affiché SEULEMENT si la vue est autorisée (un volet restauré du
  // localStorage ne doit jamais montrer une page fondateur à un membre).
  const splitShown = splitView && canSee(splitView) ? splitView : null;

  // Famille « Raccourcis » (pages épinglées) ajoutée en tête de la nav mobile aussi.
  const pinnedNavItems = pinned
    .filter(canSee)
    .map((id) => findPinnable(id))
    .filter((i): i is NavItem => !!i)
    .map((i) => ({ id: i.id, label: i.label, icon: i.icon, children: i.children }));
  const navFiltered = NAV.map((f) => ({ ...f, items: f.items.filter((i) => canSee(i.id)) })).filter((f) => f.items.length > 0);
  const mobileFamilies = pinnedNavItems.length
    ? [{ id: "__pins__", label: "Raccourcis", icon: Star, items: pinnedNavItems }, ...navFiltered]
    : navFiltered;
  const mobileItems = mobileFamilies.map((f) => ({
    id: f.id,
    label: f.label,
    icon: <f.icon className="h-4 w-4" />,
    content: <MobileMenu items={f.items} onSelect={select} />,
  }));

  const { items: notifs, dismiss: dismissNotifs } = useNotifications();
  const title = viewTitle(active);

  // ── Mode iPhone (bêta, téléphone seulement) ──
  const iosOn = useIosUi();
  const isPhone = useIsPhone();
  const iosPhone = iosOn && isPhone;
  const scrollRef = useRef<HTMLDivElement>(null);
  // Onglets du bas : Accueil + 3 pages (les Raccourcis d'abord, sinon les plus utiles) + Plus.
  const tabIds = [...new Set<ViewId>([
    "apercu",
    ...pinned.filter((id) => canSee(id) && !!findPinnable(id)),
    ...(["contacts", "roster", "planning", "mails", "todo"] as ViewId[]).filter(canSee),
  ])].slice(0, 4);
  const iosTabs: IosTab[] = [
    ...tabIds.map((id) => ({ id, label: id === "apercu" ? "Accueil" : findPinnable(id)?.label ?? viewTitle(id), icon: id === "apercu" ? House : findPinnable(id)?.icon ?? Star })),
    { id: "__more", label: "Plus", icon: CircleEllipsis },
  ];
  const iosActive = phoneScreen === "more" ? "__more" : phoneScreen === "search" ? "" : tabIds.includes(active) ? active : "__more";
  // Chaque écran garde sa position de défilement, comme les onglets d'une app iOS.
  const screenKey = phoneScreen ?? (detailCreator ? `d:${detailCreator}` : active);
  const scrollMem = useRef(new Map<string, number>());
  const lastScroll = useRef(0);
  const prevScreen = useRef(screenKey);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!iosPhone || !el || prevScreen.current === screenKey) return;
    scrollMem.current.set(prevScreen.current, lastScroll.current);
    prevScreen.current = screenKey;
    const y = scrollMem.current.get(screenKey) ?? 0;
    el.scrollTop = y;
    lastScroll.current = y;
    if (!y) return;
    // La page peut finir de charger après coup : on reprend la position une fois.
    const t = window.setTimeout(() => { el.scrollTop = y; }, 250);
    return () => window.clearTimeout(t);
  }, [screenKey, iosPhone]);
  const scrollTop = () => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });

  // Pastille sur l'icône de l'app (écran d'accueil iPhone) : nombre de notifications.
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (!nav.setAppBadge) return;
    (notifs.length ? nav.setAppBadge(notifs.length) : nav.clearAppBadge?.())?.catch(() => {});
  }, [notifs.length]);

  if (session === undefined) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!session) return <Login />;
  if (profile === undefined) {
    // Session OK mais profil pas encore chargé. Si les réessais ont tous échoué, on
    // propose une sortie (Réessayer / Se déconnecter) plutôt qu'un spinner sans fin.
    if (profileError) {
      return (
        <div className="grid min-h-screen place-items-center bg-background px-6">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 text-center shadow-sm">
            <p className="text-sm font-semibold text-foreground">Impossible de charger ton espace</p>
            <p className="mt-1 text-xs text-muted-foreground">Vérifie ta connexion internet, puis réessaie.</p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setProfileReload((n) => n + 1)}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                Réessayer
              </button>
              <button
                type="button"
                onClick={logout}
                className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-rowhover"
              >
                Se déconnecter
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Espace CRÉATEUR : vue dédiée quand un créateur se connecte
  if (profile?.role === "creator" && profile.creator_name) {
    return (
      <Suspense fallback={<div className="grid min-h-screen place-items-center bg-background"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
        <CreatorSpace
          name={profile.creator_name}
          dark={dark}
          onToggleTheme={toggleTheme}
          onLogout={logout}
        />
      </Suspense>
    );
  }

  // Compte sans profil, créateur sans nom rattaché ou rôle inconnu : pas de coque agence.
  if (!profile || profile.role !== "agency") {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-6">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-foreground">Compte non rattaché</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Ton compte n'est pas encore relié à un espace. Contacte ton agence pour qu'elle termine la configuration.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setProfileReload((n) => n + 1)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Réessayer
            </button>
            <button
              type="button"
              onClick={logout}
              className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-rowhover"
            >
              Se déconnecter
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Portail créateur (mode agence) : on rend le VRAI espace créateur en PLEIN ÉCRAN
  // (mêmes onglets/données via RLS agence) avec une bannière de sortie + un sélecteur.
  // → visualiser l'espace d'un créateur sans se déconnecter.
  if (space === "portal") {
    const pc = portalCreator ?? creators[0]?.name ?? null;
    if (!pc) {
      return (
        <div className="grid min-h-screen place-items-center bg-background p-6 text-center">
          <div>
            <p className="text-sm text-muted-foreground">Aucun créateur dans le roster.</p>
            <button type="button" onClick={() => setSpace("agency")} className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90">
              Retour à l'espace agence
            </button>
          </div>
        </div>
      );
    }
    return (
      <Suspense fallback={<div className="grid min-h-screen place-items-center bg-background"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
        <CreatorSpace
          name={pc}
          dark={dark}
          onToggleTheme={toggleTheme}
          onLogout={logout}
          preview={{ onExit: () => setSpace("agency"), onPick: setPortalCreator, creators }}
        />
      </Suspense>
    );
  }

  // Barre du haut (recherche + profil + notifs + thème) — partagée normal/split.
  const topBar = (
    <header className="flex items-center gap-4 px-4 pt-5 md:px-6">
      {/* mobile logo */}
      <div className="flex items-center gap-2 md:hidden">
        <div className="h-8 w-8 overflow-hidden rounded-lg bg-[#14181E]">
          <img src={`${BASE}cover.png`} alt="TTP" className="h-full w-full object-cover" />
        </div>
      </div>
      {/* recherche globale (filtre + navigation) */}
      <GlobalSearch query={query} setQuery={setQuery} onOpenCreator={openDetail} onGoto={gotoSearch} hidden={hiddenIds} />
      {/* right cluster */}
      <div className="ml-auto flex shrink-0 items-center gap-2.5">
        {/* Carte profil : tablette seulement (sur ordinateur, elle est en bas de la sidebar) */}
        <div className="hidden items-center gap-2.5 rounded-lg bg-surface py-1.5 pl-2 pr-3.5 sm:flex md:hidden">
          <AgencyAvatar userId={session.user.id} />
          <div className="leading-tight">
            <div className="whitespace-nowrap text-xs font-medium text-foreground"><MyName userId={session.user.id} fallback="Marc & Gianni" /></div>
            <div className="whitespace-nowrap text-[10px] text-faint">Direction · TTP</div>
          </div>
        </div>
        <Notifications items={notifs} onDismiss={dismissNotifs} />
        {/* Thème : desktop uniquement (sur mobile → Paramètres → Apparence, gain de place) */}
        <button
          type="button"
          onClick={toggleTheme}
          className="hidden h-10 w-10 place-items-center rounded-lg bg-surface text-foreground shadow-sm transition-colors hover:bg-rowhover md:grid"
          aria-label="Basculer le thème"
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );

  // Contenu principal (portail / fiche créateur / vue nav). Sans le <h1> ni la
  // barrière : chaque volet ajoute sa propre ErrorBoundary autour.
  const accessDenied = (
    <div className="grid h-full place-items-center p-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-panel text-muted-foreground"><LogOut className="h-5 w-5" /></div>
        <p className="text-sm font-semibold text-foreground">Accès réservé aux fondateurs</p>
        <p className="mt-1 text-xs text-muted-foreground">Cette section (Finance / Accès) n'est pas accessible à ton profil. Contacte Marc ou Gianni si tu penses que c'est une erreur.</p>
      </div>
    </div>
  );
  const mainInner =
    detailCreator ? (
      <CreatorDetail name={detailCreator} onBack={() => setDetailCreator(null)} onOpenPortal={openPortal} />
    ) : !canSee(active) ? (
      accessDenied
    ) : (
      <NavSubContext.Provider value={sub}>
        <ViewContent active={active} onOpenCreator={openDetail} />
      </NavSubContext.Provider>
    );
  // (Le mode portail a déjà fait un return anticipé plus haut : ici space === "agency".)
  const primaryTitle = detailCreator ?? (canSee(active) ? title : "Accès réservé");
  const showPrimaryH1 = !detailCreator && active !== "apercu";
  // Multi-pages actif dès qu'il y a ≥ 2 onglets ou un volet latéral.
  // (Mode iPhone : toujours une seule page à la fois, comme une app.)
  const multi = !iosPhone && (tabs.length > 1 || splitShown != null);
  // Overlay = fiche créateur (rendue PAR-DESSUS les vues nav, qui restent montées
  // en dessous pour ne pas perdre leur état).
  const overlayActive = !!detailCreator;
  // Vues gardées montées = onglets ouverts ∪ vues récemment visitées (jamais une
  // vue réservée aux fondateurs pour un membre).
  const aliveIds = [...new Set<ViewId>([...tabs, ...visitedIds])].filter(canSee);

  return (
    <ThemeContext.Provider value={{ dark, toggle: toggleTheme }}>
    <SearchContext.Provider value={{ query, setQuery }}>
    <NavSubSetContext.Provider value={setSub}>
      <div className={iosPhone ? "h-[100dvh] bg-panel" : "h-[100dvh] bg-background p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] md:p-[14px] md:pt-[14px] md:pb-[14px]"}>
        <div className={cn("flex h-full overflow-hidden", !iosPhone && "rounded-[22px]")}>
          {/* Desktop sidebar */}
          <div className="hidden h-full md:block">
            <Sidebar
              active={active}
              activeSub={sub}
              onSelect={select}
              onLogout={logout}
              space={space}
              onSpaceChange={changeSpace}
              onItemContext={onItemContext}
              pinned={pinned.filter(canSee)}
              onTogglePin={togglePin}
              hidden={hiddenIds}
              userId={session.user.id}
              onItemSplit={(id) => {
                if (id !== active) setSplitView(id);
              }}
            />
          </div>

          {/* Main panel */}
          <div className={cn("shell-panel flex min-w-0 flex-1 flex-col overflow-hidden bg-panel", !iosPhone && "rounded-[22px]")}>
            {!multi ? (
              /* Une seule page : mise en page d'origine (l'en-tête défile avec le contenu). */
              <div
                ref={scrollRef}
                onScroll={iosPhone ? (e) => { lastScroll.current = e.currentTarget.scrollTop; } : undefined}
                className={cn("flex-1 overflow-y-auto md:pb-7", iosPhone ? "pb-[calc(env(safe-area-inset-bottom)+5.5rem)]" : "pb-28")}
              >
                {iosPhone ? (
                  <IosNavBar
                    scrollRef={scrollRef}
                    title={phoneScreen === "more" ? "Plus" : phoneScreen === "search" ? "Rechercher" : primaryTitle}
                    left={
                      phoneScreen ? null
                        : detailCreator ? <IosBackButton label={title} onClick={() => setDetailCreator(null)} />
                        : !tabIds.includes(active) ? <IosBackButton label="Plus" onClick={() => setPhoneScreen("more")} />
                        : null
                    }
                    right={
                      phoneScreen === "search" ? (
                        <button type="button" onClick={() => { setPhoneScreen(null); setQuery(""); }} className="h-11 px-3 text-[17px] text-primary">Annuler</button>
                      ) : (
                        <>
                          <IosBarIcon icon={Search} label="Rechercher" onClick={() => setPhoneScreen("search")} />
                          <Notifications items={notifs} onDismiss={dismissNotifs} variant="bar" />
                        </>
                      )
                    }
                  />
                ) : (
                  topBar
                )}
                <main className={cn("px-4 md:px-6", iosPhone ? "pt-1" : "pt-5")}>
                  <ErrorBoundary variant="inline" label="Cette page" resetKey={`${space}:${detailCreator ?? ""}:${active}:${phoneScreen ?? ""}`}>
                    <Suspense fallback={PANE_FALLBACK}>
                      {iosPhone && phoneScreen === "more" ? (
                        <PageFrame title="Plus">
                          <MoreScreen
                            profile={{
                              avatar: <AgencyAvatar userId={session.user.id} readOnly className="h-[54px] w-[54px]" rounded="rounded-full" />,
                              name: <MyName userId={session.user.id} fallback="Marc & Gianni" />,
                              sub: isFounder ? "Direction · TTP" : "Équipe · TTP",
                              onClick: () => select("parametres"),
                            }}
                            pinned={pinnedNavItems}
                            sections={navFiltered.map((f) => ({ id: f.id, label: f.label, items: f.items }))}
                            onSelect={(id, subId) => select(id as ViewId, subId)}
                            dark={dark}
                            onToggleTheme={toggleTheme}
                            onExit={logout}
                          />
                        </PageFrame>
                      ) : iosPhone && phoneScreen === "search" ? (
                        <PageFrame title="Rechercher">
                          <GlobalSearch inline autoFocus query={query} setQuery={setQuery} onOpenCreator={openDetail} onGoto={gotoSearch} hidden={hiddenIds} />
                        </PageFrame>
                      ) : showPrimaryH1 ? (
                        <PageFrame title={title}>{mainInner}</PageFrame>
                      ) : (
                        mainInner
                      )}
                    </Suspense>
                  </ErrorBoundary>
                </main>
              </div>
            ) : (
              /* Multi-pages : barre du haut + onglets fixes, contenu défilant. */
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="shrink-0">{topBar}</div>
                <TabBar tabs={tabs} active={active} onSelect={switchTab} onClose={closeTab} onNew={newTab} />
                {splitShown ? (
                  /* Deux volets côte à côte, défilement + barrière d'erreur indépendants. */
                  <div className="flex min-h-0 flex-1 flex-col md:flex-row">
                    {/* Volet principal (onglet actif) */}
                    <section className="flex min-w-0 flex-1 flex-col overflow-hidden md:border-r md:border-border">
                      <PaneHeader title={primaryTitle} />
                      <div className="flex-1 overflow-y-auto px-4 pb-24 pt-4 md:px-6 md:pb-6">
                        <ErrorBoundary variant="inline" label="Ce volet" resetKey={`main:${space}:${detailCreator ?? ""}:${active}`}>
                          <Suspense fallback={PANE_FALLBACK}>{mainInner}</Suspense>
                        </ErrorBoundary>
                      </div>
                    </section>
                    {/* Volet secondaire (à côté) */}
                    <section className="flex min-w-0 flex-1 flex-col overflow-hidden border-t border-border md:border-t-0">
                      <PaneHeader title={findPinnable(splitShown)?.label ?? viewTitle(splitShown)} onClose={() => setSplitView(null)} />
                      <div className="flex-1 overflow-y-auto px-4 pb-24 pt-4 md:px-6 md:pb-6">
                        <ErrorBoundary variant="inline" label="Ce volet" resetKey={`split:${splitShown}`}>
                          <Suspense fallback={PANE_FALLBACK}>
                            {/* Volet secondaire : n'écrit pas le sous-onglet global (sidebar = volet principal). */}
                            <NavSubSetContext.Provider value={() => {}}>
                              <NavSubContext.Provider value={null}>
                                <ViewContent active={splitShown} onOpenCreator={openDetail} />
                              </NavSubContext.Provider>
                            </NavSubSetContext.Provider>
                          </Suspense>
                        </ErrorBoundary>
                      </div>
                    </section>
                  </div>
                ) : (
                  /* ≥ 2 onglets, un seul visible. TOUS les onglets nav restent MONTÉS
                     (masqués via `hidden`) — même quand une fiche/portail s'ouvre par
                     dessus — pour préserver leur état (saisie Media kit, sous-page,
                     scroll) au changement d'onglet ET à l'ouverture d'une fiche. */
                  <div className="flex-1 overflow-y-auto pb-24 md:pb-7">
                    <main className="px-4 pt-5 md:px-6">
                      {aliveIds.map((id) => {
                        const tabTitle = viewTitle(id);
                        return (
                          <div key={id} hidden={overlayActive || id !== active}>
                            <ErrorBoundary variant="inline" label="Cette page" resetKey={`tab:${id}`}>
                              <Suspense fallback={PANE_FALLBACK}>
                                <NavSubContext.Provider value={id === active ? sub : null}>
                                  {id !== "apercu" ? (
                                    <PageFrame title={tabTitle}>
                                      <ViewContent active={id} onOpenCreator={openDetail} />
                                    </PageFrame>
                                  ) : (
                                    <ViewContent active={id} onOpenCreator={openDetail} />
                                  )}
                                </NavSubContext.Provider>
                              </Suspense>
                            </ErrorBoundary>
                          </div>
                        );
                      })}
                      {/* Onglet réservé aux fondateurs (non monté pour un membre) : message au lieu d'une page vide */}
                      {!overlayActive && !canSee(active) && accessDenied}
                      {overlayActive && (
                        <ErrorBoundary variant="inline" label="Cette page" resetKey={`${space}:${detailCreator ?? ""}`}>
                          <Suspense fallback={PANE_FALLBACK}>{mainInner}</Suspense>
                        </ErrorBoundary>
                      )}
                    </main>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Mode iPhone : barre d'onglets en bas */}
        {iosPhone && (
          <IosTabBar
            items={iosTabs}
            active={iosActive}
            onSelect={(id) => (id === "__more" ? setPhoneScreen("more") : select(id as ViewId))}
            onReselect={(id) => {
              // Comme iOS : retoucher l'onglet ouvert revient à sa racine, puis en haut.
              if (id === "__more" && phoneScreen !== "more") setPhoneScreen("more");
              else if (detailCreator) setDetailCreator(null);
              else scrollTop();
            }}
          />
        )}
        {/* Mobile bottom nav */}
        <div className={cn("pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center md:hidden", iosPhone && "hidden")}>
          <div className="pointer-events-auto">
            <ExpandableTabs
              items={mobileItems}
              value={mobileTab}
              onValueChange={setMobileTab}
            />
          </div>
        </div>

        {/* Menu contextuel (clic droit sur un élément du menu, desktop) */}
        {ctxMenu && (
          <div
            className="fixed inset-0 z-[1200]"
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu(null);
            }}
          >
            <div
              className="absolute min-w-[210px] overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-xl"
              style={{ top: ctxMenu.y, left: ctxMenu.x }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="truncate px-3 py-1.5 text-[12px] font-medium text-muted-foreground">
                {findPinnable(ctxMenu.id)?.label}
              </div>
              <button
                type="button"
                onClick={() => {
                  select(ctxMenu.id);
                  setCtxMenu(null);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-rowhover"
              >
                <SquareArrowRight className="h-4 w-4 text-faint" /> Ouvrir
              </button>
              <button
                type="button"
                onClick={() => {
                  openInNewTab(ctxMenu.id);
                  setCtxMenu(null);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-rowhover"
              >
                <Plus className="h-4 w-4 text-faint" /> Ouvrir dans un nouvel onglet
              </button>
              <button
                type="button"
                onClick={() => {
                  togglePin(ctxMenu.id);
                  setCtxMenu(null);
                }}
                className="flex w-full items-center gap-2.5 border-t border-border px-3 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-rowhover"
              >
                {pinned.includes(ctxMenu.id)
                  ? <><PinOff className="h-4 w-4 text-faint" /> Détacher des raccourcis</>
                  : <><Pin className="h-4 w-4 text-faint" /> Épingler aux raccourcis</>}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (ctxMenu.id !== active) setSplitView(ctxMenu.id);
                  setCtxMenu(null);
                }}
                className="flex w-full items-center gap-2.5 border-t border-border px-3 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-rowhover"
              >
                <Columns2 className="h-4 w-4 text-faint" /> Ouvrir à côté
              </button>
              {splitView && (
                <button
                  type="button"
                  onClick={() => {
                    setSplitView(null);
                    setCtxMenu(null);
                  }}
                  className="flex w-full items-center gap-2.5 border-t border-border px-3 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-rowhover"
                >
                  <X className="h-4 w-4 text-faint" /> Fermer le volet de droite
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <Toaster />
      <UndoSendBar />
    </NavSubSetContext.Provider>
    </SearchContext.Provider>
    </ThemeContext.Provider>
  );
}
