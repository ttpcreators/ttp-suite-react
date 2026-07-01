import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  ListChecks,
  Lightbulb,
  FileText,
  CalendarDays,
  Files,
  LogOut,
  Moon,
  Sun,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { titleCase, initials } from "@/lib/utils";
import { dbInsert, dbUpdate, dbDelete, nextOrder } from "@/lib/db";
import { toast } from "@/components/ui/toast";
import { AddButton, InlineForm, TextField, SelectField, DeleteButton } from "@/components/ui/form";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { EncryptedText } from "@/components/ui/encrypted-text";
import { GlassCalendar } from "@/components/ui/glass-calendar";

const BASE = import.meta.env.BASE_URL;

type Creator = {
  name: string;
  handle: string | null;
  niche: string | null;
  followers: string | null;
  er: string | null;
  ca: string | null;
  reach: string | null;
  photo_url: string | null;
  status: string | null;
};
type Todo = { id: string; text: string; descr: string | null; due: string | null; priority: string | null; done: boolean; sort_order?: number };
type Idea = { id: string; text: string; status: string | null; sort_order?: number };
type Brief = { id: string; brand: string; deliverables: string | null; due: string | null; status: string | null };
type Ev = { id: string; date: string | null; day: number | null; time: string | null; title: string; type: string };
type Doc = { id: string; name: string; type: string | null; size: string | null; created_at: string | null };

type Tab = "accueil" | "todo" | "ideas" | "briefs" | "planning" | "documents";
const TABS: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "accueil", label: "Accueil", icon: LayoutDashboard },
  { id: "todo", label: "À faire", icon: ListChecks },
  { id: "ideas", label: "Idées", icon: Lightbulb },
  { id: "briefs", label: "Briefs", icon: FileText },
  { id: "planning", label: "Planning", icon: CalendarDays },
  { id: "documents", label: "Documents", icon: Files },
];

const PRIORITY_OPTIONS = [
  { value: "haute", label: "Haute" },
  { value: "moyenne", label: "Moyenne" },
  { value: "basse", label: "Basse" },
];
const prioBadge = (p: string | null) => (p === "haute" ? "danger" : p === "basse" ? "neutral" : "warning");

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
    supabase.from("creators").select("name,handle,niche,followers,er,ca,reach,photo_url,status").eq("name", name).limit(1).then(({ data }) => alive && setCreator((data?.[0] as Creator) ?? null));
    supabase.from("todos").select("id,text,descr,due,priority,done,sort_order").eq("creator", name).order("sort_order").then(({ data }) => alive && setTodos((data as Todo[]) ?? []));
    supabase.from("ideas").select("id,text,status,sort_order").eq("creator", name).order("sort_order").then(({ data }) => alive && setIdeas((data as Idea[]) ?? []));
    supabase.from("briefs").select("id,brand,deliverables,due,status").eq("who", name).then(({ data }) => alive && setBriefs((data as Brief[]) ?? []));
    supabase.from("events").select("id,date,day,time,title,type").ilike("who", `%${name}%`).then(({ data }) => alive && setEvents((data as Ev[]) ?? []));
    supabase.from("documents").select("id,name,type,size,created_at").eq("creator", name).then(({ data }) => alive && setDocs((data as Doc[]) ?? []));
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

  const openTodos = todos.filter((t) => !t.done);
  const stat = (label: string, val: string | null) => (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-faint">{label}</div>
      <div className="mt-1.5 whitespace-nowrap text-xl font-bold tracking-tight">{val || "—"}</div>
    </div>
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
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">{openTodos.length} tâche{openTodos.length > 1 ? "s" : ""}</div>
                <AddButton label="Tâche" onClick={() => setTdOpen(true)} />
              </div>
              <InlineForm open={tdOpen} title="Nouvelle tâche" onClose={() => setTdOpen(false)} onSubmit={addTodo}>
                <TextField label="Tâche" value={tdText} onChange={setTdText} />
                <TextField label="Description" value={tdDesc} onChange={setTdDesc} />
                <TextField label="Échéance" value={tdDue} onChange={setTdDue} placeholder="JJ/MM" />
                <SelectField label="Priorité" value={tdPrio} onChange={setTdPrio} options={PRIORITY_OPTIONS} />
              </InlineForm>
              <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
                {openTodos.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground">Aucune tâche en cours.</div>
                ) : (
                  openTodos.map((t, i) => (
                    <div key={t.id} className={"flex items-center gap-3 px-4 py-3 " + (i > 0 ? "border-t border-border" : "")}>
                      <button
                        type="button"
                        onClick={async () => {
                          if (await dbUpdate("todos", t.id, { done: true })) {
                            setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: true } : x)));
                            toast("Fait ✓");
                          }
                        }}
                        className="grid h-5 w-5 shrink-0 place-items-center rounded-md border border-faint transition-colors hover:border-signal"
                        aria-label="Marquer fait"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{t.text}</div>
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
        </main>
      </div>
    </div>
  );
}
