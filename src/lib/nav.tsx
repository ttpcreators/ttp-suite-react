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
  Gift,
  Wallet,
  AlarmClock,
  CalendarClock,
  Settings,
  Activity,
  Mail,
  CreditCard,
  FolderOpen,
  type LucideIcon,
} from "lucide-react";

export type ViewId =
  | "apercu"
  | "stats"
  | "objectifs"
  | "facturation"
  | "reversements"
  | "relances"
  | "echeances"
  | "roster"
  | "mediakit"
  | "briefs"
  | "gifting"
  | "ideas"
  | "todo"
  | "planning"
  | "documents"
  | "contacts"
  | "mails"
  | "prospection"
  | "contrats"
  | "debrief"
  | "templates"
  | "checklist"
  | "acces"
  | "parametres"
  | "suivi"
  | "corbeille";

/** Sous-page d'une page (3e niveau de nav) : `id` = onglet ciblé dans la vue parente. */
export type NavChild = { id: string; label: string };
export type NavItem = { id: ViewId; label: string; icon: LucideIcon; children?: NavChild[] };
export type NavFamily = {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
};

// Organisation par MÉTIER : chaque section = un moment de travail distinct, pour
// retrouver une page « là où on la cherche ». La Finance est isolée (avant éclatée
// entre Pilotage et Relations) ; les réglages admin sont séparés des vrais outils.
export const NAV: NavFamily[] = [
  {
    id: "pilotage",
    label: "Pilotage",
    icon: Gauge,
    items: [
      { id: "apercu", label: "Aperçu", icon: LayoutDashboard },
      { id: "stats", label: "Stats", icon: TrendingUp },
      { id: "objectifs", label: "Objectifs", icon: Target },
    ],
  },
  {
    id: "createurs",
    label: "Créateurs",
    icon: Users,
    items: [
      { id: "roster", label: "Roster", icon: Users },
      { id: "suivi", label: "Suivi engagement", icon: Activity },
      {
        id: "mediakit",
        label: "Media kit",
        icon: ImageIcon,
        children: [
          { id: "creatrices", label: "Créatrices" },
          { id: "agence", label: "Agence" },
          { id: "files", label: "Fichiers" },
        ],
      },
    ],
  },
  {
    id: "travail",
    label: "Collaborations",
    icon: Briefcase,
    items: [
      { id: "briefs", label: "Briefs", icon: FileText },
      { id: "debrief", label: "Debrief", icon: BarChart3 },
      { id: "gifting", label: "Gifting", icon: Gift },
      { id: "ideas", label: "Idées", icon: Lightbulb },
      { id: "todo", label: "À faire", icon: ListChecks },
      { id: "planning", label: "Planning", icon: CalendarDays },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    icon: CreditCard,
    items: [
      { id: "facturation", label: "Facturation", icon: Receipt },
      { id: "reversements", label: "Reversements", icon: Wallet },
      { id: "relances", label: "Relances", icon: AlarmClock },
      { id: "echeances", label: "Échéances", icon: CalendarClock },
    ],
  },
  {
    id: "relations",
    label: "Relations",
    icon: Handshake,
    items: [
      { id: "contacts", label: "Contacts", icon: Contact },
      { id: "mails", label: "Mails", icon: Mail },
      { id: "prospection", label: "Prospection", icon: Search },
      {
        id: "contrats",
        label: "Contrats",
        icon: ScrollText,
        children: [
          { id: "marque", label: "Marque × Créateur" },
          { id: "repr", label: "Représentation" },
          { id: "ugc", label: "Contrat UGC" },
        ],
      },
    ],
  },
  {
    id: "ressources",
    label: "Ressources",
    icon: FolderOpen,
    items: [
      { id: "documents", label: "Documents", icon: Files },
      { id: "templates", label: "Templates", icon: LayoutTemplate },
      { id: "checklist", label: "Checklist", icon: CheckCircle2 },
    ],
  },
  {
    id: "reglages",
    label: "Réglages",
    icon: Wrench,
    items: [
      { id: "acces", label: "Accès", icon: KeyRound },
      { id: "parametres", label: "Paramètres", icon: Settings },
    ],
  },
];

export const ALL_ITEMS: NavItem[] = NAV.flatMap((f) => f.items);

export function findItem(id: ViewId): NavItem | undefined {
  return ALL_ITEMS.find((i) => i.id === id);
}
