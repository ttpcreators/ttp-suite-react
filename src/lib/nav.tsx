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
  TrendingUp,
  LayoutTemplate,
  CheckCircle2,
  KeyRound,
  Gauge,
  Briefcase,
  Handshake,
  Wrench,
  Lightbulb,
  type LucideIcon,
} from "lucide-react";

export type ViewId =
  | "apercu"
  | "stats"
  | "objectifs"
  | "facturation"
  | "roster"
  | "mediakit"
  | "briefs"
  | "ideas"
  | "todo"
  | "planning"
  | "documents"
  | "contacts"
  | "prospection"
  | "contrats"
  | "debrief"
  | "templates"
  | "checklist"
  | "acces"
  | "corbeille";

export type NavItem = { id: ViewId; label: string; icon: LucideIcon };
export type NavFamily = {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
};

export const NAV: NavFamily[] = [
  {
    id: "pilotage",
    label: "Pilotage",
    icon: Gauge,
    items: [
      { id: "apercu", label: "Aperçu", icon: LayoutDashboard },
      { id: "stats", label: "Stats", icon: TrendingUp },
      { id: "objectifs", label: "Objectifs", icon: Target },
      { id: "facturation", label: "Facturation", icon: Receipt },
    ],
  },
  {
    id: "createurs",
    label: "Créateurs",
    icon: Users,
    items: [
      { id: "roster", label: "Roster", icon: Users },
      { id: "mediakit", label: "Media kit", icon: ImageIcon },
    ],
  },
  {
    id: "travail",
    label: "Travail",
    icon: Briefcase,
    items: [
      { id: "briefs", label: "Briefs", icon: FileText },
      { id: "ideas", label: "Idées", icon: Lightbulb },
      { id: "todo", label: "À faire", icon: ListChecks },
      { id: "planning", label: "Planning", icon: CalendarDays },
      { id: "documents", label: "Documents", icon: Files },
    ],
  },
  {
    id: "relations",
    label: "Relations",
    icon: Handshake,
    items: [
      { id: "contacts", label: "Contacts", icon: Contact },
      { id: "prospection", label: "Prospection", icon: Search },
      { id: "contrats", label: "Contrats", icon: ScrollText },
    ],
  },
  {
    id: "outils",
    label: "Outils",
    icon: Wrench,
    items: [
      { id: "debrief", label: "Debrief", icon: BarChart3 },
      { id: "templates", label: "Templates", icon: LayoutTemplate },
      { id: "checklist", label: "Checklist", icon: CheckCircle2 },
      { id: "acces", label: "Accès", icon: KeyRound },
    ],
  },
];

export const ALL_ITEMS: NavItem[] = NAV.flatMap((f) => f.items);

export function findItem(id: ViewId): NavItem | undefined {
  return ALL_ITEMS.find((i) => i.id === id);
}
