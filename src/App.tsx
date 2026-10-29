import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useState, useRef, useCallback, type ComponentType, type MouseEvent as ReactMouseEvent } from "react";
import { lazyImport } from "@/lib/appUpdate";
import { SIGNATURE_KEY, setCurrentSignature, validSig } from "@/lib/agencySignature";
import { Loader } from "@/components/ui/loader";
import { Moon, Sun, X, Columns2, SquareArrowRight, Plus, LogOut, Star, StarOff, Trash2, Eye } from "@/components/icons";
import { cn, titleCase } from "@/lib/utils";
import { restoreTabs, navigateTab, addTab, closeTab as closeTabState } from "@/lib/tabs";
import type { Session } from "@supabase/supabase-js";
import { GlobalSearch } from "@/components/GlobalSearch";
import { TtpHome, TtpMore, TtpSearch, TtpStar } from "@/components/icons/ttp-icons";
import { CommandPalette } from "@/components/CommandPalette";
import { openCommandPalette } from "@/lib/commandPalette";
import { RestrictedViewsContext } from "@/lib/restrictedViews";
import { Toaster, toast } from "@/components/ui/toast";
import { consumeIgReturn } from "@/lib/instagram";
import { UndoSendBar } from "@/components/ui/undo-send";
import { Notifications } from "@/components/ui/notifications";
import { useNotifications } from "@/lib/useNotifications";
import { useNavBadges } from "@/lib/useNavBadges";
import { useActivityEvents } from "@/lib/useActivityEvents";
import { markNavSeen } from "@/lib/navSeen";
import { useCreators } from "@/lib/useCreators";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { DEFAULT_HIDDEN_PAGES, HIDDEN_PAGES_EVENT, hiddenPagesOf } from "@/lib/hiddenPages";
import { maybeAutoRun } from "@/lib/diagnostics";
import { applyTheme, getThemeChoice, resolveTheme, setThemeChoice, type ResolvedTheme, type ThemeChoice } from "@/lib/accent";
import { Sidebar } from "@/components/Sidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PageFrame } from "@/components/ui/page-header";
import { VIEW_HINTS } from "@/lib/viewHints";
import { Login } from "@/components/Login";
import { FAVORIS_BASE, FAVORIS_ID, MAX_PINS, NAV, findItem, findPinnable, viewTitle, withFavorites, type NavFamily, type NavItem, type ViewId } from "@/lib/nav";
import { NavSubContext, NavSubSetContext } from "@/lib/navSub";
import { setTeamSession } from "@/lib/team";
import { supabase } from "@/lib/supabase";
import { SearchContext } from "@/lib/search";
import { ThemeContext } from "@/lib/theme";
import { AgencyAvatar, MyName } from "@/components/ui/agency-avatar";
import { useIsPhone } from "@/lib/iosUi";
import { NavActionSlotContext } from "@/lib/navAction";
import { IosBackButton, IosBarIcon, IosGroup, IosNavBar, IosRow, IosTabBar, type IosTab } from "@/components/mobile/ios-shell";
import { MoreScreen } from "@/components/mobile/more-screen";
import { PullToRefresh } from "@/components/mobile/pull-to-refresh";
import { OfflineBanner } from "@/components/mobile/offline-banner";
import { onDeepLink, setCurrentPlace, takeDeepLink } from "@/lib/deepLink";
import { requestIntent } from "@/lib/openIntent";
import { collabTabRedirect } from "@/lib/collabTabs";
import { useAppBadge, useCloseMailNotifications } from "@/lib/appBadge";

// Vues chargées à la demande (code-splitting → démarrage plus léger, mobile compris).
const RosterTabs = lazy(lazyImport(() => import("@/views/RosterTabs").then((m) => ({ default: m.RosterTabs }))));
const Aujourdhui = lazy(lazyImport(() => import("@/views/Aujourdhui").then((m) => ({ default: m.Aujourdhui }))));
const Stats = lazy(lazyImport(() => import("@/views/Stats").then((m) => ({ default: m.Stats }))));
const Facturation = lazy(lazyImport(() => import("@/views/Facturation").then((m) => ({ default: m.Facturation }))));
const Briefs = lazy(lazyImport(() => import("@/views/Briefs").then((m) => ({ default: m.Briefs }))));
const Collabs = lazy(lazyImport(() => import("@/views/Collabs").then((m) => ({ default: m.Collabs }))));
const AgentView = lazy(lazyImport(() => import("@/views/Agent").then((m) => ({ default: m.AgentView }))));
const WhatsappView = lazy(lazyImport(() => import("@/views/Whatsapp").then((m) => ({ default: m.WhatsappView }))));
const Gifting = lazy(lazyImport(() => import("@/views/Gifting").then((m) => ({ default: m.Gifting }))));
const Idees = lazy(lazyImport(() => import("@/views/Idees").then((m) => ({ default: m.Idees }))));
const Todo = lazy(lazyImport(() => import("@/views/Todo").then((m) => ({ default: m.Todo }))));
const Planning = lazy(lazyImport(() => import("@/views/Planning").then((m) => ({ default: m.Planning }))));
const Documents = lazy(lazyImport(() => import("@/views/Documents").then((m) => ({ default: m.Documents }))));
const Contacts = lazy(lazyImport(() => import("@/views/Contacts").then((m) => ({ default: m.Contacts }))));
const Mails = lazy(lazyImport(() => import("@/views/Mails").then((m) => ({ default: m.Mails }))));
const Contrats = lazy(lazyImport(() => import("@/views/Contrats").then((m) => ({ default: m.Contrats }))));
const Prospection = lazy(lazyImport(() => import("@/views/Prospection").then((m) => ({ default: m.Prospection }))));
const Vivier = lazy(lazyImport(() => import("@/views/Vivier").then((m) => ({ default: m.Vivier }))));
const Sourcing = lazy(lazyImport(() => import("@/views/Sourcing").then((m) => ({ default: m.Sourcing }))));
const Messages = lazy(lazyImport(() => import("@/views/Messages").then((m) => ({ default: m.Messages }))));
const Acces = lazy(lazyImport(() => import("@/views/Acces").then((m) => ({ default: m.Acces }))));
const Objectifs = lazy(lazyImport(() => import("@/views/Objectifs").then((m) => ({ default: m.Objectifs }))));
const Debrief = lazy(lazyImport(() => import("@/views/Debrief").then((m) => ({ default: m.Debrief }))));
const Checklist = lazy(lazyImport(() => import("@/views/Checklist").then((m) => ({ default: m.Checklist }))));
const Mediakit = lazy(lazyImport(() => import("@/views/Mediakit").then((m) => ({ default: m.Mediakit }))));
const Templates = lazy(lazyImport(() => import("@/views/Templates").then((m) => ({ default: m.Templates }))));
const CreatorDetail = lazy(lazyImport(() => import("@/views/CreatorDetail").then((m) => ({ default: m.CreatorDetail }))));
const CreatorSpace = lazy(lazyImport(() => import("@/views/CreatorSpace").then((m) => ({ default: m.CreatorSpace }))));
const Corbeille = lazy(lazyImport(() => import("@/views/Corbeille").then((m) => ({ default: m.Corbeille }))));
const Activite = lazy(lazyImport(() => import("@/views/Activite").then((m) => ({ default: m.Activite }))));
const Reversements = lazy(lazyImport(() => import("@/views/Reversements").then((m) => ({ default: m.Reversements }))));
const Compta = lazy(lazyImport(() => import("@/views/Compta").then((m) => ({ default: m.Compta }))));
const Relances = lazy(lazyImport(() => import("@/views/Relances").then((m) => ({ default: m.Relances }))));
const Echeances = lazy(lazyImport(() => import("@/views/Echeances").then((m) => ({ default: m.Echeances }))));
const Exclusivites = lazy(lazyImport(() => import("@/views/Exclusivites").then((m) => ({ default: m.Exclusivites }))));
const Parametres = lazy(lazyImport(() => import("@/views/Parametres").then((m) => ({ default: m.Parametres }))));
const Diagnostique = lazy(lazyImport(() => import("@/views/Diagnostique").then((m) => ({ default: m.Diagnostique }))));
const EngagementSuivi = lazy(lazyImport(() => import("@/views/EngagementSuivi").then((m) => ({ default: m.EngagementSuivi }))));
const Engagement = lazy(lazyImport(() => import("@/views/Engagement").then((m) => ({ default: m.Engagement }))));
const Pricing = lazy(lazyImport(() => import("@/views/Pricing").then((m) => ({ default: m.Pricing }))));


const VIEWS: Partial<Record<ViewId, ComponentType>> = {
  aujourdhui: Aujourdhui,
  agent: AgentView,
  stats: Stats,
  facturation: Facturation,
  reversements: Reversements,
  compta: Compta,
  relances: Relances,
  echeances: Echeances,
  exclusivites: Exclusivites,
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
  sourcing: Sourcing,
  messages: Messages,
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
  pricing: Pricing,
  corbeille: Corbeille,
  activite: Activite,
};

// `roster` est une vue valide gérée à part (pas dans VIEWS). hasOwn : `in`
// traverserait la chaîne de prototypes ("constructor"… passerait).
const isNavView = (id: string) => Object.hasOwn(VIEWS, id) || id === "roster";

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
        <div className="mt-3 text-sm font-medium">Page introuvable</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Elle a peut-être été renommée : choisis une page dans le menu.
        </div>
      </div>
    </div>
  );
}

/** Vues sans en-tête de page posé par App (elles affichent leur propre titre, ou aucun). */
const NO_PAGE_HEADER: ViewId[] = ["mails", "parametres"];

const PANE_FALLBACK = (
  <div className="grid min-h-[50vh] place-items-center">
    <Loader variant="dot-matrix" size={26} className="text-muted-foreground" />
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
          className="ml-auto grid h-9 w-9 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground"
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
        className="ml-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground"
        title="Nouvel onglet"
        aria-label="Nouvel onglet"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Tient à jour la signature de l'agence que posent les contrats (lib/agencySignature.ts). */
function AgencySignatureSync() {
  const { data } = useAppState<unknown>((st) => st[SIGNATURE_KEY] ?? null);
  useEffect(() => setCurrentSignature(validSig(data)), [data]);
  return null;
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [active, setActive] = useState<ViewId>(() => {
    // Restaure la dernière page ouverte (évite de retomber sur l'accueil à chaque refresh).
    try {
      const saved = localStorage.getItem("ttp:view");
      if (saved && isNavView(saved)) return saved as ViewId;
    } catch {
      /* localStorage indisponible */
    }
    return "aujourdhui";
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
  // Sous-onglet demandé (3e niveau de nav : Media kit → Agence…). Posé au clic d'une
  // sous-page, lu par la vue à son montage, réinitialisé sur toute autre nav. Mémorisé avec
  // sa page : après un rechargement, on rouvre la même sous-page (Contrats → Représentation…).
  const [sub, setSub] = useState<string | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("ttp:sub") ?? "null") as { view?: string; sub?: string } | null;
      return saved?.view === active && typeof saved.sub === "string" ? saved.sub : null;
    } catch {
      return null; // stockage indisponible ou valeur illisible
    }
  });
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
  // Thème mémorisé PAR APPAREIL (Clair, Verre, Noir ou Auto), déjà posé par initAccent().
  const [theme, setTheme] = useState<ThemeChoice>(() => getThemeChoice());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(getThemeChoice()));
  const dark = resolved === "noir";
  // Dernier thème clair choisi (Clair ou Verre) : le bouton soleil y revient depuis Noir.
  const lastLight = useRef<"clair" | "verre">(theme === "verre" ? "verre" : "clair");
  // Mode iPhone : écran « Plus » ou « Rechercher » affiché par-dessus la page courante.
  const [phoneScreen, setPhoneScreen] = useState<null | "more" | "search">(null);
  // Emplacement du « + » de la page dans la barre de titre (iPhone).
  const [navSlot, setNavSlot] = useState<HTMLElement | null>(null);
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
  // Ordre de la section Favoris (glisser-déposer), partagé comme les favoris.
  const { data: favOrderData } = useAppState<string[]>((s: AppState) => (s["favoritesOrder"] as string[]) ?? []);
  const [localFavOrder, setLocalFavOrder] = useState<string[] | null>(null);
  const favOrder = localFavOrder ?? favOrderData ?? [];
  const saveFavOrder = async (ids: string[]) => {
    const before = favOrder;
    setLocalFavOrder(ids);
    if (!(await saveAppStateKey("favoritesOrder", ids))) {
      setLocalFavOrder(before);
      toast("Ordre non enregistré, réessaie");
    }
  };
  const togglePin = async (id: ViewId) => {
    invalidateAppState();
    const fresh = ((await getAppState())["pinnedPages"] as ViewId[]) ?? [];
    if (!fresh.includes(id) && fresh.length >= MAX_PINS) {
      toast(`${MAX_PINS} favoris au plus : retire d'abord une étoile`);
      return;
    }
    const next = fresh.includes(id) ? fresh.filter((x) => x !== id) : [...fresh, id];
    setLocalPins(next);
    if (!(await saveAppStateKey("pinnedPages", next))) setLocalPins(fresh);
  };
  // Pages rangées (Paramètres → « Pages affichées ») : hors du menu, de la recherche et des
  // raccourcis, mais toujours ouvrables. Paramètres prévient tout de suite par un événement.
  const { data: parkedData } = useAppState<ViewId[]>(hiddenPagesOf);
  const [localParked, setLocalParked] = useState<ViewId[] | null>(null);
  useEffect(() => {
    const on = (e: Event) => setLocalParked((e as CustomEvent<ViewId[]>).detail);
    window.addEventListener(HIDDEN_PAGES_EVENT, on);
    return () => window.removeEventListener(HIDDEN_PAGES_EVENT, on);
  }, []);
  const parked = localParked ?? parkedData ?? DEFAULT_HIDDEN_PAGES;
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
  const navigateCurrentTab = useCallback((target: ViewId) => {
    // Gifting et Pipeline vivent dans Collabs (onglets) : on y ouvre le bon onglet.
    const r = collabTabRedirect(target);
    if (r) requestIntent("collabs:tab", r.tab);
    const id = (r?.view ?? target) as ViewId;
    setTabs((prev) => navigateTab(prev, activeRef.current, id) as ViewId[]);
    setActive(id);
  }, []);

  useEffect(() => {
    setThemeChoice(theme);
    if (theme === "clair" || theme === "verre") lastLight.current = theme;
    const sync = () => {
      const r = resolveTheme(theme);
      setResolved(r);
      applyTheme(r);
    };
    sync();
    if (theme !== "auto") return;
    // Auto : suit l'appareil en direct (passage jour/nuit).
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [theme]);

  // Retour de la connexion Instagram d'une créatrice faite depuis sa fiche (ig-callback).
  useEffect(() => {
    const back = consumeIgReturn();
    if (back) toast(back === "connected" ? "Instagram connecté ✓ Ses stats arrivent toutes seules" : "Connexion Instagram annulée");
  }, []);

  // Mémorise la page courante pour la rouvrir au prochain refresh.
  useEffect(() => {
    try {
      localStorage.setItem("ttp:view", active);
    } catch {
      /* localStorage indisponible */
    }
  }, [active]);

  // Mémorise la sous-page de la page courante.
  useEffect(() => {
    try {
      if (sub) localStorage.setItem("ttp:sub", JSON.stringify({ view: active, sub }));
      else localStorage.removeItem("ttp:sub");
    } catch {
      /* localStorage indisponible */
    }
  }, [active, sub]);

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
      }
    };
    window.addEventListener("ttp-navigate", onNav);
    return () => window.removeEventListener("ttp-navigate", onNav);
  }, [navigateCurrentTab]);

  useEffect(() => {
    let hadSession = false;
    supabase.auth.getSession().then(({ data }) => {
      hadSession ||= !!data.session;
      setSession(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      // Déconnexion : on recharge l'app. Les mémoires partagées (blob agence, pages gardées
      // en cache, factures de la palette…) ne passent jamais au compte suivant, sur un
      // appareil partagé (agence puis créateur, fondateur puis membre).
      if (e === "SIGNED_OUT" && hadSession) {
        window.location.reload();
        return;
      }
      hadSession ||= !!s;
      setSession(s);
    });
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
    setPhoneScreen(null);
    setQuery("");
    setDetailCreator(null);
    setSpace("agency");
  };
  // Ouvre `id` dans un NOUVEL onglet (ou bascule dessus s'il est déjà ouvert).
  const openInNewTab = (target: ViewId) => {
    const r = collabTabRedirect(target);
    if (r) requestIntent("collabs:tab", r.tab);
    const id = (r?.view ?? target) as ViewId;
    setTabs((prev) => addTab(prev, id) as ViewId[]);
    setActive(id);
    setSub(null);
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
  const newTab = () => openInNewTab("aujourdhui");
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
  const toggleTheme = () => setTheme(dark ? lastLight.current : "noir");
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
  const FOUNDER_ONLY: ViewId[] = ["facturation", "reversements", "compta", "relances", "echeances", "acces", "diagnostique", "agent"];
  const hiddenIds = isFounder ? [] : FOUNDER_ONLY;
  const canSee = (id: ViewId) => !hiddenIds.includes(id);
  // Dans les menus : ni les pages fondateur (pour un membre), ni les pages rangées.
  const navHidden = [...hiddenIds, ...parked];
  const inNav = (id: ViewId) => !navHidden.includes(id);
  // Volet secondaire affiché SEULEMENT si la vue est autorisée (un volet restauré du
  // localStorage ne doit jamais montrer une page fondateur à un membre).
  const splitShown = splitView && canSee(splitView) ? splitView : null;

  // Pages mises en favoris : ajoutées à la section Favoris (menu et écran « Plus »).
  const pinnedNavItems = pinned
    .filter(inNav)
    .map((id) => findPinnable(id))
    .filter((i): i is NavItem => !!i)
    .map((i): NavItem => ({ id: i.id, label: i.label, icon: i.icon }));
  const navFiltered = withFavorites<NavItem, NavFamily>(
    NAV.map((f) => ({ ...f, items: f.items.filter((i) => inNav(i.id)) })).filter((f) => f.items.length > 0),
    pinnedNavItems,
    (items) => ({ id: FAVORIS_ID, label: "Favoris", icon: Star, fixed: true, items }),
  );

  const { items: notifs, dismiss: dismissNotifs } = useNotifications();
  // Pastilles du menu, des onglets iPhone et de l'écran « Plus » : nouveautés pas encore
  // vues + choses à traiter, par page. Une page ouverte compte comme vue (à l'ouverture,
  // en la quittant et quand l'app passe en arrière-plan).
  const seenUid = session?.user.id;
  const viewing = useMemo(() => [active, splitShown].filter((x): x is ViewId => !!x), [active, splitShown]);
  const navBadgesBase = useNavBadges(seenUid, notifs, viewing);
  // + objets sur lesquels un créateur a écrit (tâches, idées, briefs, mails) : repères
  // « nouveau » écrits par la base (activity_events), effacés à l'ouverture de l'objet.
  const activity = useActivityEvents("agency", profile?.role === "agency");
  const navBadges = useMemo(() => {
    const out: Record<string, number> = { ...navBadgesBase };
    for (const [page, n] of Object.entries(activity.counts)) out[page] = (out[page] ?? 0) + n;
    return out;
  }, [navBadgesBase, activity.counts]);
  const viewingKey = viewing.join("|");
  useEffect(() => {
    if (!seenUid) return;
    const pages = viewingKey.split("|");
    markNavSeen(pages);
    const onHide = () => {
      if (document.visibilityState === "hidden") markNavSeen(pages);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      markNavSeen(pages);
    };
  }, [seenUid, viewingKey]);
  const title = viewTitle(active);

  // ── Affichage iPhone (téléphone) ──
  const iosPhone = useIsPhone();
  const scrollRef = useRef<HTMLDivElement>(null);
  // Onglets du bas : Accueil (Aujourd'hui) + 3 pages (les favoris ajoutés d'abord, sinon ceux de Favoris : To-do, Mails, Collabs) + Plus.
  const tabIds = [...new Set<ViewId>([
    "aujourdhui",
    ...pinned.filter((id) => inNav(id) && !!findPinnable(id)),
    ...(["todo", "mails", "collabs", "planning", "contacts"] as ViewId[]).filter(inNav),
  ])].slice(0, 4);
  const iosTabs: IosTab[] = [
    ...tabIds.map((id) => ({ id, label: id === "aujourdhui" ? "Accueil" : findPinnable(id)?.label ?? viewTitle(id), icon: id === "aujourdhui" ? TtpHome : findPinnable(id)?.icon ?? TtpStar, badge: navBadges[id] })),
    // « Plus » : les notifications des pages qui n'ont pas leur onglet.
    { id: "__more", label: "Plus", icon: TtpMore, badge: Object.entries(navBadges).reduce((n, [id, c]) => (tabIds.includes(id as ViewId) || !inNav(id as ViewId) ? n : n + c), 0) },
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

  // Pastille sur l'icône de l'app (écran d'accueil iPhone) : nombre de notifications de
  // la cloche, remise au bon chiffre au retour au premier plan (le service worker l'augmente
  // à chaque push reçu app fermée). Côté créateur, c'est l'espace créateur qui la tient.
  const isAgency = profile?.role === "agency";
  useAppBadge(notifs.length, isAgency);

  // Notifications de mails : ouvrir Mails les retire (comme Gmail) ; le service worker
  // demande où l'on est pour ne pas afficher un mail qu'on a déjà sous les yeux.
  const onMails = isAgency && space === "agency" && (active === "mails" || splitShown === "mails");
  useCloseMailNotifications(onMails);
  useEffect(() => {
    if (isAgency) setCurrentPlace(onMails ? "mails" : space === "agency" ? active : "portal");
  }, [isAgency, onMails, space, active]);

  // Lien d'ouverture d'une notification (src/lib/deepLink.ts) : Mails, sur le fil du mail.
  useEffect(() => {
    if (!isAgency) return;
    const run = () => {
      const l = takeDeepLink((x) => x.open === "mails" || (x.open === "view" && isNavView(x.view)));
      if (!l || (l.open !== "mails" && l.open !== "view")) return;
      if (l.open === "view") {
        // Du nouveau d'un créateur (tâche, idée, brief) : la page, sur l'objet si possible.
        if (l.view === "todo" && l.item) requestIntent("todo:open", l.item);
        navigateCurrentTab(l.view as ViewId);
      } else {
        requestIntent("mail:open", JSON.stringify({ thread: l.thread, box: l.box }));
        navigateCurrentTab("mails");
      }
      setSub(null);
      setDetailCreator(null);
      setSpace("agency");
      setPhoneScreen(null);
    };
    run();
    return onDeepLink(run);
  }, [isAgency, navigateCurrentTab]);

  if (session === undefined) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader variant="dot-matrix" size={26} className="text-muted-foreground" />
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
                className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                Réessayer
              </button>
              <button
                type="button"
                onClick={logout}
                className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-rowhover"
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
        <Loader variant="dot-matrix" size={26} className="text-muted-foreground" />
      </div>
    );
  }

  // Espace CRÉATEUR : vue dédiée quand un créateur se connecte
  if (profile?.role === "creator" && profile.creator_name) {
    return (
      // Thème partagé (Profil → Thème : Clair, Verre, Noir, Auto), comme côté agence.
      <ThemeContext.Provider value={{ dark, toggle: toggleTheme, theme, setTheme }}>
      <Suspense fallback={<div className="grid min-h-screen place-items-center bg-background"><Loader variant="dot-matrix" size={26} className="text-muted-foreground" /></div>}>
        <CreatorSpace
          name={profile.creator_name}
          dark={dark}
          onToggleTheme={toggleTheme}
          onLogout={logout}
        />
      </Suspense>
      </ThemeContext.Provider>
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
              className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Réessayer
            </button>
            <button
              type="button"
              onClick={logout}
              className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-rowhover"
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
            <button type="button" onClick={() => setSpace("agency")} className="mt-3 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90">
              Retour à l'espace agence
            </button>
          </div>
        </div>
      );
    }
    return (
      <ThemeContext.Provider value={{ dark, toggle: toggleTheme, theme, setTheme }}>
      <Suspense fallback={<div className="grid min-h-screen place-items-center bg-background"><Loader variant="dot-matrix" size={26} className="text-muted-foreground" /></div>}>
        {/* key : changer de créateur repart d'un espace neuf (formulaires, listes,
            infos) au lieu d'enregistrer les données du précédent sur le suivant. */}
        <CreatorSpace
          key={pc}
          name={pc}
          dark={dark}
          onToggleTheme={toggleTheme}
          onLogout={logout}
          preview={{ onExit: () => setSpace("agency"), onPick: setPortalCreator, creators }}
        />
      </Suspense>
      </ThemeContext.Provider>
    );
  }

  // Barre du haut (recherche + profil + notifs + thème) — partagée normal/split.
  const topBar = (
    // Ordinateur : recherche, notifications et thème vivent dans le menu (maquette) ;
    // cette barre ne sert plus qu'aux écrans étroits hors mode iPhone.
    <header className="flex items-center gap-4 px-4 pt-5 md:hidden">
      {/* recherche globale (filtre + navigation) */}
      <GlobalSearch query={query} setQuery={setQuery} onOpenCreator={openDetail} onGoto={gotoSearch} hidden={navHidden} />
      {/* right cluster */}
      <div className="ml-auto flex shrink-0 items-center gap-2.5">
        <Notifications items={notifs} onDismiss={dismissNotifs} onOpenPage={(p) => select(p as ViewId)} />
        {/* Thème : desktop uniquement (sur mobile → Paramètres → Apparence, gain de place) */}
        <button
          type="button"
          onClick={toggleTheme}
          className="hidden h-10 w-10 place-items-center rounded-full bg-surface text-foreground shadow-sm transition-colors hover:bg-rowhover md:grid"
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
      <CreatorDetail key={detailCreator} name={detailCreator} onBack={() => setDetailCreator(null)} onOpenPortal={openPortal} />
    ) : !canSee(active) ? (
      accessDenied
    ) : (
      <NavSubContext.Provider value={sub}>
        <ViewContent active={active} onOpenCreator={openDetail} />
      </NavSubContext.Provider>
    );
  // (Le mode portail a déjà fait un return anticipé plus haut : ici space === "agency".)
  const primaryTitle = detailCreator ? titleCase(detailCreator) : canSee(active) ? title : "Accès réservé";
  // Accueil, Mails et Paramètres n'ont pas d'en-tête de page (Mails : client plein écran avec son
  // propre en-tête ; Paramètres : le titre vit en tête de sa colonne de réglages).
  const showPrimaryH1 = !detailCreator && !NO_PAGE_HEADER.includes(active);
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
    <ThemeContext.Provider value={{ dark, toggle: toggleTheme, theme, setTheme }}>
    <RestrictedViewsContext.Provider value={hiddenIds}>
    <SearchContext.Provider value={{ query, setQuery }}>
    <NavSubSetContext.Provider value={setSub}>
      <div className={iosPhone ? "app-frame h-[100dvh] bg-background" : "app-frame h-[100dvh] bg-background p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] md:p-[14px] md:pt-[14px] md:pb-[14px]"}>
        <div className={cn("flex h-full overflow-hidden", !iosPhone && "md:gap-3.5")}>
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
              pinned={pinned.filter(inNav)}
              onTogglePin={togglePin}
              favOrder={favOrder}
              onFavReorder={(ids) => void saveFavOrder(ids)}
              hidden={navHidden}
              userId={session.user.id}
              badges={navBadges}
              search={<GlobalSearch variant="sidebar" query={query} setQuery={setQuery} onOpenCreator={openDetail} onGoto={gotoSearch} hidden={navHidden} onActivate={openCommandPalette} />}
              tools={
                <>
                  <Notifications variant="sidebar" items={notifs} onDismiss={dismissNotifs} onOpenPage={(p) => select(p as ViewId)} />
                  <button
                    type="button"
                    onClick={toggleTheme}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-foreground/60 transition-colors hover:bg-rowhover hover:text-foreground"
                    aria-label={dark ? "Passer en clair" : "Passer en noir"}
                    title={dark ? "Passer en clair" : "Passer en noir"}
                  >
                    {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  </button>
                </>
              }
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
                className={cn("flex-1 overflow-y-auto md:pb-7", iosPhone ? "pb-[calc(env(safe-area-inset-bottom)+6.5rem)]" : "pb-28")}
              >
                {iosPhone ? (
                  <IosNavBar
                    scrollRef={scrollRef}
                    actionSlotRef={setNavSlot}
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
                          <IosBarIcon icon={TtpSearch} label="Rechercher" onClick={() => setPhoneScreen("search")} />
                          <Notifications items={notifs} onDismiss={dismissNotifs} onOpenPage={(p) => select(p as ViewId)} variant="bar" />
                        </>
                      )
                    }
                  />
                ) : (
                  topBar
                )}
                <main className={cn("px-4 md:px-8", iosPhone ? "pt-1" : "pt-5 md:pt-8")}>
                  <NavActionSlotContext.Provider value={iosPhone && !phoneScreen ? navSlot : null}>
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
                            sections={[
                              ...navFiltered.map((f) => ({ id: f.id, label: f.label, items: f.items })),
                              { id: "autres", label: "Autres", items: [{ id: "corbeille", label: "Corbeille", icon: Trash2 }] },
                            ]}
                            onSelect={(id, subId) => select(id as ViewId, subId)}
                            dark={dark}
                            onToggleTheme={toggleTheme}
                            onExit={logout}
                            badges={navBadges}
                            before={
                              <IosGroup>
                                <IosRow icon={Eye} label="Espace créateurs" detail="Aperçu" onClick={() => changeSpace("portal")} />
                              </IosGroup>
                            }
                          />
                        </PageFrame>
                      ) : iosPhone && phoneScreen === "search" ? (
                        <PageFrame title="Rechercher">
                          <GlobalSearch inline autoFocus query={query} setQuery={setQuery} onOpenCreator={openDetail} onGoto={gotoSearch} hidden={navHidden} />
                        </PageFrame>
                      ) : showPrimaryH1 ? (
                        <PageFrame title={title} hint={VIEW_HINTS[active]}>{mainInner}</PageFrame>
                      ) : (
                        mainInner
                      )}
                    </Suspense>
                  </ErrorBoundary>
                  </NavActionSlotContext.Provider>
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
                                  {!NO_PAGE_HEADER.includes(id) ? (
                                    <PageFrame title={tabTitle} hint={VIEW_HINTS[id]}>
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

        {iosPhone && <PullToRefresh scrollRef={scrollRef} />}
        <OfflineBanner />
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
              {/* Pages fixes de Favoris : toujours là, rien à ajouter ni retirer. */}
              {!FAVORIS_BASE.has(ctxMenu.id) && (
                <button
                  type="button"
                  onClick={() => {
                    togglePin(ctxMenu.id);
                    setCtxMenu(null);
                  }}
                  className="flex w-full items-center gap-2.5 border-t border-border px-3 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-rowhover"
                >
                  {pinned.includes(ctxMenu.id)
                    ? <><StarOff className="h-4 w-4 text-faint" /> Retirer des favoris</>
                    : <><Star className="h-4 w-4 text-faint" /> Ajouter aux favoris</>}
                </button>
              )}
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
      <AgencySignatureSync />
      <UndoSendBar />
      {/* Palette ⌘K : actions, pages, recherche et Megan, depuis n'importe quelle page. */}
      <CommandPalette hidden={navHidden} restricted={hiddenIds} onSelect={select} onGoto={gotoSearch} onOpenCreator={openDetail} setQuery={setQuery} />
    </NavSubSetContext.Provider>
    </SearchContext.Provider>
    </RestrictedViewsContext.Provider>
    </ThemeContext.Provider>
  );
}
