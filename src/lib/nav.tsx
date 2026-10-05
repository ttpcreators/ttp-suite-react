import {
  LayoutDashboard,
  Target,
  Receipt,
  Users,
  UserPlus,
  Image as ImageIcon,
  FileText,
  ListChecks,
  CalendarDays,
  Files,
  Contact,
  Search,
  ScrollText,
  FileChartColumn,
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
  BarChart3,
  HeartPulse,
  Milestone,
  Bot,
  MessageCircle,
  CreditCard,
  FolderOpen,
  History,
  type LucideIcon,
  Mail,
} from "lucide-react";

export type ViewId =
  | "apercu"
  | "activite"
  | "agent"
  | "stats"
  | "objectifs"
  | "facturation"
  | "reversements"
  | "relances"
  | "echeances"
  | "roster"
  | "engagement"
  | "vivier"
  | "collabs"
  | "mediakit"
  | "briefs"
  | "gifting"
  | "ideas"
  | "todo"
  | "planning"
  | "documents"
  | "contacts"
  | "whatsapp"
  | "mails"
  | "prospection"
  | "contrats"
  | "debrief"
  | "templates"
  | "checklist"
  | "acces"
  | "parametres"
  | "diagnostique"
  | "suivi"
  | "corbeille";

/** Sous-page d'une page (3e niveau de nav) : `id` = onglet ciblé dans la vue parente. */
/** Sous-page. `pinnable` : c'est aussi une vraie page, épinglable aux raccourcis (avec son icône). */
export type NavChild = { id: string; label: string; icon?: LucideIcon; pinnable?: boolean };
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
      { id: "activite", label: "Activité", icon: History },
      { id: "agent", label: "Agent", icon: Bot },
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
      { id: "engagement", label: "Engagement", icon: BarChart3 },
      { id: "suivi", label: "Suivi engagement", icon: Activity },
      {
        id: "mediakit",
        label: "Media kit",
        icon: ImageIcon,
        children: [
          { id: "creatrices", label: "Créateurs" },
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
      { id: "collabs", label: "Collabs", icon: Milestone },
      { id: "briefs", label: "Briefs", icon: FileText },
      { id: "debrief", label: "Debrief", icon: FileChartColumn },
      { id: "gifting", label: "Gifting", icon: Gift },
      { id: "ideas", label: "Idées", icon: Lightbulb },
      { id: "todo", label: "To-do", icon: ListChecks },
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
      {
        id: "whatsapp",
        label: "Prospection",
        icon: MessageCircle,
        children: [{ id: "mails", label: "Mails", icon: Mail, pinnable: true }],
      },
      { id: "prospection", label: "Pipeline", icon: Search },
      { id: "vivier", label: "Scouting", icon: UserPlus },
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
      {
        id: "acces",
        label: "Accès",
        icon: KeyRound,
        children: [
          { id: "comptes", label: "Comptes app" },
          { id: "emails", label: "E-mails créateurs" },
        ],
      },
      { id: "parametres", label: "Paramètres", icon: Settings },
      { id: "diagnostique", label: "Diagnostique", icon: HeartPulse },
    ],
  },
];

export const ALL_ITEMS: NavItem[] = NAV.flatMap((f) => f.items);

export function findItem(id: ViewId): NavItem | undefined {
  return ALL_ITEMS.find((i) => i.id === id);
}

/** Page épinglable : une entrée de nav, ou une sous-page qui est aussi une page (Mails). */
export function findPinnable(id: ViewId): NavItem | undefined {
  const it = findItem(id);
  if (it) return it;
  for (const i of ALL_ITEMS) {
    const c = (i.children ?? []).find((x) => x.id === id && x.pinnable);
    if (c) return { id: c.id as ViewId, label: c.label, icon: c.icon ?? i.icon };
  }
  return undefined;
}

/** Titre affiché d'une vue : entrée de nav, sinon SOUS-PAGE portant le même id
 *  (ex. Mails, sous-page de Prospection), sinon libellés fixes. Sans ce repli, une
 *  vue devenue sous-page s'affichait avec le titre « Aperçu ». */
export function viewTitle(id: string): string {
  const it = ALL_ITEMS.find((i) => i.id === id);
  if (it) return it.label;
  for (const i of ALL_ITEMS) for (const c of i.children ?? []) if (c.id === id) return c.label;
  return id === "corbeille" ? "Corbeille" : "Aperçu";
}
