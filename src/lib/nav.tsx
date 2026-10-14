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
  Radar,
  MessagesSquare,
  type LucideIcon,
  Mail,
  Tag,
  Sun,
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
  | "pricing"
  | "vivier"
  | "sourcing"
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
  | "messages"
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

// Organisation par MÉTIER (refaite le 2026-10-14) : chaque section = un moment de travail,
// pour retrouver une page « là où on la cherche ».
//   • Pilotage : où en est l'agence ;          • Au quotidien : ce qu'on ouvre tous les jours ;
//   • Créateurs : le roster et ses chiffres ;  • Prospection : trouver et démarcher les marques ;
//   • Collaborations : livrer une campagne ;   • Finance, Ressources, Réglages.
// Les `id` ne changent JAMAIS (raccourcis, droits, onglets enregistrés) : seuls l'ordre,
// le rangement et les libellés bougent.
export const NAV: NavFamily[] = [
  {
    id: "pilotage",
    label: "Pilotage",
    icon: Gauge,
    items: [
      { id: "apercu", label: "Aperçu", icon: LayoutDashboard },
      { id: "stats", label: "Stats", icon: TrendingUp },
      { id: "objectifs", label: "Objectifs", icon: Target },
      { id: "agent", label: "Agent", icon: Bot },
      { id: "activite", label: "Activité", icon: History },
    ],
  },
  {
    id: "quotidien",
    label: "Au quotidien",
    icon: Sun,
    items: [
      { id: "todo", label: "To-do", icon: ListChecks },
      {
        id: "planning",
        label: "Planning",
        icon: CalendarDays,
        children: [
          { id: "agenda", label: "Agenda" },
          { id: "instagram", label: "Posts Instagram" },
        ],
      },
      { id: "mails", label: "Mails", icon: Mail },
      { id: "messages", label: "DM Instagram", icon: MessagesSquare },
    ],
  },
  {
    id: "createurs",
    label: "Créateurs",
    icon: Users,
    items: [
      { id: "roster", label: "Roster", icon: Users },
      { id: "engagement", label: "Engagement", icon: BarChart3 },
      { id: "suivi", label: "Évolution", icon: Activity },
      { id: "pricing", label: "Tarifs", icon: Tag },
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
      { id: "vivier", label: "Scouting", icon: UserPlus },
    ],
  },
  {
    id: "relations",
    label: "Prospection",
    icon: Handshake,
    items: [
      { id: "contacts", label: "Contacts", icon: Contact },
      { id: "whatsapp", label: "À contacter", icon: MessageCircle },
      { id: "prospection", label: "Pipeline", icon: Search },
      { id: "sourcing", label: "Sourcing", icon: Radar },
    ],
  },
  {
    id: "travail",
    label: "Collaborations",
    icon: Briefcase,
    items: [
      { id: "collabs", label: "Collabs", icon: Milestone },
      { id: "briefs", label: "Briefs", icon: FileText },
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
      { id: "echeances", label: "Fins de contrat", icon: CalendarClock },
      { id: "gifting", label: "Gifting", icon: Gift },
      { id: "debrief", label: "Debrief", icon: FileChartColumn },
      { id: "ideas", label: "Idées", icon: Lightbulb },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    icon: CreditCard,
    items: [
      { id: "facturation", label: "Facturation", icon: Receipt },
      { id: "relances", label: "Relances", icon: AlarmClock },
      { id: "reversements", label: "Reversements", icon: Wallet },
    ],
  },
  {
    id: "ressources",
    label: "Ressources",
    icon: FolderOpen,
    items: [
      { id: "documents", label: "Documents", icon: Files },
      { id: "templates", label: "Modèles", icon: LayoutTemplate },
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
      { id: "diagnostique", label: "Diagnostic", icon: HeartPulse },
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
