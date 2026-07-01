import { useEffect, useState, type ComponentType } from "react";
import { ChevronRight, Moon, Sun, Loader2 } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { ExpandableTabs } from "@/components/ui/be-ui-expandable-tabs";
import { Sidebar } from "@/components/Sidebar";
import { Login } from "@/components/Login";
import { NAV, findItem, type NavItem, type ViewId } from "@/lib/nav";
import { supabase } from "@/lib/supabase";
import { Roster } from "@/views/Roster";
import { Apercu } from "@/views/Apercu";
import { Facturation } from "@/views/Facturation";
import { Briefs } from "@/views/Briefs";
import { Todo } from "@/views/Todo";
import { Planning } from "@/views/Planning";
import { Documents } from "@/views/Documents";
import { Contacts } from "@/views/Contacts";
import { Prospection } from "@/views/Prospection";

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
    <div className="grid min-h-[40vh] place-items-center rounded-xl border border-dashed border-border bg-card/50">
      <div className="text-center">
        {item && <item.icon className="mx-auto h-8 w-8 text-muted-foreground" />}
        <div className="mt-3 text-sm font-medium">
          {item?.label} — migration en cours
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Cette vue sera branchée sur tes vraies données à la prochaine phase.
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

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  // Session Supabase : bascule login <-> app
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
  const family = NAV.find((f) => f.items.some((i) => i.id === active));

  // --- écran de chargement / login ---
  if (session === undefined) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!session) return <Login />;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar
          active={active}
          onSelect={select}
          dark={dark}
          onToggleTheme={toggleTheme}
          onLogout={logout}
        />
      </div>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
          {/* mobile logo */}
          <div className="flex items-center gap-3 md:hidden">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              T
            </div>
            <span className="text-sm font-semibold">TTP Suite</span>
          </div>
          {/* desktop breadcrumb */}
          <div className="hidden items-center gap-2 text-sm md:flex">
            <span className="text-muted-foreground">{family?.label}</span>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">{title}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
              aria-label="Basculer le thème"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        {/* View */}
        <main className="flex-1 overflow-y-auto px-5 py-6 pb-32 md:px-8 md:pb-8">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {title}
          </h1>
          <div className="mt-6">
            <ViewContent active={active} />
          </div>
        </main>
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
  );
}
