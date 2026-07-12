import { useEffect, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import NumberFlow from "@number-flow/react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { fmtCompact } from "@/lib/timeSeries";
import {
  LayoutDashboard,
  ListChecks,
  Lightbulb,
  FileText,
  CalendarDays,
  Files,
  Receipt,
  LogOut,
  Moon,
  Sun,
  Pencil,
  Check,
  Trash2,
  TrendingUp,
  ExternalLink,
  BarChart3,
  Contact,
  X,
  Copy,
  List,
  Columns3,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { titleCase } from "@/lib/utils";
import { frDate, toISODate } from "@/lib/dates";
import { notifyAgency } from "@/lib/push";
import { PushCard } from "@/components/ui/push-card";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { dbInsert, dbUpdate, dbDelete, nextOrder } from "@/lib/db";
import { toast } from "@/components/ui/toast";
import { AddButton, InlineForm, TextField, SelectField, AutoGrowTextField } from "@/components/ui/form";
import { GooeyTabs } from "@/components/ui/gooey-tabs";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { ActionMenu, ConfirmDialog } from "@/components/ui/action-menu";
import { StatusSelect, type StatusOption } from "@/components/ui/status-select";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { ExpandableTabs } from "@/components/ui/be-ui-expandable-tabs";
import { EventCalendar, type Ev as CalEv } from "@/components/ui/event-calendar";
import { parseAmount, formatEuro } from "@/lib/appState";
import { useLiveKey } from "@/lib/useLive";
import { AvatarUpload } from "@/components/ui/avatar-upload";
import { SuiviPanel, type SuiviEntry } from "@/views/EngagementSuivi";

const BASE = import.meta.env.BASE_URL;

type Creator = {
  id: string;
  name: string;
  handle: string | null;
  niche: string | null;
  followers: string | null;
  er: string | null;
  ca: string | null;
  reach: string | null;
  photo_url: string | null;
  status: string | null;
  ville: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  siren: string | null;
  birth: string | null;
  commission: string | null;
  instagram: string | null;
  tiktok: string | null;
  email_pro: string | null;
};
type Todo = { id: string; text: string; descr: string | null; due: string | null; priority: string | null; done: boolean; status?: string | null; sort_order?: number };
type Idea = { id: string; text: string; status: string | null; sort_order?: number };
type Brief = { id: string; brand: string; deliverables: string | null; due: string | null; status: string | null };
type Ev = { id: string; date: string | null; day: number | null; time: string | null; title: string; type: string };
type Doc = { id: string; name: string; type: string | null; size: string | null; path: string | null; created_at: string | null };
type Invoice = { ref: string; party: string; amount: string | null; date: string | null; status: string | null };
type Contact = { id: string; brand: string; person: string | null; role: string | null; email: string | null; phone: string | null; sort_order?: number };

type Tab = "accueil" | "evolution" | "debrief" | "todo" | "ideas" | "briefs" | "planning" | "contacts" | "documents" | "facturation";
const TABS: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "accueil", label: "Accueil", icon: LayoutDashboard },
  { id: "evolution", label: "Évolution", icon: TrendingUp },
  { id: "debrief", label: "Debrief", icon: BarChart3 },
  { id: "todo", label: "À faire", icon: ListChecks },
  { id: "ideas", label: "Idées", icon: Lightbulb },
  { id: "briefs", label: "Briefs", icon: FileText },
  { id: "planning", label: "Planning", icon: CalendarDays },
  { id: "contacts", label: "Contacts", icon: Contact },
  { id: "documents", label: "Documents", icon: Files },
  { id: "facturation", label: "Facturation", icon: Receipt },
];

// Regroupement des onglets en familles pour la nav mobile animée (ExpandableTabs,
// même composant que l'espace agence) : on tape une famille → ses pages se déploient.
const MOBILE_FAMILIES: { id: string; label: string; icon: typeof LayoutDashboard; items: Tab[] }[] = [
  { id: "espace", label: "Mon espace", icon: LayoutDashboard, items: ["accueil", "evolution", "debrief"] },
  { id: "travail", label: "Mon travail", icon: ListChecks, items: ["todo", "ideas", "briefs", "planning", "contacts"] },
  { id: "fichiers", label: "Fichiers", icon: Files, items: ["documents", "facturation"] },
];

/** Carte animée (identique à l'Aperçu agence : entrée douce + délai décalé). */
function Card({ children, className = "", index = 0, onClick }: { children: ReactNode; className?: string; index?: number; onClick?: () => void }) {
  return (
    <motion.div
      initial={{ y: 14 }}
      animate={{ y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.4, ease: "easeOut" }}
      onClick={onClick}
      className={"rounded-2xl border border-border bg-surface p-5 shadow-sm " + (onClick ? "cursor-pointer transition-colors hover:bg-rowhover " : "") + className}
    >
      {children}
    </motion.div>
  );
}


/** Parse un champ texte ("10 600", "0,89 %", "10,6K", "1,2M") en nombre, ou null. */
function toNum(s?: string | null): number | null {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t || t === "—") return null;
  const km = /^([\d\s.,]+)\s*([kKmM])\b/.exec(t);
  const core = (km ? km[1] : t).replace(/\s/g, "").replace(",", ".").replace(/[^\d.]/g, "");
  let n = parseFloat(core);
  if (!Number.isFinite(n)) return null;
  if (km) n *= km[2].toLowerCase() === "m" ? 1e6 : 1e3;
  return n;
}

/** Tuile de statistique avec chiffre animé (NumberFlow) — « — » si donnée absente. */
function StatTile({ label, value, kind }: { label: string; value: number | null; kind: "int" | "pct" | "eur" }) {
  return (
    <div className="rounded-xl bg-panel p-4">
      <div className="flex items-baseline text-[22px] font-bold tracking-tight text-foreground">
        {value == null ? (
          <span>—</span>
        ) : (
          <>
            <NumberFlow
              value={value}
              locales="fr-FR"
              format={kind === "eur" ? { style: "currency", currency: "EUR", maximumFractionDigits: 0 } : { maximumFractionDigits: kind === "pct" ? 2 : 0 }}
            />
            {kind === "pct" && <span className="ml-0.5 text-base">%</span>}
          </>
        )}
      </div>
      <div className="mt-1 text-[10px] font-medium text-faint">{label}</div>
    </div>
  );
}

/** "jj/mm/aaaa" → timestamp (tri chronologique des mesures). */
function frTime(s: string): number {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec((s ?? "").trim());
  if (!m) return 0;
  const y = m[3].length === 2 ? "20" + m[3] : m[3];
  return new Date(Number(y), Number(m[2]) - 1, Number(m[1])).getTime();
}

/** Graphique d'évolution des abonnés (même DA que l'Aperçu agence : aire + dégradé). */
function FollowerArea({ points }: { points: { label: string; abonnes: number }[] }) {
  return (
    <ChartContainer config={{}} className="mt-4 h-[170px]">
      <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="csFollowers" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2b7fff" stopOpacity={0.24} />
            <stop offset="100%" stopColor="#2b7fff" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="4 10" stroke="var(--color-border)" strokeOpacity={0.6} vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} tickMargin={8} interval="preserveStartEnd" minTickGap={14} />
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v) => fmtCompact(Number(v))} width={40} />
        <Tooltip content={<ChartTooltip unit="" />} cursor={{ stroke: "#2b7fff", strokeWidth: 1, strokeOpacity: 0.4 }} />
        <Area type="monotone" dataKey="abonnes" name="Abonnés" stroke="#2b7fff" strokeWidth={2.5} fill="url(#csFollowers)" dot={false} activeDot={{ r: 4, fill: "#2b7fff", stroke: "var(--color-surface)", strokeWidth: 2 }} />
      </AreaChart>
    </ChartContainer>
  );
}

/** Sous-menu déployé d'une famille (liste ses pages). */
function CreatorMobileMenu({ ids, onSelect }: { ids: Tab[]; onSelect: (id: Tab) => void }) {
  return (
    <div className="flex w-[14rem] flex-col gap-0.5">
      {ids.map((id) => {
        const t = TABS.find((x) => x.id === id);
        if (!t) return null;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <t.icon className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Debrief (lecture seule côté créateur). */
type DebriefLite = {
  brand: string; creator: string; period: string; deliverables?: string;
  budget: string; revenue: string; roi: string; summary: string;
  kpis: { l: string; v: string }[]; highlights: string[];
};

const BRIEF_STATUS: StatusOption[] = [
  { value: "attente", label: "En attente", dot: "bg-amber" },
  { value: "valider", label: "À valider", dot: "bg-primary" },
  { value: "cours", label: "En cours", dot: "bg-cyan" },
  { value: "terminé", label: "Terminé", dot: "bg-signal" },
];
// Statuts d'idée — identiques à l'espace agence (page Idées).
const IDEA_STATUS: StatusOption[] = [
  { value: "À explorer", label: "À explorer", dot: "bg-indigo" },
  { value: "À faire", label: "À faire", dot: "bg-primary" },
  { value: "En cours", label: "En cours", dot: "bg-cyan" },
  { value: "Publiée", label: "Publiée", dot: "bg-signal" },
];

const PRIORITY_OPTIONS = [
  { value: "haute", label: "Haute" },
  { value: "moyenne", label: "Moyenne" },
  { value: "basse", label: "Basse" },
];
const prioBadge = (p: string | null) => (p === "haute" ? "danger" : p === "basse" ? "neutral" : "warning");

type TodoFilter = "encours" | "terminees" | "toutes";
const TODO_FILTERS: { id: TodoFilter; label: string }[] = [
  { id: "encours", label: "En cours" },
  { id: "terminees", label: "Terminées" },
  { id: "toutes", label: "Toutes" },
];
const TODO_STATUS_OPTS: StatusOption[] = [
  { value: "À faire", label: "À faire", dot: "bg-primary" },
  { value: "En cours", label: "En cours", dot: "bg-cyan" },
  { value: "Fait", label: "Fait", dot: "bg-signal" },
];

const invStatus = (s: string | null): { status: "success" | "warning" | "danger" | "neutral"; label: string } => {
  if (s === "payee") return { status: "success", label: "Payée" };
  if (s === "attente") return { status: "warning", label: "En attente" };
  if (s === "retard") return { status: "danger", label: "En retard" };
  return { status: "neutral", label: "Brouillon" };
};

export function CreatorSpace({
  name,
  dark,
  onToggleTheme,
  onLogout,
}: {
  name: string;
  dark: boolean;
  onToggleTheme: () => void;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<Tab>("accueil");
  const [mobileTab, setMobileTab] = useState<string | null>(null); // famille déployée (nav mobile)
  const [confirmDoneTodo, setConfirmDoneTodo] = useState<Todo | null>(null); // anti-missclick « fait »
  // Historique d'engagement du créateur — via la fonction serveur creator-history
  // (le blob agence est inaccessible aux créateurs ; le serveur filtre sur SON nom).
  const [suivi, setSuivi] = useState<SuiviEntry[] | null>(null);
  const [suiviErr, setSuiviErr] = useState(false);
  useEffect(() => {
    // Chargé pour l'Évolution ET l'accueil (graphique d'abonnés).
    if ((tab !== "evolution" && tab !== "accueil") || suivi !== null || suiviErr) return;
    let alive = true;
    supabase.functions
      .invoke("creator-history")
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          setSuiviErr(true);
          return;
        }
        setSuivi(((data as { entries?: SuiviEntry[] } | null)?.entries ?? []) as SuiviEntry[]);
      })
      .catch(() => {
        if (alive) setSuiviErr(true);
      });
    return () => {
      alive = false;
    };
  }, [tab, suivi, suiviErr]);

  // Debriefs du créateur — via la fonction serveur debrief-history (blob agence filtré).
  const [debriefs, setDebriefs] = useState<DebriefLite[] | null>(null);
  const [debriefErr, setDebriefErr] = useState(false);
  useEffect(() => {
    if (tab !== "debrief" || debriefs !== null || debriefErr) return;
    let alive = true;
    supabase.functions
      .invoke("debrief-history")
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          setDebriefErr(true);
          return;
        }
        setDebriefs(((data as { debriefs?: DebriefLite[] } | null)?.debriefs ?? []) as DebriefLite[]);
      })
      .catch(() => {
        if (alive) setDebriefErr(true);
      });
    return () => {
      alive = false;
    };
  }, [tab, debriefs, debriefErr]);
  const [creator, setCreator] = useState<Creator | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);

  // todo filter
  const [todoFilter, setTodoFilter] = useState<TodoFilter>("encours");

  // "Mes infos" edit state
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Creator>>({});
  const [infoTab, setInfoTab] = useState<"stats" | "coord">("stats"); // carte Mes infos : onglet actif
  const [todoView, setTodoView] = useState<"liste" | "colonnes">(
    () => (localStorage.getItem("ttp:cs-todo-view") === "colonnes" ? "colonnes" : "liste"),
  );
  useEffect(() => { localStorage.setItem("ttp:cs-todo-view", todoView); }, [todoView]);
  // Sidebar desktop repliable en rail (mémorisé).
  const [sbCollapsed, setSbCollapsed] = useState(() => localStorage.getItem("ttp:cs-sidebar-collapsed") === "1");
  useEffect(() => { localStorage.setItem("ttp:cs-sidebar-collapsed", sbCollapsed ? "1" : "0"); }, [sbCollapsed]);

  // add-forms
  const [tdOpen, setTdOpen] = useState(false);
  const [tdText, setTdText] = useState("");
  const [tdDesc, setTdDesc] = useState("");
  const [tdDue, setTdDue] = useState("");
  const [tdPrio, setTdPrio] = useState("moyenne");
  const [idOpen, setIdOpen] = useState(false);
  const [idText, setIdText] = useState("");
  // édition inline d'une idée
  const [ideaEditId, setIdeaEditId] = useState<string | null>(null);
  const [ideaEditText, setIdeaEditText] = useState("");
  // add-contact form
  const [ctOpen, setCtOpen] = useState(false);
  const [ctBrand, setCtBrand] = useState("");
  const [ctPerson, setCtPerson] = useState("");
  const [ctRole, setCtRole] = useState("");
  const [ctEmail, setCtEmail] = useState("");
  const [ctPhone, setCtPhone] = useState("");
  // edit-contact (inline)
  const [ctEditId, setCtEditId] = useState<string | null>(null);
  const [ceBrand, setCeBrand] = useState("");
  const [cePerson, setCePerson] = useState("");
  const [ceRole, setCeRole] = useState("");
  const [ceEmail, setCeEmail] = useState("");
  const [cePhone, setCePhone] = useState("");

  // todo inline edit
  const [tdEditId, setTdEditId] = useState<string | null>(null);
  const [teText, setTeText] = useState("");
  const [teDesc, setTeDesc] = useState("");
  const [tePrio, setTePrio] = useState("moyenne");

  const live = useLiveKey();

  useEffect(() => {
    let alive = true;
    supabase
      .from("creators")
      .select("*")
      .eq("name", name)
      .limit(1)
      .then(({ data, error }) => {
        if (error) console.error("Espace créateur — chargement de la fiche échoué:", error);
        if (alive) setCreator((data?.[0] as Creator) ?? null);
      });
    supabase.from("todos").select("id,text,descr,due,priority,done,status,sort_order").eq("creator", name).order("sort_order").then(({ data }) => alive && setTodos((data as Todo[]) ?? []));
    supabase.from("ideas").select("id,text,status,sort_order").eq("creator", name).order("sort_order").then(({ data }) => alive && setIdeas((data as Idea[]) ?? []));
    supabase.from("briefs").select("id,brand,deliverables,due,status").eq("creator", name).then(({ data }) => alive && setBriefs((data as Brief[]) ?? []));
    supabase.from("events").select("id,date,day,time,title,type,who").or("deleted.is.null,deleted.eq.false").then(({ data }) => {
      if (!alive) return;
      const rows = (data as (Ev & { who: string | null })[]) ?? [];
      setEvents(rows.filter((e) => (e.who ?? "").split(", ").includes(name)));
    });
    supabase.from("documents").select("id,name,type,size,path,created_at").eq("creator", name).then(({ data }) => alive && setDocs((data as Doc[]) ?? []));
    supabase.from("invoices").select("ref,party,amount,date,status").eq("creator", name).then(({ data }) => alive && setInvoices((data as Invoice[]) ?? []));
    // Contacts propres au créateur (RLS : il ne voit QUE ses lignes, jamais celles de l'agence).
    supabase.from("contacts").select("id,brand,person,role,email,phone,sort_order").eq("creator", name).order("sort_order").then(({ data }) => alive && setContacts((data as Contact[]) ?? []));
    return () => {
      alive = false;
    };
  }, [name, live]);

  const firstName = titleCase(name).split(" ")[0];

  // Le créateur peut faire évoluer le statut de ses briefs (synchro agence via la table).
  const setBriefStatus = async (id: string, status: string) => {
    setBriefs((prev) => prev.map((b) => (b.id === id ? { ...b, status } : b)));
    if (!(await dbUpdate("briefs", id, { status }))) toast("Erreur — réessaie");
  };

  const addTodo = async () => {
    if (!tdText.trim()) {
      toast("Écris ta tâche");
      return;
    }
    const row = {
      text: tdText.trim(),
      descr: tdDesc.trim(),
      tag: "PERSO",
      due: tdDue.trim() || "—",
      creator: name,
      priority: tdPrio,
      source: "creator",
      done: false,
      sort_order: nextOrder(todos),
    };
    const created = await dbInsert("todos", row);
    if (!created) {
      toast("Erreur — réessaie");
      return;
    }
    setTodos([created as unknown as Todo, ...todos]);
    notifyAgency("tache", name, row.text); // push immédiat côté agence
    toast("Tâche ajoutée ✓");
    setTdOpen(false);
    setTdText("");
    setTdDesc("");
    setTdDue("");
    setTdPrio("moyenne");
  };

  const addIdea = async () => {
    if (!idText.trim()) {
      toast("Écris ton idée");
      return;
    }
    const row = { text: idText.trim(), creator: name, status: "À faire", source: "creator", sort_order: nextOrder(ideas) };
    const created = await dbInsert("ideas", row);
    if (!created) {
      toast("Erreur — réessaie");
      return;
    }
    setIdeas([created as unknown as Idea, ...ideas]);
    notifyAgency("idee", name, row.text); // push immédiat côté agence
    toast("Idée ajoutée ✓");
    setIdOpen(false);
    setIdText("");
  };

  const setIdeaStatus = async (x: Idea, status: string) => {
    setIdeas((prev) => prev.map((y) => (y.id === x.id ? { ...y, status } : y)));
    if (!(await dbUpdate("ideas", x.id, { status }))) toast("Erreur — réessaie");
  };

  const saveIdeaEdit = async (id: string) => {
    const t = ideaEditText.trim();
    if (!t) {
      toast("L'idée ne peut pas être vide");
      return;
    }
    setIdeas((prev) => prev.map((x) => (x.id === id ? { ...x, text: t } : x)));
    setIdeaEditId(null);
    if (!(await dbUpdate("ideas", id, { text: t }))) toast("Erreur — réessaie");
    else toast("Idée modifiée ✓");
  };

  const addContact = async () => {
    if (!ctBrand.trim() && !ctPerson.trim()) {
      toast("Renseigne au moins la marque ou le nom");
      return;
    }
    const row = {
      brand: ctBrand.trim() || ctPerson.trim(),
      person: ctPerson.trim() || "—",
      role: ctRole.trim() || null,
      email: ctEmail.trim() || null,
      phone: ctPhone.trim() || null,
      tag: "Perso",
      tone: "cyan",
      creator: name, // RLS : le créateur ne peut insérer QUE pour lui-même
      sort_order: nextOrder(contacts),
    };
    const created = await dbInsert("contacts", row);
    if (!created) {
      toast("Erreur — réessaie");
      return;
    }
    setContacts([created as unknown as Contact, ...contacts]);
    notifyAgency("contact", name, row.brand); // push immédiat côté agence
    toast("Contact ajouté ✓");
    setCtOpen(false);
    setCtBrand("");
    setCtPerson("");
    setCtRole("");
    setCtEmail("");
    setCtPhone("");
  };

  const startEditContact = (c: Contact) => {
    setCtEditId(c.id);
    setCeBrand(c.brand ?? "");
    setCePerson(c.person && c.person !== "—" ? c.person : "");
    setCeRole(c.role ?? "");
    setCeEmail(c.email ?? "");
    setCePhone(c.phone ?? "");
  };
  const saveContactEdit = async () => {
    if (!ctEditId) return;
    if (!ceBrand.trim() && !cePerson.trim()) {
      toast("Renseigne au moins la marque ou le nom");
      return;
    }
    const patch = {
      brand: ceBrand.trim() || cePerson.trim(),
      person: cePerson.trim() || "—",
      role: ceRole.trim() || null,
      email: ceEmail.trim() || null,
      phone: cePhone.trim() || null,
    };
    const id = ctEditId;
    setContacts((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    setCtEditId(null);
    if (!(await dbUpdate("contacts", id, patch))) toast("Erreur — réessaie");
    else toast("Contact modifié ✓");
  };

  const startEdit = () => {
    if (!creator) return;
    setForm({
      ville: creator.ville ?? "",
      phone: creator.phone ?? "",
      email: creator.email ?? "",
      email_pro: creator.email_pro ?? "",
      instagram: creator.instagram ?? "",
      tiktok: creator.tiktok ?? "",
      address: creator.address ?? "",
      siren: creator.siren ?? "",
      birth: toISODate(creator.birth),
      followers: creator.followers ?? "",
      er: creator.er ?? "",
      ca: creator.ca ?? "",
      reach: creator.reach ?? "",
    });
    setEditing(true);
  };

  const saveInfos = async () => {
    if (!creator) return;
    const patch = {
      ville: (form.ville ?? "").trim(),
      phone: (form.phone ?? "").trim(),
      email: (form.email ?? "").trim(),
      email_pro: (form.email_pro ?? "").trim(),
      instagram: (form.instagram ?? "").trim(),
      tiktok: (form.tiktok ?? "").trim(),
      address: (form.address ?? "").trim(),
      siren: (form.siren ?? "").trim(),
      birth: (form.birth ?? "").trim(),
      followers: (form.followers ?? "").trim(),
      er: (form.er ?? "").trim(),
      ca: (form.ca ?? "").trim(),
      reach: (form.reach ?? "").trim(),
    };
    if (!(await dbUpdate("creators", creator.id, patch))) {
      toast("Erreur — réessaie");
      return;
    }
    setCreator({ ...creator, ...patch });
    setEditing(false);
    toast("Infos enregistrées ✓");
  };

  const setField = (k: keyof Creator, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // CA encaissé = somme des factures payées du créateur (auto, cohérent avec l'agence).
  const caEncaisse = invoices.filter((i) => i.status === "payee").reduce((a, i) => a + parseAmount(i.amount), 0);
  // Évolution des abonnés (depuis les mesures agence) — 1 point par date (valeur max = plateforme principale).
  const followerPoints = (() => {
    const byDate = new Map<number, number>();
    for (const e of suivi ?? []) {
      const t = frTime(e.date);
      if (!t) continue;
      byDate.set(t, Math.max(byDate.get(t) ?? 0, toNum(e.followers) ?? 0));
    }
    return [...byDate.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, f]) => ({ label: new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(new Date(t)).replace(".", ""), abonnes: f }))
      .filter((p) => p.abonnes > 0);
  })();
  const filteredTodos =
    todoFilter === "encours" ? todos.filter((t) => !t.done) : todoFilter === "terminees" ? todos.filter((t) => t.done) : todos;

  const encaisse = invoices.filter((i) => i.status === "payee").reduce((a, i) => a + parseAmount(i.amount), 0);
  const totalFacture = invoices.reduce((a, i) => a + parseAmount(i.amount), 0);

  const markTodo = async (t: Todo, next: boolean) => {
    // On écrit done ET status ensemble (comme l'agence) → l'affichage statut/kanban
    // reste cohérent des deux côtés (audit : ne pas laisser status désynchronisé).
    const status = next ? "Fait" : "À faire";
    if (await dbUpdate("todos", t.id, { done: next, status })) {
      setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: next, status } : x)));
      toast(next ? "Fait ✓" : "À refaire");
    } else {
      toast("Erreur — réessaie");
    }
  };

  // Change le statut d'une tâche depuis la vue colonnes (done dérivé de « Fait »).
  const setTodoStatus = async (t: Todo, status: string) => {
    const done = status === "Fait";
    setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, status, done } : x)));
    if (!(await dbUpdate("todos", t.id, { status, done }))) toast("Erreur — réessaie");
  };

  const cStatus = (t: Todo): string => t.status ?? (t.done ? "Fait" : "À faire");

  const startEditTodo = (t: Todo) => {
    setTdEditId(t.id);
    setTeText(t.text);
    setTeDesc(t.descr ?? "");
    setTePrio(t.priority ?? "moyenne");
  };

  const saveEditTodo = async () => {
    if (!tdEditId) return;
    if (!teText.trim()) {
      toast("Écris ta tâche");
      return;
    }
    const patch = { text: teText.trim(), descr: teDesc.trim(), priority: tePrio };
    if (!(await dbUpdate("todos", tdEditId, patch))) {
      toast("Erreur — réessaie");
      return;
    }
    setTodos((prev) => prev.map((x) => (x.id === tdEditId ? { ...x, ...patch } : x)));
    toast("Tâche modifiée ✓");
    setTdEditId(null);
  };


  const coordRow = (label: string, val: string | null, copyable = false, platform?: string) => (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0">
      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-faint" title={label}>
        {platform ? <PlatformIcon platform={platform} className="h-4 w-4 text-foreground" /> : null}
        {platform ? <span className="sr-only">{label}</span> : label}
      </span>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-xs text-foreground">{val || "—"}</span>
        {copyable && val && (
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(val);
              toast(`${label} copié ✓`);
            }}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-rowhover hover:text-foreground"
            title={`Copier ${label.toLowerCase()}`}
          >
            <Copy className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );

  const editInput = (label: string, k: keyof Creator, placeholder?: string, type?: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</span>
      <input
        type={type}
        value={(form[k] as string) ?? ""}
        onChange={(e) => setField(k, e.target.value)}
        placeholder={placeholder}
        className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary"
      />
    </label>
  );

  return (
    <div className="h-[100dvh] bg-background p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] md:p-[14px] md:pt-[14px] md:pb-[14px]">
      <div className="flex h-full overflow-hidden rounded-[22px]">
        {/* Sidebar desktop repliable */}
        {sbCollapsed ? (
          <aside className="hidden w-[68px] shrink-0 flex-col items-center p-2 md:flex">
            <div className="mt-1 h-9 w-9 shrink-0 overflow-hidden rounded-[8px] bg-[#14181E]">
              <img src={`${BASE}cover.png`} alt="TTP" className="h-full w-full object-cover" />
            </div>
            <button
              type="button"
              onClick={() => setSbCollapsed(false)}
              className="mt-2 grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-faint shadow-sm transition-colors hover:text-foreground"
              title="Déplier le menu"
              aria-label="Déplier le menu"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
            <nav className="mt-3 flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  title={t.label}
                  className={
                    "grid h-10 w-10 shrink-0 place-items-center rounded-[10px] transition-colors " +
                    (tab === t.id ? "bg-primary/10 text-primary" : "text-faint hover:bg-rowhover hover:text-foreground")
                  }
                >
                  <t.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                </button>
              ))}
            </nav>
            <div className="mt-auto flex w-full flex-col items-center gap-1 border-t border-border pt-2">
              <button type="button" onClick={onToggleTheme} title={dark ? "Mode clair" : "Mode sombre"} className="grid h-10 w-10 place-items-center rounded-[10px] text-faint transition-colors hover:bg-rowhover hover:text-foreground">
                {dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
              </button>
              <button type="button" onClick={onLogout} title="Se déconnecter" className="grid h-10 w-10 place-items-center rounded-[10px] text-faint transition-colors hover:bg-rowhover hover:text-foreground">
                <LogOut className="h-[18px] w-[18px]" strokeWidth={1.75} />
              </button>
            </div>
          </aside>
        ) : (
          <aside className="hidden w-[240px] shrink-0 flex-col p-3 md:flex">
            <div className="flex items-center gap-3 px-1.5 py-2.5">
              <div className="h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-[#14181E]">
                <img src={`${BASE}cover.png`} alt="TTP" className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold leading-tight">Espace créateur</div>
                <div className="text-[11px] text-faint">TTP Creators</div>
              </div>
              <button
                type="button"
                onClick={() => setSbCollapsed(true)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                title="Replier le menu"
                aria-label="Replier le menu"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
            <nav className="mt-3 flex flex-1 flex-col gap-0.5 overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={
                    "group flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-[9px] text-left text-[13px] transition-colors " +
                    (tab === t.id ? "bg-rowhover font-medium text-foreground" : "text-muted-foreground hover:bg-rowhover hover:text-foreground")
                  }
                >
                  <t.icon
                    className={"h-4 w-4 shrink-0 " + (tab === t.id ? "text-primary" : "text-faint group-hover:text-foreground/70")}
                    strokeWidth={1.75}
                  />
                  {t.label}
                </button>
              ))}
            </nav>
            <div className="mt-auto flex flex-col gap-0.5 border-t border-border pt-3">
              <button
                type="button"
                onClick={onToggleTheme}
                className="flex items-center gap-2.5 rounded-[7px] px-2.5 py-[7px] text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
              >
                {dark ? <Sun className="h-4 w-4 text-faint" /> : <Moon className="h-4 w-4 text-faint" />}
                <span className="text-[13px]">{dark ? "Mode clair" : "Mode sombre"}</span>
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="flex items-center gap-2.5 rounded-[7px] px-2.5 py-[7px] text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
              >
                <LogOut className="h-4 w-4 text-faint" />
                <span className="text-[13px]">Se déconnecter</span>
              </button>
            </div>
          </aside>
        )}

        {/* Panneau principal — pb-28 sur mobile pour dégager la barre flottante du bas */}
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto rounded-[22px] bg-panel px-4 pb-28 pt-4 md:px-6 md:pb-8 md:pt-6">
          {/* Barre du haut (mobile) */}
          <div className="mb-5 flex items-center justify-between gap-3 md:hidden">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 overflow-hidden rounded-lg bg-[#14181E]">
                <img src={`${BASE}cover.png`} alt="TTP" className="h-full w-full object-cover" />
              </div>
              <div>
                <div className="text-sm font-semibold leading-tight">Espace créateur</div>
                <div className="text-[11px] text-faint">TTP Creators</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onToggleTheme} className="grid h-9 w-9 place-items-center rounded-lg bg-surface text-foreground shadow-sm transition-colors hover:bg-rowhover" aria-label="Thème">
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <button type="button" onClick={onLogout} className="grid h-9 w-9 place-items-center rounded-lg bg-surface text-foreground shadow-sm transition-colors hover:bg-rowhover" aria-label="Déconnexion">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Header (façon Aperçu agence : petit bonjour + gros titre, avatar à droite) */}
          <div className="mb-5 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1.5 text-sm text-foreground">Bonjour {firstName} ✌️</div>
              <div className="text-[26px] font-semibold tracking-tight md:text-[30px]">Mon espace</div>
            </div>
            <AvatarUpload
              creatorId={creator?.id}
              name={name}
              photoUrl={creator?.photo_url ?? null}
              size={52}
              onUploaded={(url) => setCreator((c) => (c ? { ...c, photo_url: url } : c))}
            />
          </div>

          {/* (Nav mobile déplacée en barre flottante fixe en bas — voir plus bas.) */}

          {/* Contenu des onglets — barrière d'erreur : un onglet qui plante
              n'emporte pas la navigation (la sidebar reste cliquable). */}
          <ErrorBoundary variant="inline" label="Cette page" resetKey={tab}>
          {/* Accueil */}
          {tab === "accueil" && (
            <div className="flex flex-col gap-4">
              <PushCard />

              {/* Évolution des abonnés — même graphique que l'Aperçu agence */}
              <Card index={1}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">Évolution des abonnés</div>
                    <div className="mt-0.5 text-[11px] text-faint">D'après les mesures de ton agence</div>
                  </div>
                  {followerPoints.length > 0 && (
                    <div className="text-2xl font-bold tracking-tight text-foreground">
                      {fmtCompact(followerPoints[followerPoints.length - 1].abonnes)}
                    </div>
                  )}
                </div>
                {followerPoints.length >= 2 ? (
                  <FollowerArea points={followerPoints} />
                ) : (
                  <div className="mt-4 grid h-[120px] place-items-center rounded-xl bg-panel/40 px-4 text-center text-xs leading-relaxed text-muted-foreground">
                    {suivi === null
                      ? "Chargement…"
                      : "Pas encore assez de mesures pour tracer la courbe. Ton agence doit enregistrer au moins 2 relevés d'abonnés à des dates différentes."}
                  </div>
                )}
              </Card>

              {/* Mes infos — carte premium : toggle Statistiques / Coordonnées + chiffres animés */}
              <Card index={0}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">Mes infos</div>
                  {editing ? (
                    <button
                      type="button"
                      onClick={saveInfos}
                      className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
                    >
                      <Check className="h-3.5 w-3.5" /> Enregistrer
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={startEdit}
                      disabled={!creator}
                      className="flex h-8 items-center gap-1.5 rounded-lg bg-panel px-3 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-rowhover disabled:opacity-50"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Modifier
                    </button>
                  )}
                </div>

                {editing ? (
                  <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {editInput("Ville", "ville")}
                      {editInput("Téléphone", "phone")}
                      {editInput("Email perso", "email")}
                      {editInput("Email pro", "email_pro")}
                      {editInput("Instagram", "instagram")}
                      {editInput("TikTok", "tiktok")}
                      {editInput("Adresse", "address")}
                      {editInput("SIREN", "siren")}
                      {editInput("Naissance", "birth", undefined, "date")}
                    </div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">Statistiques</div>
                    <div className="grid grid-cols-3 gap-3">
                      {editInput("Abonnés", "followers")}
                      {editInput("Engagement", "er")}
                      {editInput("Reach", "reach")}
                    </div>
                    <p className="text-[11px] text-faint">Le CA est calculé automatiquement depuis tes factures payées.</p>
                  </div>
                ) : (
                  <>
                    {/* Toggle segmenté « gooey » (la pastille active se déforme en glissant) */}
                    <GooeyTabs
                      className="mb-4"
                      value={infoTab}
                      onChange={(v) => setInfoTab(v as "stats" | "coord")}
                      tabs={[{ value: "stats", label: "Statistiques" }, { value: "coord", label: "Coordonnées" }]}
                    />

                    <AnimatePresence mode="wait" initial={false}>
                      {infoTab === "stats" ? (
                        <motion.div
                          key="stats"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.2 }}
                          className="grid grid-cols-2 gap-3.5 md:grid-cols-4"
                        >
                          <StatTile label="Abonnés" value={toNum(creator?.followers)} kind="int" />
                          <StatTile label="Engagement" value={toNum(creator?.er)} kind="pct" />
                          <StatTile label="Reach" value={toNum(creator?.reach)} kind="int" />
                          <StatTile label="CA encaissé" value={caEncaisse || null} kind="eur" />
                        </motion.div>
                      ) : (
                        <motion.div
                          key="coord"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.2 }}
                          className="grid grid-cols-1 gap-x-8 gap-y-0 md:grid-cols-2"
                        >
                          <div>
                            {coordRow("Ville", creator?.ville ?? null)}
                            {coordRow("Téléphone", creator?.phone ?? null, true)}
                            {coordRow("Email perso", creator?.email ?? null, true)}
                            {coordRow("Email pro", creator?.email_pro ?? null, true)}
                          </div>
                          <div>
                            {coordRow("Adresse", creator?.address ?? null)}
                            {coordRow("SIREN", creator?.siren ?? null)}
                            {coordRow("Naissance", frDate(creator?.birth))}
                            {coordRow("Instagram", creator?.instagram ?? null, true, "instagram")}
                            {coordRow("TikTok", creator?.tiktok ?? null, true, "tiktok")}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                )}
              </Card>

            </div>
          )}

          {/* Évolution (suivi engagement, mesures de l'agence — lecture seule) */}
          {tab === "evolution" &&
            (suiviErr ? (
              <div className="rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
                <div className="text-sm font-medium text-foreground">Chargement impossible</div>
                <p className="mt-1 text-xs text-muted-foreground">Ton évolution n'a pas pu être récupérée.</p>
                <button
                  type="button"
                  onClick={() => {
                    setSuiviErr(false);
                    setSuivi(null);
                  }}
                  className="mt-3 rounded-lg border border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
                >
                  Réessayer
                </button>
              </div>
            ) : suivi === null ? (
              <AnimatedBadge status="loading" size="sm">
                Chargement de ton évolution…
              </AnimatedBadge>
            ) : (
              <div className="flex flex-col gap-4">
                {followerPoints.length >= 2 && (
                  <Card index={0}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">Évolution des abonnés</div>
                        <div className="mt-0.5 text-[11px] text-faint">D'après les mesures de ton agence</div>
                      </div>
                      <div className="text-2xl font-bold tracking-tight text-foreground">
                        {fmtCompact(followerPoints[followerPoints.length - 1].abonnes)}
                      </div>
                    </div>
                    <FollowerArea points={followerPoints} />
                  </Card>
                )}
                <SuiviPanel entries={suivi} lockedCreator={name} />
              </div>
            ))}

          {/* Debrief (bilans de campagne de l'agence — lecture seule) */}
          {tab === "debrief" &&
            (debriefErr ? (
              <div className="rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
                <div className="text-sm font-medium text-foreground">Chargement impossible</div>
                <p className="mt-1 text-xs text-muted-foreground">Tes debriefs n'ont pas pu être récupérés.</p>
                <button
                  type="button"
                  onClick={() => {
                    setDebriefErr(false);
                    setDebriefs(null);
                  }}
                  className="mt-3 rounded-lg border border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
                >
                  Réessayer
                </button>
              </div>
            ) : debriefs === null ? (
              <AnimatedBadge status="loading" size="sm">
                Chargement de tes debriefs…
              </AnimatedBadge>
            ) : debriefs.length === 0 ? (
              <div className="rounded-2xl border border-border bg-surface px-6 py-12 text-center shadow-sm">
                <BarChart3 className="mx-auto h-8 w-8 text-faint" />
                <div className="mt-2 text-sm font-medium text-foreground">Aucun debrief pour l'instant</div>
                <p className="mt-1 text-xs text-muted-foreground">Les bilans de tes campagnes apparaîtront ici.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {debriefs.map((d, i) => (
                  <article key={i} className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">{d.brand}</div>
                        {d.period && d.period !== "—" && <div className="mt-0.5 text-[11px] text-faint">{d.period}</div>}
                      </div>
                      {d.roi && d.roi !== "—" && (
                        <span className="shrink-0 rounded-full bg-signalsoft px-2.5 py-1 text-[11px] font-semibold text-signaltext">ROI {d.roi}</span>
                      )}
                    </div>
                    <div className="mt-2 text-[13px] text-muted-foreground">
                      {d.budget} <span className="text-faint">→</span> <span className="font-semibold text-signaltext">{d.revenue}</span>
                    </div>
                    {d.summary && d.summary !== "—" && <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">{d.summary}</p>}
                    {d.highlights?.length > 0 && (
                      <ul className="mt-3 space-y-1.5">
                        {d.highlights.map((h, j) => (
                          <li key={j} className="flex items-start gap-2 text-[13px] text-foreground">
                            <span className="mt-0.5 shrink-0 font-bold text-signaltext">✓</span>
                            <span className="flex-1">{h}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {d.kpis?.length > 0 && (
                      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {d.kpis.map((k, j) => (
                          <div key={j} className="rounded-xl bg-panel px-3 py-2.5">
                            <div className="text-[8px] font-semibold uppercase tracking-wide text-faint">{k.l}</div>
                            <div className="mt-1 text-lg font-bold leading-none tracking-tight text-foreground">{k.v}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ))}

          {/* À faire */}
          {tab === "todo" && (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {todoView === "liste" && (
                    <div className="flex gap-1 rounded-xl bg-surface p-1">
                      {TODO_FILTERS.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setTodoFilter(f.id)}
                          className={
                            "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors " +
                            (todoFilter === f.id ? "bg-panel text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
                          }
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Bascule Liste / Colonnes (mémorisée) */}
                  <div className="flex items-center gap-1 rounded-xl bg-surface p-1">
                    {([["liste", List], ["colonnes", Columns3]] as const).map(([m, Icon]) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setTodoView(m)}
                        className={
                          "grid h-8 w-8 place-items-center rounded-lg transition-colors " +
                          (todoView === m ? "bg-panel text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
                        }
                        aria-label={m === "liste" ? "Vue liste" : "Vue colonnes"}
                        title={m === "liste" ? "Liste" : "Colonnes par statut"}
                      >
                        <Icon className="h-4 w-4" />
                      </button>
                    ))}
                  </div>
                </div>
                <AddButton label="Tâche" onClick={() => setTdOpen(true)} />
              </div>
              <InlineForm open={tdOpen} title="Nouvelle tâche" onClose={() => setTdOpen(false)} onSubmit={addTodo}>
                <TextField label="Tâche" value={tdText} onChange={setTdText} />
                <AutoGrowTextField label="Description" value={tdDesc} onChange={setTdDesc} placeholder="Détaille — le champ s'agrandit tout seul…" className="min-w-full" />
                <TextField label="Échéance" type="date" value={tdDue} onChange={setTdDue} />
                <SelectField label="Priorité" value={tdPrio} onChange={setTdPrio} options={PRIORITY_OPTIONS} />
              </InlineForm>
              {todoView === "colonnes" ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {TODO_STATUS_OPTS.map((col) => {
                    const colRows = todos.filter((t) => cStatus(t) === col.value);
                    return (
                      <div key={col.value} className="flex flex-col gap-2.5 rounded-2xl border border-border bg-panel/40 p-2.5">
                        <div className="flex items-center justify-between px-1.5 pt-1">
                          <div className="flex items-center gap-2">
                            <span className={"h-2 w-2 rounded-full " + col.dot} />
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{col.label}</span>
                          </div>
                          <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-faint">{colRows.length}</span>
                        </div>
                        {colRows.length === 0 ? (
                          <div className="px-2 py-6 text-center text-[11px] text-faint">—</div>
                        ) : (
                          colRows.map((t) => (
                            <div key={t.id} className="rounded-xl border border-border bg-surface p-3 shadow-sm">
                              <div className={"line-clamp-2 break-words text-[12.5px] font-medium leading-snug " + (t.done ? "text-muted-foreground line-through" : "text-foreground")}>{t.text}</div>
                              <div className="mt-2 flex items-center justify-between gap-2">
                                <AnimatedBadge status={prioBadge(t.priority)} size="sm">{titleCase(t.priority ?? "moyenne")}</AnimatedBadge>
                                <div className="w-[118px] shrink-0">
                                  <StatusSelect value={cStatus(t)} options={TODO_STATUS_OPTS} onChange={(s) => setTodoStatus(t, s)} />
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
              <div className="flex flex-col gap-3">
                {filteredTodos.length === 0 ? (
                  <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted-foreground shadow-sm">
                    {todoFilter === "terminees" ? "Aucune tâche terminée." : "Aucune tâche."}
                  </div>
                ) : (
                  filteredTodos.map((t) => (
                    <div key={t.id} className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
                      {/* Ligne 1 : case + titre (jusqu'à 2 lignes) + description */}
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => (t.done ? markTodo(t, false) : setConfirmDoneTodo(t))}
                          className={
                            "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors " +
                            (t.done ? "border-primary bg-primary text-primary-foreground" : "border-faint hover:border-primary")
                          }
                          aria-label={t.done ? "Marquer à refaire" : "Marquer fait"}
                        >
                          {t.done && <Check className="h-3.5 w-3.5" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className={"line-clamp-2 break-words text-sm font-medium leading-snug " + (t.done ? "text-muted-foreground line-through" : "text-foreground")}>{t.text}</div>
                          {t.descr && <div className="mt-0.5 line-clamp-2 break-words text-xs leading-relaxed text-faint">{t.descr}</div>}
                        </div>
                      </div>
                      {/* Ligne 2 : priorité à gauche · actions à droite */}
                      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5">
                        <AnimatedBadge status={prioBadge(t.priority)} size="sm">
                          {titleCase(t.priority ?? "moyenne")}
                        </AnimatedBadge>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => (tdEditId === t.id ? setTdEditId(null) : startEditTodo(t))}
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-panel text-muted-foreground shadow-sm transition-colors hover:bg-rowhover hover:text-foreground"
                            aria-label="Modifier la tâche"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <ActionMenu
                            items={[
                              {
                                key: "delete",
                                label: "Supprimer",
                                icon: Trash2,
                                danger: true,
                                onClick: async () => {
                                  if (await dbDelete("todos", t.id)) {
                                    setTodos((prev) => prev.filter((x) => x.id !== t.id));
                                    toast("Supprimé");
                                  }
                                },
                                confirm: { title: "Supprimer la tâche", message: `Supprimer « ${t.text} » ? Cette action est irréversible.` },
                              },
                            ]}
                          />
                        </div>
                      </div>
                      <InlineForm
                        open={tdEditId === t.id}
                        title="Modifier la tâche"
                        onClose={() => setTdEditId(null)}
                        onSubmit={saveEditTodo}
                      >
                        <TextField label="Tâche" value={teText} onChange={setTeText} />
                        <AutoGrowTextField label="Description" value={teDesc} onChange={setTeDesc} className="min-w-full" />
                        <SelectField label="Priorité" value={tePrio} onChange={setTePrio} options={PRIORITY_OPTIONS} />
                      </InlineForm>
                    </div>
                  ))
                )}
              </div>
              )}
            </>
          )}

          {/* Idées */}
          {tab === "ideas" && (
            <>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">{ideas.length} idée{ideas.length > 1 ? "s" : ""}</div>
                <AddButton label="Idée" onClick={() => setIdOpen(true)} />
              </div>
              <InlineForm open={idOpen} title="Nouvelle idée" onClose={() => setIdOpen(false)} onSubmit={addIdea}>
                <AutoGrowTextField label="Idée de contenu" value={idText} onChange={setIdText} placeholder="Décris ton idée — le champ s'agrandit tout seul…" className="min-w-full" />
              </InlineForm>
              <div className="flex flex-col gap-3">
                {ideas.length === 0 ? (
                  <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted-foreground shadow-sm">Aucune idée. Ajoute la première 💡</div>
                ) : (
                  ideas.map((x) =>
                    ideaEditId === x.id ? (
                      <div key={x.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 shadow-sm">
                        <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Modifier l'idée</span>
                        <textarea
                          value={ideaEditText}
                          onChange={(e) => setIdeaEditText(e.target.value)}
                          rows={3}
                          autoFocus
                          placeholder="Ton idée de contenu…"
                          className="w-full resize-y rounded-lg border border-border bg-panel px-3 py-2 text-sm leading-relaxed outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => saveIdeaEdit(x.id)}
                            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
                          >
                            <Check className="h-3.5 w-3.5" /> Enregistrer
                          </button>
                          <button
                            type="button"
                            onClick={() => setIdeaEditId(null)}
                            className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                            title="Annuler"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div key={x.id} className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
                        {/* Ligne 1 : puce + texte de l'idée (pleine largeur) */}
                        <div className="flex items-start gap-3">
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo" />
                          <div className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{x.text}</div>
                        </div>
                        {/* Ligne 2 : statut + actions */}
                        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5">
                          <div className="w-[150px]">
                            <StatusSelect value={x.status ?? "À faire"} options={IDEA_STATUS} onChange={(s) => setIdeaStatus(x, s)} />
                          </div>
                          <ActionMenu
                            items={[
                              {
                                key: "edit",
                                label: "Modifier l'idée",
                                icon: Pencil,
                                onClick: () => {
                                  setIdeaEditId(x.id);
                                  setIdeaEditText(x.text);
                                },
                              },
                              {
                                key: "delete",
                                label: "Supprimer",
                                icon: Trash2,
                                danger: true,
                                onClick: async () => {
                                  if (await dbDelete("ideas", x.id)) {
                                    setIdeas((prev) => prev.filter((y) => y.id !== x.id));
                                    toast("Supprimé");
                                  }
                                },
                                confirm: { title: "Supprimer l'idée", message: `Supprimer « ${x.text} » ? Cette action est irréversible.` },
                              },
                            ]}
                          />
                        </div>
                      </div>
                    ),
                  )
                )}
              </div>
            </>
          )}

          {/* Contacts du créateur — visibles par l'agence (table partagée, RLS cloisonnée) */}
          {tab === "contacts" && (
            <>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                  {contacts.length} contact{contacts.length > 1 ? "s" : ""} · visibles par ton agence
                </div>
                <AddButton label="Contact" onClick={() => setCtOpen(true)} />
              </div>
              <InlineForm open={ctOpen} title="Nouveau contact" onClose={() => setCtOpen(false)} onSubmit={addContact}>
                <TextField label="Marque / société" value={ctBrand} onChange={setCtBrand} placeholder="ex Sephora" />
                <TextField label="Nom du contact" value={ctPerson} onChange={setCtPerson} placeholder="ex Julie Martin" />
                <TextField label="Rôle" value={ctRole} onChange={setCtRole} placeholder="ex Responsable partenariats" />
                <TextField label="Email" value={ctEmail} onChange={setCtEmail} placeholder="ex julie@marque.com" />
                <TextField label="Téléphone" value={ctPhone} onChange={setCtPhone} placeholder="ex 06 12 34 56 78" />
              </InlineForm>
              <div className="flex flex-col gap-3">
                {contacts.length === 0 ? (
                  <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted-foreground shadow-sm">
                    Aucun contact. Ajoute une marque ou une personne que tu connais — ton agence les verra 👋
                  </div>
                ) : (
                  contacts.map((c) =>
                    ctEditId === c.id ? (
                      <InlineForm key={c.id} open title="Modifier le contact" submitLabel="Enregistrer" onClose={() => setCtEditId(null)} onSubmit={saveContactEdit}>
                        <TextField label="Marque / société" value={ceBrand} onChange={setCeBrand} placeholder="ex Sephora" />
                        <TextField label="Nom du contact" value={cePerson} onChange={setCePerson} placeholder="ex Julie Martin" />
                        <TextField label="Rôle" value={ceRole} onChange={setCeRole} placeholder="ex Responsable partenariats" />
                        <TextField label="Email" value={ceEmail} onChange={setCeEmail} placeholder="ex julie@marque.com" />
                        <TextField label="Téléphone" value={cePhone} onChange={setCePhone} placeholder="ex 06 12 34 56 78" />
                      </InlineForm>
                    ) : (
                      <div key={c.id} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-panel text-muted-foreground">
                          <Contact className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-foreground">{c.brand}</div>
                          <div className="truncate text-xs text-faint">
                            {[c.person && c.person !== "—" ? c.person : "", c.role].filter(Boolean).join(" · ") || "—"}
                          </div>
                          {(c.email || c.phone) && (
                            <div className="truncate text-[11px] text-muted-foreground">
                              {[c.email, c.phone].filter(Boolean).join(" · ")}
                            </div>
                          )}
                        </div>
                        <ActionMenu
                          items={[
                            {
                              key: "edit",
                              label: "Modifier",
                              icon: Pencil,
                              onClick: () => startEditContact(c),
                            },
                            {
                              key: "delete",
                              label: "Supprimer",
                              icon: Trash2,
                              danger: true,
                              onClick: async () => {
                                if (await dbDelete("contacts", c.id)) {
                                  setContacts((prev) => prev.filter((y) => y.id !== c.id));
                                  toast("Supprimé");
                                } else {
                                  toast("Erreur — réessaie");
                                }
                              },
                              confirm: { title: "Supprimer le contact", message: `Supprimer « ${c.brand} » ? Cette action est irréversible.` },
                            },
                          ]}
                        />
                      </div>
                    ),
                  )
                )}
              </div>
            </>
          )}

          {/* Briefs */}
          {tab === "briefs" && (
            <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
              {briefs.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">Aucun brief pour le moment.</div>
              ) : (
                briefs.map((b, i) => (
                  <div key={b.id} className={"flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3 " + (i > 0 ? "border-t border-border" : "")}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{b.brand}</div>
                      <div className="truncate text-xs text-faint">{b.deliverables} · échéance {frDate(b.due)}</div>
                    </div>
                    <div className="w-full sm:w-[150px] sm:shrink-0">
                      <StatusSelect value={b.status ?? "attente"} options={BRIEF_STATUS} onChange={(v) => setBriefStatus(b.id, v)} />
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Planning — même calendrier que l'espace agence */}
          {tab === "planning" && (
            <EventCalendar
              events={events.map((e) => ({ id: e.id, date: e.date ?? "", time: e.time ?? "—", title: e.title, type: e.type, who: name })) as CalEv[]}
              creators={[]}
              onCreate={async (e) => {
                if (!e.title.trim()) {
                  toast("Renseigne le titre");
                  return;
                }
                const dateVal = e.date && e.date.trim() ? e.date : new Date().toISOString().slice(0, 10);
                const day = Number(dateVal.split("-")[2]) || 1;
                const created = await dbInsert("events", {
                  day,
                  date: dateVal,
                  time: e.time || "—",
                  title: e.title,
                  type: e.type,
                  who: name,
                  source: "creator", // → notif cloche « Nouvel évènement d'un créateur »
                  sort_order: events.length + 1,
                });
                if (!created) {
                  toast("Erreur — réessaie");
                  return;
                }
                setEvents([{ id: String((created as { id: string }).id), date: dateVal, day, time: e.time || "—", title: e.title, type: e.type }, ...events]);
                notifyAgency("evenement", name, e.title); // push immédiat côté agence
                toast("Événement ajouté ✓");
              }}
              onUpdate={async (id, patch) => {
                const dbPatch: Record<string, unknown> = { ...patch };
                if (patch.date) dbPatch.day = Number(patch.date.split("-")[2]) || 1;
                if (await dbUpdate("events", id, dbPatch)) {
                  setEvents((prev) => prev.map((r) => (r.id === id ? ({ ...r, ...patch } as Ev) : r)));
                  toast("Événement modifié ✓");
                } else {
                  toast("Erreur — réessaie");
                }
              }}
              onDelete={async (id) => {
                if (await dbDelete("events", id)) {
                  setEvents((prev) => prev.filter((r) => r.id !== id));
                  toast("Supprimé");
                } else {
                  toast("Erreur — réessaie");
                }
              }}
            />
          )}

          {/* Documents */}
          {tab === "documents" && (
            <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
              {docs.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">Aucun document.</div>
              ) : (
                docs.map((doc, i) => (
                  <div key={doc.id} className={"flex items-center gap-3 px-4 py-3 " + (i > 0 ? "border-t border-border" : "")}>
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo/15 text-indigo">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{doc.name}</div>
                      <div className="truncate text-xs text-faint">{[doc.type === "mediakit" ? "Media kit" : doc.type, doc.size].filter(Boolean).join(" · ")}</div>
                    </div>
                    {doc.path && (
                      <button
                        type="button"
                        onClick={async () => {
                          // Media kit « par lien » : le path est une URL externe (Drive/Canva…),
                          // pas un objet du bucket → ouvrir directement (createSignedUrl échouerait).
                          if (/^https?:\/\//i.test(doc.path!)) {
                            window.open(doc.path!, "_blank");
                            return;
                          }
                          const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.path!, 3600);
                          if (error || !data?.signedUrl) {
                            toast("Lien indisponible — réessaie");
                            return;
                          }
                          window.open(data.signedUrl, "_blank");
                        }}
                        title="Ouvrir"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Facturation */}
          {tab === "facturation" && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-faint">Encaissé</div>
                  <div className="mt-1.5 whitespace-nowrap text-xl font-bold tracking-tight text-signaltext">{formatEuro(encaisse)}</div>
                </div>
                <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-faint">Total facturé</div>
                  <div className="mt-1.5 whitespace-nowrap text-xl font-bold tracking-tight">{formatEuro(totalFacture)}</div>
                </div>
              </div>
              <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
                {invoices.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground">Aucune facture.</div>
                ) : (
                  invoices.map((inv, i) => {
                    const b = invStatus(inv.status);
                    return (
                      <div key={inv.ref + i} className={"flex items-center gap-3 px-4 py-3 " + (i > 0 ? "border-t border-border" : "")}>
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-panel text-muted-foreground">
                          <Receipt className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">{inv.party}</div>
                          <div className="truncate text-xs text-faint">
                            #{inv.ref}
                            {inv.date ? ` · ${inv.date}` : ""}
                          </div>
                        </div>
                        <span className="whitespace-nowrap text-sm font-bold tracking-tight">{formatEuro(parseAmount(inv.amount))}</span>
                        <AnimatedBadge status={b.status} size="sm">
                          {b.label}
                        </AnimatedBadge>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
          </ErrorBoundary>
        </main>
      </div>

      {/* Nav mobile animée — MÊME composant que l'espace agence (ExpandableTabs).
          On tape une famille → ses pages se déploient en animé. Fixe en bas. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center md:hidden">
        <div className="pointer-events-auto">
          <ExpandableTabs
            items={MOBILE_FAMILIES.map((f) => ({
              id: f.id,
              label: f.label,
              icon: <f.icon className="h-4 w-4" />,
              content: (
                <CreatorMobileMenu
                  ids={f.items}
                  onSelect={(id) => {
                    setTab(id);
                    setMobileTab(null);
                  }}
                />
              ),
            }))}
            value={mobileTab}
            onValueChange={setMobileTab}
          />
        </div>
      </div>

      {/* Confirmation anti-missclick avant de marquer une tâche « faite » */}
      {confirmDoneTodo && (
        <ConfirmDialog
          title="Marquer comme fait ?"
          message={`« ${confirmDoneTodo.text} » sera marquée comme terminée.`}
          confirmLabel="Oui, c'est fait ✓"
          onCancel={() => setConfirmDoneTodo(null)}
          onConfirm={() => {
            const t = confirmDoneTodo;
            setConfirmDoneTodo(null);
            markTodo(t, true);
          }}
        />
      )}
    </div>
  );
}
