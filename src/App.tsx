import {
  LayoutDashboard,
  Target,
  Receipt,
  Users,
  Image as ImageIcon,
  FileText,
  ListChecks,
  CalendarDays,
  Files,
  Contact,
  Search,
  ScrollText,
  BarChart3,
  LayoutTemplate,
  CheckCircle2,
  KeyRound,
  Gauge,
  Briefcase,
  Handshake,
  Wrench,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { ExpandableTabs } from "@/components/ui/be-ui-expandable-tabs";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";

function Row({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="flex-1">{label}</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}

function Menu({ rows }: { rows: { icon: LucideIcon; label: string }[] }) {
  return (
    <div className="flex w-[16rem] flex-col gap-0.5">
      {rows.map((r) => (
        <Row key={r.label} icon={r.icon} label={r.label} />
      ))}
    </div>
  );
}

const NAV = [
  {
    id: "pilotage",
    label: "Pilotage",
    icon: <Gauge className="h-4 w-4" />,
    content: (
      <Menu
        rows={[
          { icon: LayoutDashboard, label: "Aperçu" },
          { icon: Target, label: "Objectifs" },
          { icon: Receipt, label: "Facturation" },
        ]}
      />
    ),
  },
  {
    id: "createurs",
    label: "Créateurs",
    icon: <Users className="h-4 w-4" />,
    content: (
      <Menu
        rows={[
          { icon: Users, label: "Roster" },
          { icon: ImageIcon, label: "Media kit" },
        ]}
      />
    ),
  },
  {
    id: "travail",
    label: "Travail",
    icon: <Briefcase className="h-4 w-4" />,
    content: (
      <Menu
        rows={[
          { icon: FileText, label: "Briefs" },
          { icon: ListChecks, label: "À faire" },
          { icon: CalendarDays, label: "Planning" },
          { icon: Files, label: "Documents" },
        ]}
      />
    ),
  },
  {
    id: "relations",
    label: "Relations",
    icon: <Handshake className="h-4 w-4" />,
    content: (
      <Menu
        rows={[
          { icon: Contact, label: "Contacts" },
          { icon: Search, label: "Prospection" },
          { icon: ScrollText, label: "Contrats" },
        ]}
      />
    ),
  },
  {
    id: "outils",
    label: "Outils",
    icon: <Wrench className="h-4 w-4" />,
    content: (
      <Menu
        rows={[
          { icon: BarChart3, label: "Debrief" },
          { icon: LayoutTemplate, label: "Templates" },
          { icon: CheckCircle2, label: "Checklist" },
          { icon: KeyRound, label: "Accès" },
        ]}
      />
    ),
  },
];

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary font-bold text-primary-foreground">
            T
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">TTP Suite</div>
            <div className="text-xs text-muted-foreground">Trust the Process</div>
          </div>
        </div>
        <AnimatedBadge status="success" size="sm">
          Base connectée
        </AnimatedBadge>
      </header>

      <main className="flex-1 px-6 py-8">
        <h1 className="text-3xl font-semibold tracking-tight">Aperçu</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Nouvelle base React + Vite · navigation 5 familles · badges de statut animés
        </p>

        <div className="mt-8">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Badges de statut (animés — partout : créateurs, factures, briefs…)
          </div>
          <div className="flex flex-wrap gap-2">
            <AnimatedBadge status="success" size="sm">Actif</AnimatedBadge>
            <AnimatedBadge status="warning" size="sm">En attente</AnimatedBadge>
            <AnimatedBadge status="danger" size="sm">En retard</AnimatedBadge>
            <AnimatedBadge status="neutral" size="sm">Brouillon</AnimatedBadge>
            <AnimatedBadge status="info" size="sm">Validé</AnimatedBadge>
            <AnimatedBadge status="loading" size="sm">Sync</AnimatedBadge>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
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
      </main>

      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center">
        <div className="pointer-events-auto">
          <ExpandableTabs items={NAV} />
        </div>
      </div>
    </div>
  );
}
