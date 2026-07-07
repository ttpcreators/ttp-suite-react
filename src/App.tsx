import { lazy, Suspense, useEffect, useState, type ComponentType, type MouseEvent as ReactMouseEvent } from "react";
import { ChevronRight, Moon, Sun, Loader2, X, Columns2, SquareArrowRight } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { ExpandableTabs } from "@/components/ui/be-ui-expandable-tabs";
import { GlobalSearch } from "@/components/GlobalSearch";
import { Toaster } from "@/components/ui/toast";
import { Notifications } from "@/components/ui/notifications";
import { useNotifications } from "@/lib/useNotifications";
import { Sidebar } from "@/components/Sidebar";
import { Login } from "@/components/Login";
import { NAV, findItem, type NavItem, type ViewId } from "@/lib/nav";
import { supabase } from "@/lib/supabase";
import { SearchContext } from "@/lib/search";
import { AgencyAvatar } from "@/components/ui/agency-avatar";

// Vues chargées à la demande (code-splitting → démarrage plus léger, mobile compris).
const RosterTabs = lazy(() => import("@/views/RosterTabs").then((m) => ({ default: m.RosterTabs })));
const Apercu = lazy(() => import("@/views/Apercu").then((m) => ({ default: m.Apercu })));
const Stats = lazy(() => import("@/views/Stats").then((m) => ({ default: m.Stats })));
const Facturation = lazy(() => import("@/views/Facturation").then((m) => ({ default: m.Facturation })));
const Briefs = lazy(() => import("@/views/Briefs").then((m) => ({ default: m.Briefs })));
const Idees = lazy(() => import("@/views/Idees").then((m) => ({ default: m.Idees })));
const Todo = lazy(() => import("@/views/Todo").then((m) => ({ default: m.Todo })));
const Planning = lazy(() => import("@/views/Planning").then((m) => ({ default: m.Planning })));
const Documents = lazy(() => import("@/views/Documents").then((m) => ({ default: m.Documents })));
const Contacts = lazy(() => import("@/views/Contacts").then((m) => ({ default: m.Contacts })));
const Mails = lazy(() => import("@/views/Mails").then((m) => ({ default: m.Mails })));
const Contrats = lazy(() => import("@/views/Contrats").then((m) => ({ default: m.Contrats })));
const Prospection = lazy(() => import("@/views/Prospection").then((m) => ({ default: m.Prospection })));
const Acces = lazy(() => import("@/views/Acces").then((m) => ({ default: m.Acces })));
const Objectifs = lazy(() => import("@/views/Objectifs").then((m) => ({ default: m.Objectifs })));
const Debrief = lazy(() => import("@/views/Debrief").then((m) => ({ default: m.Debrief })));
const Checklist = lazy(() => import("@/views/Checklist").then((m) => ({ default: m.Checklist })));
const Mediakit = lazy(() => import("@/views/Mediakit").then((m) => ({ default: m.Mediakit })));
const Templates = lazy(() => import("@/views/Templates").then((m) => ({ default: m.Templates })));
const CreatorDetail = lazy(() => import("@/views/CreatorDetail").then((m) => ({ default: m.CreatorDetail })));
const Portal = lazy(() => import("@/views/Portal").then((m) => ({ default: m.Portal })));
const CreatorSpace = lazy(() => import("@/views/CreatorSpace").then((m) => ({ default: m.CreatorSpace })));
const Corbeille = lazy(() => import("@/views/Corbeille").then((m) => ({ default: m.Corbeille })));
const Reversements = lazy(() => import("@/views/Reversements").then((m) => ({ default: m.Reversements })));
const Relances = lazy(() => import("@/views/Relances").then((m) => ({ default: m.Relances })));
const Echeances = lazy(() => import("@/views/Echeances").then((m) => ({ default: m.Echeances })));
const Parametres = lazy(() => import("@/views/Parametres").then((m) => ({ default: m.Parametres })));
const EngagementSuivi = lazy(() => import("@/views/EngagementSuivi").then((m) => ({ default: m.EngagementSuivi })));

const BASE = import.meta.env.BASE_URL;

const VIEWS: Partial<Record<ViewId, ComponentType>> = {
  apercu: Apercu,
  stats: Stats,
  facturation: Facturation,
  reversements: Reversements,
  relances: Relances,
  echeances: Echeances,
  briefs: Briefs,
  ideas: Idees,
  todo: Todo,
  planning: Planning,
  documents: Documents,
  contacts: Contacts,
  mails: Mails,
  contrats: Contrats,
  prospection: Prospection,
  acces: Acces,
  objectifs: Objectifs,
  debrief: Debrief,
  checklist: Checklist,
  mediakit: Mediakit,
  templates: Templates,
  parametres: Parametres,
  suivi: EngagementSuivi,
  corbeille: Corbeille,
};

function MobileMenu({
  items,
  onSelect,
}: {
  items: NavItem[];
  onSelect: (id: ViewId) => void;
}) {
  return (
    <div className="flex w-[15rem] flex-col gap-0.5">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <item.icon className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1">{item.label}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
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

// En-tête d'un volet en mode split (titre + bouton fermer pour le volet de droite).
function PaneHeader({ title, onClose }: { title: string; onClose?: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5 md:px-6">
      <h2 className="truncate text-[15px] font-semibold tracking-tight">{title}</h2>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="ml-auto grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-rowhover hover:text-foreground"
          title="Fermer le volet"
          aria-label="Fermer le volet"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [active, setActive] = useState<ViewId>(() => {
    // Restaure la dernière page ouverte (évite de retomber sur l'Aperçu à chaque refresh).
    try {
      const saved = localStorage.getItem("ttp:view");
      // `roster` est valide mais géré à part (pas dans VIEWS) → l'inclure explicitement.
      // hasOwn : `in` traverserait la chaîne de prototypes ("constructor"… passerait).
      if (saved && (Object.hasOwn(VIEWS, saved) || saved === "roster")) return saved as ViewId;
    } catch {
      /* localStorage indisponible */
    }
    return "apercu";
  });
  const [dark, setDark] = useState(false);
  const [mobileTab, setMobileTab] = useState<string | null>(null);
  // Volet secondaire (multi-pages côte à côte, desktop) + son menu contextuel.
  const [splitView, setSplitView] = useState<ViewId | null>(() => {
    try {
      const saved = localStorage.getItem("ttp:split");
      if (saved && Object.hasOwn(VIEWS, saved)) return saved as ViewId;
    } catch {
      /* localStorage indisponible */
    }
    return null;
  });
  const [ctxMenu, setCtxMenu] = useState<{ id: ViewId; x: number; y: number } | null>(null);
  const [query, setQuery] = useState("");
  const [detailCreator, setDetailCreator] = useState<string | null>(null);
  const [space, setSpace] = useState<"agency" | "portal">("agency");
  const [portalCreator, setPortalCreator] = useState<string | null>(null);
  const [profile, setProfile] = useState<
    { role: string; creator_name: string | null } | null | undefined
  >(undefined);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  // Mémorise la page courante pour la rouvrir au prochain refresh.
  useEffect(() => {
    try {
      localStorage.setItem("ttp:view", active);
    } catch {
      /* localStorage indisponible */
    }
  }, [active]);

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
      if (id && (Object.hasOwn(VIEWS, id) || id === "roster")) {
        setActive(id as ViewId);
        setDetailCreator(null);
        setSpace("agency");
        setMobileTab(null);
      }
    };
    window.addEventListener("ttp-navigate", onNav);
    return () => window.removeEventListener("ttp-navigate", onNav);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setSession(s),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  // Rôle de l'utilisateur connecté (agence vs créateur)
  useEffect(() => {
    if (!session) {
      setProfile(session === null ? null : undefined);
      return;
    }
    let alive = true;
    supabase
      .from("profiles")
      .select("role,creator_name")
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) console.error("Chargement du profil échoué:", error);
        const row = data as { role: string; creator_name: string | null } | null;
        setProfile(row ?? { role: "agency", creator_name: null });
      });
    return () => {
      alive = false;
    };
  }, [session]);

  const select = (id: ViewId) => {
    setActive(id);
    setMobileTab(null);
    setQuery("");
    setDetailCreator(null);
    setSpace("agency");
  };
  // Clic droit sur un élément du menu (desktop) → menu contextuel « Ouvrir à côté ».
  const onItemContext = (id: ViewId, e: ReactMouseEvent) => {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 210);
    const y = Math.min(e.clientY, window.innerHeight - 120);
    setCtxMenu({ id, x, y });
  };
  const toggleTheme = () => setDark((d) => !d);
  const logout = () => supabase.auth.signOut();
  const openDetail = (name: string) => setDetailCreator(name);
  // Navigation depuis la recherche globale : garde la requête pour que la vue
  // cible filtre dessus (contrairement à `select` qui remet à zéro).
  const gotoSearch = (id: ViewId) => {
    setActive(id);
    setDetailCreator(null);
    setSpace("agency");
    setMobileTab(null);
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

  const mobileItems = NAV.map((f) => ({
    id: f.id,
    label: f.label,
    icon: <f.icon className="h-4 w-4" />,
    content: <MobileMenu items={f.items} onSelect={select} />,
  }));

  const { items: notifs, dismiss: dismissNotifs } = useNotifications();
  const title = findItem(active)?.label ?? (active === "corbeille" ? "Corbeille" : "Aperçu");

  if (session === undefined || (session && profile === undefined)) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!session) return <Login />;

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
      <GlobalSearch query={query} setQuery={setQuery} onOpenCreator={openDetail} onGoto={gotoSearch} />
      {/* right cluster */}
      <div className="ml-auto flex items-center gap-2.5">
        <div className="hidden items-center gap-2.5 rounded-lg bg-surface py-1.5 pl-2 pr-3.5 shadow-sm sm:flex">
          <AgencyAvatar />
          <div className="leading-tight">
            <div className="whitespace-nowrap text-xs font-medium text-foreground">Marc &amp; Gianni</div>
            <div className="whitespace-nowrap text-[10px] text-faint">Direction · TTP</div>
          </div>
        </div>
        <Notifications items={notifs} onDismiss={dismissNotifs} />
        <button
          type="button"
          onClick={toggleTheme}
          className="grid h-10 w-10 place-items-center rounded-lg bg-surface text-foreground shadow-sm transition-colors hover:bg-rowhover"
          aria-label="Basculer le thème"
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );

  // Contenu principal (portail / fiche créateur / vue nav).
  const mainInner =
    space === "portal" ? (
      <Portal creator={portalCreator} onPick={setPortalCreator} onExit={() => setSpace("agency")} />
    ) : detailCreator ? (
      <CreatorDetail name={detailCreator} onBack={() => setDetailCreator(null)} onOpenPortal={openPortal} />
    ) : (
      <ViewContent active={active} onOpenCreator={openDetail} />
    );
  const primaryTitle = detailCreator ?? (space === "portal" ? "Portail créateur" : title);
  const showPrimaryH1 = space !== "portal" && !detailCreator && active !== "apercu";

  return (
    <SearchContext.Provider value={{ query, setQuery }}>
      <div className="h-screen bg-background p-2 md:p-[14px]">
        <div className="flex h-full overflow-hidden rounded-[22px]">
          {/* Desktop sidebar */}
          <div className="hidden h-full md:block">
            <Sidebar
              active={active}
              onSelect={select}
              onLogout={logout}
              space={space}
              onSpaceChange={changeSpace}
              onItemContext={onItemContext}
            />
          </div>

          {/* Main panel */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[22px] bg-panel">
            {splitView ? (
              /* Mode multi-pages : deux volets côte à côte, défilement indépendant. */
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="shrink-0">{topBar}</div>
                <div className="flex min-h-0 flex-1 flex-col md:flex-row">
                  {/* Volet principal (suit le menu de gauche) */}
                  <section className="flex min-w-0 flex-1 flex-col overflow-hidden md:border-r md:border-border">
                    <PaneHeader title={primaryTitle} />
                    <div className="flex-1 overflow-y-auto px-4 pb-24 pt-4 md:px-6 md:pb-6">
                      <Suspense fallback={PANE_FALLBACK}>{mainInner}</Suspense>
                    </div>
                  </section>
                  {/* Volet secondaire */}
                  <section className="flex min-w-0 flex-1 flex-col overflow-hidden border-t border-border md:border-t-0">
                    <PaneHeader title={findItem(splitView)?.label ?? ""} onClose={() => setSplitView(null)} />
                    <div className="flex-1 overflow-y-auto px-4 pb-24 pt-4 md:px-6 md:pb-6">
                      <Suspense fallback={PANE_FALLBACK}>
                        <ViewContent active={splitView} onOpenCreator={openDetail} />
                      </Suspense>
                    </div>
                  </section>
                </div>
              </div>
            ) : (
              /* Mode normal (une seule page) — l'en-tête défile avec le contenu. */
              <div className="flex-1 overflow-y-auto pb-28 md:pb-7">
                {topBar}
                <main className="px-4 pt-5 md:px-6">
                  <Suspense fallback={PANE_FALLBACK}>
                    {showPrimaryH1 && (
                      <h1 className="mb-5 text-[26px] font-semibold tracking-tight md:text-[30px]">
                        {title}
                      </h1>
                    )}
                    {mainInner}
                  </Suspense>
                </main>
              </div>
            )}
          </div>
        </div>

        {/* Mobile bottom nav */}
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center md:hidden">
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
              className="absolute min-w-[200px] overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-xl"
              style={{ top: ctxMenu.y, left: ctxMenu.x }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="truncate px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
                {findItem(ctxMenu.id)?.label}
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
                  setSplitView(ctxMenu.id);
                  setCtxMenu(null);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-rowhover"
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
    </SearchContext.Provider>
  );
}
