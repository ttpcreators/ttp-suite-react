/*
 * Bibliothèque d'icônes de l'app : TOUT le code importe ses icônes d'ici, jamais
 * directement de « lucide-react ».
 *
 *   • Les icônes courantes (facture, mail, calendrier, personne, document, cloche…)
 *     sont remplacées par les icônes TTP dessinées pour l'app (motif du toit, voir
 *     ./ttp-icons.tsx) : un seul changement ici les met à jour partout.
 *   • Les petites icônes d'interface (flèches, croix, plus, crayon…) restent celles
 *     de lucide, avec le trait fin et les angles vifs posés par index.css.
 *
 * Un export nommé l'emporte sur le même nom venu de `export *` : c'est ce qui fait
 * passer « Receipt », « Mail »… sur la version TTP sans toucher aux pages.
 */
export * from "lucide-react";
export {
  // Favoris et pages
  TtpHome as House, TtpHome as Home, TtpHome as LayoutDashboard,
  TtpTodo as ListChecks, TtpTodo as SquareCheck, TtpTodo as SquareCheckBig, TtpTodo as CheckSquare,
  TtpMail as Mail, TtpMail as MailOpen, TtpMail as Inbox,
  TtpMessages as MessageSquare, TtpMessages as MessagesSquare, TtpMessages as MessageCircle,
  TtpCollabs as Milestone, TtpCollabs as Handshake,
  TtpPlanning as CalendarDays, TtpPlanning as Calendar,
  TtpDeadline as CalendarClock, TtpDeadline as Hourglass,
  // Talents
  TtpPerson as Users, TtpPerson as UsersRound, TtpPerson as User, TtpPerson as UserRound,
  TtpScouting as UserPlus,
  TtpEngagement as Heart,
  TtpEvolution as TrendingUp,
  TtpPulse as Activity, TtpPulse as HeartPulse,
  TtpMediakit as Image, TtpMediakit as ImageIcon,
  TtpTag as Tag,
  TtpCamera as Camera,
  // Prospection
  TtpContacts as Contact,
  TtpSourcing as Radar, TtpSourcing as Binoculars,
  TtpSend as Send,
  TtpBuilding as Building2, TtpBuilding as Store,
  TtpPhone as Phone,
  // Collaborations
  TtpBrief as FileText, TtpBrief as File,
  TtpContract as ScrollText,
  TtpGift as Gift,
  TtpReport as FileChartColumn,
  TtpIdea as Lightbulb,
  TtpMission as Flag,
  TtpPackage as Package,
  TtpNote as StickyNote,
  TtpTrophy as Trophy,
  // Finance
  TtpInvoice as Receipt, TtpInvoice as ReceiptText,
  TtpBell as Bell, TtpBell as AlarmClock,
  TtpTransfer as ArrowLeftRight,
  TtpGains as Wallet,
  TtpStats as BarChart3, TtpStats as ChartColumn, TtpStats as FileBarChart,
  TtpTarget as Target,
  // Intelligence, ressources, réglages
  TtpSpark as Sparkles, TtpSpark as Sparkle, TtpSpark as Bot,
  TtpHistory as History,
  TtpFiles as Files,
  TtpFolder as FolderOpen, TtpFolder as Folder,
  TtpTemplate as LayoutTemplate,
  TtpChecklist as CheckCircle2, TtpChecklist as CircleCheck,
  TtpLock as KeyRound, TtpLock as Lock,
  TtpSliders as Settings, TtpSliders as Settings2, TtpSliders as SlidersHorizontal,
  TtpGuide as BookOpen,
  TtpClock as Clock,
  TtpRepeat as RefreshCw, TtpRepeat as Repeat,
  TtpAlert as AlertTriangle, TtpAlert as TriangleAlert,
  TtpStar as Star,
  TtpSearch as Search,
  TtpTrash as Trash2, TtpTrash as Trash,
} from "./ttp-icons";
