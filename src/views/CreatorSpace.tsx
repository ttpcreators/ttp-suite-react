import { useEffect, useState } from "react";
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
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { titleCase, initials } from "@/lib/utils";
import { dbInsert, dbUpdate, dbDelete, nextOrder } from "@/lib/db";
import { toast } from "@/components/ui/toast";
import { AddButton, InlineForm, TextField, SelectField, DeleteButton } from "@/components/ui/form";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { EncryptedText } from "@/components/ui/encrypted-text";
import { GlassCalendar } from "@/components/ui/glass-calendar";
import { parseAmount, formatEuro } from "@/lib/appState";

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
};
type Todo = { id: string; text: string; descr: string | null; due: string | null; priority: string | null; done: boolean; sort_order?: number };
type Idea = { id: string; text: string; status: string | null; sort_order?: number };
type Brief = { id: string; brand: string; deliverables: string | null; due: string | null; status: string | null };
type Ev = { id: string; date: string | null; day: number | null; time: string | null; title: string; type: string };
type Doc = { id: string; name: string; type: string | null; size: string | null; created_at: string | null };
type Invoice = { ref: string; party: string; amount: string | null; date: string | null; status: string | null };

type Tab = "accueil" | "todo" | "ideas" | "briefs" | "planning" | "documents" | "facturation";
const TABS: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "accueil", label: "Accueil", icon: LayoutDashboard },
  { id: "todo", label: "À faire", icon: ListChecks },
  { id: "ideas", label: "Idées", icon: Lightbulb },
  { id: "briefs", label: "Briefs", icon: FileText },
  { id: "planning", label: "Planning", icon: CalendarDays },
  { id: "documents", label: "Documents", icon: Files },
  { id: "facturation", label: "Facturation", icon: Receipt },
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
  const [creator, setCreator] = useState<Creator | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  // todo filter
  const [todoFilter, setTodoFilter] = useState<TodoFilter>("encours");

  // "Mes infos" edit state
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Creator>>({});

  // add-forms
  const [tdOpen, setTdOpen] = useState(false);
  const [tdText, setTdText] = useState("");
  const [tdDesc, setTdDesc] = useState("");
  const [tdDue, setTdDue] = useState("");
  const [tdPrio, setTdPrio] = useState("moyenne");
  const [idOpen, setIdOpen] = useState(false);
  const [idText, setIdText] = useState("");

  useEffect(() => {
    let alive = true;
    supabase
      .from("creators")
      .select("id,name,handle,niche,followers,er,ca,reach,photo_url,status,ville,phone,email,address,siren,birth,commission")
      .eq("name", name)
      .limit(1)
      .then(({ data }) => alive && setCreator((data?.[0] as Creator) ?? null));
    supabase.from("todos").select("id,text,descr,due,priority,done,sort_order").eq("creator", name).order("sort_order").then(({ data }) => alive && setTodos((data as Todo[]) ?? []));
    supabase.from("ideas").select("id,text,status,sort_order").eq("creator", name).order("sort_order").then(({ data }) => alive && setIdeas((data as Idea[]) ?? []));
    supabase.from("briefs").select("id,brand,deliverables,due,status").eq("who", name).then(({ data }) => alive && setBriefs((data as Brief[]) ?? []));
    supabase.from("events").select("id,date,day,time,title,type").ilike("who", `%${name}%`).then(({ data }) => alive && setEvents((data as Ev[]) ?? []));
    supabase.from("documents").select("id,name,type,size,created_at").eq("creator", name).then(({ data }) => alive && setDocs((data as Doc[]) ?? []));
    supabase.from("invoices").select("ref,party,amount,date,status").eq("creator", name).then(({ data }) => alive && setInvoices((data as Invoice[]) ?? []));
    return () => {
      alive = false;
    };
  }, [name]);

  const firstName = titleCase(name).split(" ")[0];

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
    toast("Idée ajoutée ✓");
    setIdOpen(false);
    setIdText("");
  };

  const startEdit = () => {
    if (!creator) return;
    setForm({
      ville: creator.ville ?? "",
      phone: creator.phone ?? "",
      email: creator.email ?? "",
      address: creator.address ?? "",
      siren: creator.siren ?? "",
      birth: creator.birth ?? "",
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

  const openTodos = todos.filter((t) => !t.done);
  const filteredTodos =
    todoFilter === "encours" ? todos.filter((t) => !t.done) : todoFilter === "terminees" ? todos.filter((t) => t.done) : todos;

  const encaisse = invoices.filter((i) => i.status === "payee").reduce((a, i) => a + parseAmount(i.amount), 0);
  const totalFacture = invoices.reduce((a, i) => a + parseAmount(i.amount), 0);

  const toggleTodo = async (t: Todo) => {
    const next = !t.done;
    if (await dbUpdate("todos", t.id, { done: next })) {
      setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: next } : x)));
      toast(next ? "Fait ✓" : "À refaire");
    }
  };

  const stat = (label: string, val: string | null) => (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-faint">{label}</div>
      <div className="mt-1.5 whitespace-nowrap text-xl font-bold tracking-tight">{val || "—"}</div>
    </div>
  );

  const infoRow = (label: string, val: string | null) => (
    <div className="flex items-start justify-between gap-3 border-b border-border py-2 last:border-0">
      <span className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</span>
      <span className="max-w-[60%] truncate text-right text-xs text-foreground">{val || "—"}</span>
    </div>
  );

  const editInput = (label: string, k: keyof Creator, placeholder?: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</span>
      <input
        value={(form[k] as string) ?? ""}
        onChange={(e) => setField(k, e.target.value)}
        placeholder={placeholder}
        className="rounded-lg border border-border bg-panel px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-signal"
      />
    </label>
  );

  return (
    <div className="min-h-screen bg-background p-2 md:p-[14px]">
      <div className="mx-auto flex max-w-4xl flex-col overflow-hidden rounded-[22px] bg-panel">
        {/* Header */}
        <header className="flex items-center justify-between gap-3 px-4 py-3.5 md:px-6">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 overflow-hidden rounded-lg bg-[#14181E]">
              <img src={`${BASE}cover.png`} alt="TTP" className="h-full w-full object-cover" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">Espace créateur</div>
              <div className="text-[11px] text-faint">TTP Creators</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleTheme}
              className="grid h-9 w-9 place-items-center rounded-lg bg-surface text-foreground shadow-sm transition-colors hover:bg-rowhover"
              aria-label="Thème"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="flex h-9 items-center gap-2 rounded-lg bg-surface px-3 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-rowhover"
            >
              <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Déconnexion</span>
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 pb-8 pt-1.5 md:px-6">
          {/* Greeting */}
          <div className="mb-5 flex items-center gap-4">
            {creator?.photo_url ? (
              <img src={creator.photo_url} alt={firstName} className="h-14 w-14 rounded-2xl object-cover" />
            ) : (
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-muted text-base font-semibold text-muted-foreground">
                {initials(name)}
              </div>
            )}
            <div>
              <div className="text-sm text-faint">Bonjour</div>
              <div className="text-[26px] font-semibold tracking-tight md:text-[30px]">
                <EncryptedText text={firstName} /> 👋
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-surface p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={
                  "flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors " +
                  (tab === t.id ? "bg-panel text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
                }
              >
                <t.icon className="h-4 w-4" /> <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </div>

          {/* Accueil */}
          {tab === "accueil" && (
            <div className="flex flex-col gap-4">
              {/* Mes infos (éditable) */}
              <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
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
                      {editInput("Email", "email")}
                      {editInput("Adresse", "address")}
                      {editInput("SIREN", "siren")}
                      {editInput("Naissance", "birth", "JJ/MM/AAAA")}
                    </div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">Statistiques</div>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      {editInput("Abonnés", "followers")}
                      {editInput("Engagement", "er")}
                      {editInput("Reach", "reach")}
                      {editInput("CA · mois", "ca")}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-x-8 gap-y-0 md:grid-cols-2">
                    <div>
                      {infoRow("Ville", creator?.ville ?? null)}
                      {infoRow("Téléphone", creator?.phone ?? null)}
                      {infoRow("Email", creator?.email ?? null)}
                    </div>
                    <div>
                      {infoRow("Adresse", creator?.address ?? null)}
                      {infoRow("SIREN", creator?.siren ?? null)}
                      {infoRow("Naissance", creator?.birth ?? null)}
                    </div>
                  </div>
                )}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {stat("Abonnés", creator?.followers ?? null)}
                {stat("Engagement", creator?.er ?? null)}
                {stat("Reach", creator?.reach ?? null)}
                {stat("CA · mois", creator?.ca ?? null)}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
                  <div className="mb-3 text-sm font-semibold">Mes tâches</div>
                  {openTodos.length === 0 ? (
                    <div className="text-xs text-muted-foreground">Rien à faire 🎉</div>
                  ) : (
                    openTodos.slice(0, 5).map((t) => (
                      <div key={t.id} className="flex items-center gap-2.5 py-1.5">
                        <span className="h-4 w-4 shrink-0 rounded-[5px] border border-faint" />
                        <span className="truncate text-xs">{t.text}</span>
                      </div>
                    ))
                  )}
                </div>
                <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
                  <div className="mb-3 text-sm font-semibold">Mes briefs</div>
                  {briefs.length === 0 ? (
                    <div className="text-xs text-muted-foreground">Aucun brief.</div>
                  ) : (
                    briefs.slice(0, 5).map((b) => (
                      <div key={b.id} className="flex items-center gap-2.5 border-b border-border py-2 last:border-0">
                        <span className="h-2 w-2 shrink-0 rounded-full bg-signal" />
                        <div className="min-w-0 flex-1 truncate text-xs font-medium">{b.brand}</div>
                        <span className="text-[10px] text-faint">{b.due}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* À faire */}
          {tab === "todo" && (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
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
                <AddButton label="Tâche" onClick={() => setTdOpen(true)} />
              </div>
              <InlineForm open={tdOpen} title="Nouvelle tâche" onClose={() => setTdOpen(false)} onSubmit={addTodo}>
                <TextField label="Tâche" value={tdText} onChange={setTdText} />
                <TextField label="Description" value={tdDesc} onChange={setTdDesc} />
                <TextField label="Échéance" value={tdDue} onChange={setTdDue} placeholder="JJ/MM" />
                <SelectField label="Priorité" value={tdPrio} onChange={setTdPrio} options={PRIORITY_OPTIONS} />
              </InlineForm>
              <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
                {filteredTodos.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground">
                    {todoFilter === "terminees" ? "Aucune tâche terminée." : "Aucune tâche."}
                  </div>
                ) : (
                  filteredTodos.map((t, i) => (
                    <div key={t.id} className={"flex items-center gap-3 px-4 py-3 " + (i > 0 ? "border-t border-border" : "")}>
                      <button
                        type="button"
                        onClick={() => toggleTodo(t)}
                        className={
                          "grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors " +
                          (t.done ? "border-signal bg-signal text-onsignal" : "border-faint hover:border-signal")
                        }
                        aria-label={t.done ? "Marquer à refaire" : "Marquer fait"}
                      >
                        {t.done && <Check className="h-3.5 w-3.5" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className={"truncate text-sm font-medium " + (t.done ? "text-muted-foreground line-through" : "")}>{t.text}</div>
                        {t.descr && <div className="truncate text-xs text-faint">{t.descr}</div>}
                      </div>
                      <AnimatedBadge status={prioBadge(t.priority)} size="sm">
                        {titleCase(t.priority ?? "moyenne")}
                      </AnimatedBadge>
                      <DeleteButton
                        onClick={async () => {
                          if (await dbDelete("todos", t.id)) {
                            setTodos((prev) => prev.filter((x) => x.id !== t.id));
                            toast("Supprimé");
                          }
                        }}
                      />
                    </div>
                  ))
                )}
              </div>
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
                <TextField label="Idée de contenu" value={idText} onChange={setIdText} />
              </InlineForm>
              <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
                {ideas.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground">Aucune idée. Ajoute la première 💡</div>
                ) : (
                  ideas.map((x, i) => (
                    <div key={x.id} className={"flex items-center gap-3 px-4 py-3 " + (i > 0 ? "border-t border-border" : "")}>
                      <span className="h-2 w-2 shrink-0 rounded-full bg-indigo" />
                      <div className="min-w-0 flex-1 truncate text-sm">{x.text}</div>
                      <AnimatedBadge status="neutral" size="sm">{x.status ?? "À faire"}</AnimatedBadge>
                      <DeleteButton
                        onClick={async () => {
                          if (await dbDelete("ideas", x.id)) {
                            setIdeas((prev) => prev.filter((y) => y.id !== x.id));
                            toast("Supprimé");
                          }
                        }}
                      />
                    </div>
                  ))
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
                  <div key={b.id} className={"flex items-center gap-3 px-4 py-3 " + (i > 0 ? "border-t border-border" : "")}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{b.brand}</div>
                      <div className="truncate text-xs text-faint">{b.deliverables} · échéance {b.due}</div>
                    </div>
                    <AnimatedBadge status={b.status === "cours" ? "info" : b.status === "valider" ? "warning" : "neutral"} size="sm">
                      {b.status === "cours" ? "En cours" : b.status === "valider" ? "À valider" : "En attente"}
                    </AnimatedBadge>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Planning */}
          {tab === "planning" && (
            <div className="flex flex-col gap-4">
              <GlassCalendar eventDates={new Set(events.map((e) => e.date ?? ""))} />
              <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
                {events.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground">Aucun événement.</div>
                ) : (
                  events.map((e, i) => (
                    <div key={e.id} className={"flex items-center gap-3 px-4 py-3 " + (i > 0 ? "border-t border-border" : "")}>
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-panel text-xs font-semibold">
                        {(e.date ?? "").slice(8, 10) || e.day || "•"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{e.title}</div>
                        <div className="text-xs text-faint">{e.time && e.time !== "—" ? e.time : "Toute la journée"}</div>
                      </div>
                      <span className="rounded-md bg-rowhover px-2 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">{e.type}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
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
                      <div className="truncate text-xs text-faint">{[doc.type, doc.size].filter(Boolean).join(" · ")}</div>
                    </div>
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
        </main>
      </div>
    </div>
  );
}
