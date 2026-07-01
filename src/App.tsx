import { useEffect, useState } from "react";
import { ChevronRight, Moon, Sun } from "lucide-react";
import { ExpandableTabs } from "@/components/ui/be-ui-expandable-tabs";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { Sidebar } from "@/components/Sidebar";
import { NAV, findItem, type NavItem, type ViewId } from "@/lib/nav";
import { supabase } from "@/lib/supabase";

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

  if (active === "apercu") {
    return (
      <>
        <div className="mb-8">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Badges de statut (animés — partout dans l'app)
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <AnimatedBadge status="success" size="sm">Actif</AnimatedBadge>
            <AnimatedBadge status="warning" size="sm">En attente</AnimatedBadge>
            <AnimatedBadge status="danger" size="sm">En retard</AnimatedBadge>
            <AnimatedBadge status="neutral" size="sm">Brouillon</AnimatedBadge>
            <AnimatedBadge status="info" size="sm">Validé</AnimatedBadge>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {["CA encaissé", "En attente", "Taux d'engagement", "Objectif"].map(
            (label, i) => (
              <div
                key={label}
                className="rounded-xl border border-border bg-card p-5 shadow-sm"
              >
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {label}
                </div>
                <div className="mt-2 text-2xl font-bold tracking-tight">
                  {["32 400 €", "8 200 €", "4,8 %", "88 %"][i]}
                </div>
              </div>
            ),
          )}
        </div>
      </>
    );
  }

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
  const [active, setActive] = useState<ViewId>("apercu");
  const [dark, setDark] = useState(false);
  const [mobileTab, setMobileTab] = useState<string | null>(null);
  const [conn, setConn] = useState<"loading" | "ok" | "err">("loading");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  // Test réel de la connexion Supabase (vue publique du roster, accessible en anon)
  useEffect(() => {
    supabase
      .from("public_roster")
      .select("name")
      .limit(1)
      .then(({ error }) => setConn(error ? "err" : "ok"));
  }, []);

  const select = (id: ViewId) => {
    setActive(id);
    setMobileTab(null);
  };
  const toggleTheme = () => setDark((d) => !d);

  const mobileItems = NAV.map((f) => ({
    id: f.id,
    label: f.label,
    icon: <f.icon className="h-4 w-4" />,
    content: <MobileMenu items={f.items} onSelect={select} />,
  }));

  const title = findItem(active)?.label ?? "Aperçu";
  const family = NAV.find((f) => f.items.some((i) => i.id === active));

  const connBadge =
    conn === "loading" ? (
      <AnimatedBadge status="loading" size="sm">Connexion…</AnimatedBadge>
    ) : conn === "ok" ? (
      <AnimatedBadge status="success" size="sm">Base connectée</AnimatedBadge>
    ) : (
      <AnimatedBadge status="danger" size="sm">Hors ligne</AnimatedBadge>
    );

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar active={active} onSelect={select} dark={dark} onToggleTheme={toggleTheme} />
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
            {connBadge}
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
