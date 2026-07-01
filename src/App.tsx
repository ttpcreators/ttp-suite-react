import { useEffect, useState, type ComponentType } from "react";
import { ChevronRight, Moon, Sun, Loader2 } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { ExpandableTabs } from "@/components/ui/be-ui-expandable-tabs";
import { GooeyInput } from "@/components/ui/gooey-input";
import { Sidebar } from "@/components/Sidebar";
import { Login } from "@/components/Login";
import { NAV, findItem, type NavItem, type ViewId } from "@/lib/nav";
import { supabase } from "@/lib/supabase";
import { SearchContext } from "@/lib/search";
import { Roster } from "@/views/Roster";
import { Apercu } from "@/views/Apercu";
import { Facturation } from "@/views/Facturation";
import { Briefs } from "@/views/Briefs";
import { Todo } from "@/views/Todo";
import { Planning } from "@/views/Planning";
import { Documents } from "@/views/Documents";
import { Contacts } from "@/views/Contacts";
import { Prospection } from "@/views/Prospection";

const BASE = import.meta.env.BASE_URL;

const VIEWS: Partial<Record<ViewId, ComponentType>> = {
  apercu: Apercu,
  facturation: Facturation,
  roster: Roster,
  briefs: Briefs,
  todo: Todo,
  planning: Planning,
  documents: Documents,
  contacts: Contacts,
  prospection: Prospection,
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

function ViewContent({ active }: { active: ViewId }) {
  const item = findItem(active);
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

  const select = (id: ViewId) => {
    setActive(id);
    setMobileTab(null);
    setQuery("");
  };
  const toggleTheme = () => setDark((d) => !d);
  const logout = () => supabase.auth.signOut();

  const mobileItems = NAV.map((f) => ({
    id: f.id,
    label: f.label,
    icon: <f.icon className="h-4 w-4" />,
    content: <MobileMenu items={f.items} onSelect={select} />,
  }));

  const title = findItem(active)?.label ?? "Aperçu";

  if (session === undefined) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!session) return <Login />;

  return (
    <SearchContext.Provider value={{ query, setQuery }}>
      <div className="h-screen bg-background p-2 md:p-[14px]">
        <div className="flex h-full overflow-hidden rounded-[22px]">
          {/* Desktop sidebar */}
          <div className="hidden md:block">
            <Sidebar active={active} onSelect={select} onLogout={logout} />
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

              {/* gooey search (Aceternity) */}
              <GooeyInput
                value={query}
                onValueChange={setQuery}
                placeholder="Rechercher…"
                className="justify-start"
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
              <h1 className="mb-5 text-[26px] font-semibold tracking-tight md:text-[30px]">
                {title}
              </h1>
              <ViewContent active={active} />
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
    </SearchContext.Provider>
  );
}
