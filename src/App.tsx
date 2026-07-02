import { useEffect, useState, type ComponentType } from "react";
import { ChevronRight, Moon, Sun, Loader2 } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { ExpandableTabs } from "@/components/ui/be-ui-expandable-tabs";
import { GlobalSearch } from "@/components/GlobalSearch";
import { EncryptedText } from "@/components/ui/encrypted-text";
import { Toaster } from "@/components/ui/toast";
import { Notifications } from "@/components/ui/notifications";
import { useNotifications } from "@/lib/useNotifications";
import { Sidebar } from "@/components/Sidebar";
import { Login } from "@/components/Login";
import { NAV, findItem, type NavItem, type ViewId } from "@/lib/nav";
import { supabase } from "@/lib/supabase";
import { SearchContext } from "@/lib/search";
import { RosterTabs } from "@/views/RosterTabs";
import { Apercu } from "@/views/Apercu";
import { Facturation } from "@/views/Facturation";
import { Briefs } from "@/views/Briefs";
import { Idees } from "@/views/Idees";
import { Todo } from "@/views/Todo";
import { Planning } from "@/views/Planning";
import { Documents } from "@/views/Documents";
import { Contacts } from "@/views/Contacts";
import { Contrats } from "@/views/Contrats";
import { Prospection } from "@/views/Prospection";
import { Acces } from "@/views/Acces";
import { Objectifs } from "@/views/Objectifs";
import { Debrief } from "@/views/Debrief";
import { Checklist } from "@/views/Checklist";
import { Mediakit } from "@/views/Mediakit";
import { Ugc } from "@/views/Ugc";
import { Templates } from "@/views/Templates";
import { CreatorDetail } from "@/views/CreatorDetail";
import { Portal } from "@/views/Portal";
import { CreatorSpace } from "@/views/CreatorSpace";

const BASE = import.meta.env.BASE_URL;

const VIEWS: Partial<Record<ViewId, ComponentType>> = {
  apercu: Apercu,
  facturation: Facturation,
  briefs: Briefs,
  ideas: Idees,
  todo: Todo,
  planning: Planning,
  documents: Documents,
  contacts: Contacts,
  contrats: Contrats,
  prospection: Prospection,
  acces: Acces,
  objectifs: Objectifs,
  debrief: Debrief,
  checklist: Checklist,
  mediakit: Mediakit,
  ugc: Ugc,
  templates: Templates,
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

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [active, setActive] = useState<ViewId>("apercu");
  const [dark, setDark] = useState(false);
  const [mobileTab, setMobileTab] = useState<string | null>(null);
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
      .then(({ data }) => {
        if (!alive) return;
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

  const notifs = useNotifications();
  const title = findItem(active)?.label ?? "Aperçu";

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
      <CreatorSpace
        name={profile.creator_name}
        dark={dark}
        onToggleTheme={toggleTheme}
        onLogout={logout}
      />
    );
  }

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
            />
          </div>

          {/* Main panel */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[22px] bg-panel">
            {/* Top bar */}
            <header className="flex flex-shrink-0 items-center gap-4 px-4 py-3.5 md:px-6">
              {/* mobile logo */}
              <div className="flex items-center gap-2 md:hidden">
                <div className="h-8 w-8 overflow-hidden rounded-lg bg-[#14181E]">
                  <img src={`${BASE}cover.png`} alt="TTP" className="h-full w-full object-cover" />
                </div>
              </div>

              {/* recherche globale (filtre + navigation) */}
              <GlobalSearch
                query={query}
                setQuery={setQuery}
                onOpenCreator={openDetail}
                onGoto={gotoSearch}
              />

              {/* right cluster */}
              <div className="ml-auto flex items-center gap-2.5">
                <div className="hidden items-center gap-2.5 rounded-lg bg-surface py-1.5 pl-2 pr-3.5 shadow-sm sm:flex">
                  <div className="h-8 w-8 overflow-hidden rounded-lg bg-[#14181E]">
                    <img src={`${BASE}cover.png`} alt="TTP" className="h-full w-full object-cover" />
                  </div>
                  <div className="leading-tight">
                    <div className="whitespace-nowrap text-xs font-medium text-foreground">
                      Marc &amp; Gianni
                    </div>
                    <div className="whitespace-nowrap text-[10px] text-faint">
                      Direction · TTP
                    </div>
                  </div>
                </div>
                <Notifications items={notifs} />
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

            {/* Content */}
            <main className="flex-1 overflow-y-auto px-4 pb-28 pt-1.5 md:px-6 md:pb-7">
              {space === "portal" ? (
                <Portal
                  creator={portalCreator}
                  onPick={setPortalCreator}
                  onExit={() => setSpace("agency")}
                />
              ) : detailCreator ? (
                <CreatorDetail
                  name={detailCreator}
                  onBack={() => setDetailCreator(null)}
                  onOpenPortal={openPortal}
                />
              ) : (
                <>
                  {active !== "apercu" && (
                    <h1 className="mb-5 text-[26px] font-semibold tracking-tight md:text-[30px]">
                      <EncryptedText key={active} text={title} />
                    </h1>
                  )}
                  <ViewContent active={active} onOpenCreator={openDetail} />
                </>
              )}
            </main>
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
      </div>
      <Toaster />
    </SearchContext.Provider>
  );
}
