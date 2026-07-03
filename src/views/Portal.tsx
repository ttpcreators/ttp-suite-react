import { useEffect, useState } from "react";
import { ArrowLeft, FileText, CalendarDays, Files, LayoutDashboard, ListChecks, Lightbulb } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { titleCase } from "@/lib/utils";
import { useCreators } from "@/lib/useCreators";
import { useAppState, type AppState } from "@/lib/appState";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { Select, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select";
import { useLiveKey } from "@/lib/useLive";

type Creator = {
  name: string;
  handle: string | null;
  niche: string | null;
  platform: string | null;
  followers: string | null;
  er: string | null;
  ca: string | null;
  photo_url: string | null;
  instagram: string | null;
  tiktok: string | null;
};
type Br = { brand: string; deliverables: string | null; due: string | null; status: string | null };
type Ev = { date: string | null; day: number | null; time: string | null; title: string; type: string };
type Doc = { name: string; type: string | null; size: string | null; created_at: string | null };
type Idea = { text: string; status: string | null };
type Todo = { text: string; done: boolean; priority: string | null };
type HistEntry = { date: string; creator: string; platform: string; platformLabel: string; followers: string };

// ── Icônes réseaux (inline — lucide n'a plus les logos de marque) ──
function IgIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}
function TtIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 1 1-2.59-2.59c.27 0 .53.04.77.12v-3.2a5.67 5.67 0 0 0-.77-.05A5.68 5.68 0 1 0 15.54 15.4V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3a4.28 4.28 0 0 1-3.24-1.48z" />
    </svg>
  );
}
function YtIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" />
      <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" fill="currentColor" stroke="none" />
    </svg>
  );
}

function socialUrl(base: string, raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  return base + v.replace(/^@/, "").replace(/\s+/g, "");
}
/** "03/07/2026" → timestamp (pour trier l'historique par date). */
function parseFrDate(s: string): number {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec((s ?? "").trim());
  if (!m) return 0;
  let y = m[3];
  if (y.length === 2) y = "20" + y;
  return new Date(Number(y), Number(m[2]) - 1, Number(m[1])).getTime();
}
function parseFollowers(s: string | null): number {
  const t = (s ?? "").trim().replace(/\s/g, "").replace(",", ".").toUpperCase();
  const m = /^([0-9.]+)([KM]?)/.exec(t);
  if (!m) return 0;
  let n = parseFloat(m[1]) || 0;
  if (m[2] === "K") n *= 1e3;
  else if (m[2] === "M") n *= 1e6;
  return n;
}
function fmtCompact(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(Math.round(n));
}

type Tab = "accueil" | "briefs" | "planning" | "documents";
const TABS: { id: Tab; label: string; icon: typeof FileText }[] = [
  { id: "accueil", label: "Accueil", icon: LayoutDashboard },
  { id: "briefs", label: "Briefs", icon: FileText },
  { id: "planning", label: "Planning", icon: CalendarDays },
  { id: "documents", label: "Documents", icon: Files },
];

export function Portal({
  creator,
  onPick,
  onExit,
}: {
  creator: string | null;
  onPick: (n: string) => void;
  onExit: () => void;
}) {
  const creators = useCreators();
  const name = creator ?? creators[0]?.name ?? null;
  const [tab, setTab] = useState<Tab>("accueil");
  const [c, setC] = useState<Creator | null>(null);
  const [briefs, setBriefs] = useState<Br[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const live = useLiveKey();
  const { data: histData } = useAppState<HistEntry[]>((s: AppState) => (s["engagementHistory"] as HistEntry[]) ?? []);

  useEffect(() => {
    if (!name) return;
    let alive = true;
    supabase.from("creators").select("*").eq("name", name).limit(1).then(({ data, error }) => { if (error) console.error("Portail — chargement créateur:", error); if (alive) setC((data?.[0] as Creator) ?? null); });
    supabase.from("briefs").select("brand,deliverables,due,status").eq("who", name).then(({ data }) => alive && setBriefs((data as Br[]) ?? []));
    supabase.from("events").select("date,day,time,title,type,who").or("deleted.is.null,deleted.eq.false").then(({ data }) => alive && setEvents(((data as (Ev & { who: string | null })[]) ?? []).filter((e) => (e.who ?? "").split(", ").includes(name))));
    supabase.from("documents").select("name,type,size,created_at").eq("creator", name).then(({ data }) => alive && setDocs((data as Doc[]) ?? []));
    supabase.from("ideas").select("text,status").eq("creator", name).then(({ data }) => alive && setIdeas((data as Idea[]) ?? []));
    supabase.from("todos").select("text,done,priority").eq("creator", name).then(({ data }) => alive && setTodos((data as Todo[]) ?? []));
    return () => {
      alive = false;
    };
  }, [name, live]);

  if (!name)
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted-foreground">
        Aucun créateur dans le roster. Ajoute un créateur pour voir son portail.
      </div>
    );

  // ── Cumul d'abonnés multi-plateformes (dernière mesure par plateforme dans l'historique Engagement) ──
  const myHist = (histData ?? []).filter((h) => (h.creator ?? "").toLowerCase() === titleCase(name).toLowerCase());
  const byPlatform = new Map<string, HistEntry[]>();
  for (const h of myHist) {
    const arr = byPlatform.get(h.platform) ?? [];
    arr.push(h);
    byPlatform.set(h.platform, arr);
  }
  let cumulNow = 0;
  let cumulPrev = 0;
  const platformRows: { label: string; followers: number }[] = [];
  for (const [, arr] of byPlatform) {
    arr.sort((a, b) => parseFrDate(b.date) - parseFrDate(a.date));
    const now = parseFollowers(arr[0].followers);
    const prev = arr[1] ? parseFollowers(arr[1].followers) : now;
    cumulNow += now;
    cumulPrev += prev;
    if (now > 0) platformRows.push({ label: arr[0].platformLabel, followers: now });
  }
  platformRows.sort((a, b) => b.followers - a.followers);
  const hasCumul = cumulNow > 0;
  const followersDisplay = hasCumul ? fmtCompact(cumulNow) : c?.followers ?? null;
  const growth = cumulNow - cumulPrev;

  // Liens réseaux (handle ou champ dédié)
  const plat = (c?.platform ?? "").toLowerCase();
  const igUrl = socialUrl("https://instagram.com/", c?.instagram || (plat.includes("insta") ? c?.handle : null));
  const ttUrl = socialUrl("https://www.tiktok.com/@", c?.tiktok || (plat.includes("tiktok") ? c?.handle : null));
  const ytUrl = plat.includes("youtube") && c?.handle ? socialUrl("https://youtube.com/@", c.handle) : null;

  const stat = (label: string, val: string | null) => (
    <div className="rounded-xl border border-border bg-surface p-[18px] shadow-sm">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-faint">{label}</div>
      <div className="mt-2 truncate text-2xl font-bold tracking-tight">{val || "—"}</div>
    </div>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button onClick={onExit} className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint transition-colors hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Espace agence
        </button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          Portail de
          <Select value={name} onValueChange={onPick}>
            <SelectTrigger className="h-9 w-auto min-w-[170px] rounded-lg bg-surface" placeholder="Créateur" />
            <SelectContent>
              {creators.map((cr, i) => (
                <SelectItem key={cr.id} index={i} value={cr.name}>
                  {titleCase(cr.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* creator header */}
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <CreatorAvatar name={name} photoUrl={c?.photo_url ?? null} className="h-14 w-14 rounded-2xl" />
        <div className="min-w-0">
          <div className="text-xl font-semibold tracking-tight">{titleCase(name)}</div>
          <div className="text-sm text-faint">{[c?.handle, c?.niche].filter(Boolean).join(" · ") || "—"}</div>
        </div>
        {(igUrl || ttUrl || ytUrl) && (
          <div className="flex items-center gap-2">
            {igUrl && (
              <a href={igUrl} target="_blank" rel="noreferrer" title="Instagram" className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface text-muted-foreground transition-colors hover:border-primary hover:text-primary">
                <IgIcon className="h-4 w-4" />
              </a>
            )}
            {ttUrl && (
              <a href={ttUrl} target="_blank" rel="noreferrer" title="TikTok" className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface text-muted-foreground transition-colors hover:border-primary hover:text-primary">
                <TtIcon className="h-4 w-4" />
              </a>
            )}
            {ytUrl && (
              <a href={ytUrl} target="_blank" rel="noreferrer" title="YouTube" className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface text-muted-foreground transition-colors hover:border-primary hover:text-primary">
                <YtIcon className="h-4 w-4" />
              </a>
            )}
          </div>
        )}
      </div>

      {/* tabs */}
      <div className="mb-5 flex gap-1 rounded-xl bg-panel p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              "flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-semibold transition-colors " +
              (tab === t.id ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
            }
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "accueil" && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {/* Abonnés (cumul multi-plateformes) */}
          <div className="rounded-xl border border-border bg-surface p-[18px] shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-faint">Abonnés {hasCumul && platformRows.length > 1 ? "· cumul" : ""}</div>
              {hasCumul && growth !== 0 && (
                <span className={"rounded-md px-1.5 py-0.5 text-[10px] font-semibold " + (growth >= 0 ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/12 text-rose-500")}>
                  {growth >= 0 ? "+" : "−"}
                  {fmtCompact(Math.abs(growth))}
                </span>
              )}
            </div>
            <div className="mt-2 truncate text-2xl font-bold tracking-tight">{followersDisplay || "—"}</div>
            {hasCumul && (
              <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] text-faint">
                {platformRows.map((p) => (
                  <span key={p.label}>
                    {p.label} <span className="font-semibold text-muted-foreground">{fmtCompact(p.followers)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          {stat("Engagement", c?.er ?? null)}
          {stat("CA · mois", c?.ca ?? null)}

          <div className="col-span-2 rounded-2xl border border-border bg-surface p-5 shadow-sm md:col-span-3">
            <div className="mb-3 text-sm font-semibold">Prochains briefs</div>
            {briefs.length === 0 ? (
              <div className="text-xs text-muted-foreground">Aucun brief pour le moment.</div>
            ) : (
              briefs.slice(0, 4).map((b, i) => (
                <div key={i} className="flex items-center gap-2.5 border-b border-border py-2 last:border-0">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-signal" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{b.brand}</div>
                    <div className="truncate text-[10px] text-faint">{b.deliverables} · {b.due}</div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* À faire */}
          <div className="col-span-2 rounded-2xl border border-border bg-surface p-5 shadow-sm md:col-span-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <ListChecks className="h-4 w-4 text-faint" /> À faire{todos.length ? ` · ${todos.filter((t) => !t.done).length} en cours` : ""}
            </div>
            {todos.length === 0 ? (
              <div className="text-xs text-muted-foreground">Aucune tâche pour ce créateur.</div>
            ) : (
              todos.slice(0, 6).map((t, i) => (
                <div key={i} className="flex items-center gap-2.5 border-b border-border py-2 last:border-0">
                  <span className={"h-4 w-4 shrink-0 rounded-[5px] border " + (t.done ? "border-primary bg-primary" : "border-faint")} />
                  <span className={"flex-1 truncate text-xs " + (t.done ? "text-faint line-through" : "")}>{t.text}</span>
                  {t.priority && <span className="rounded-md bg-rowhover px-2 py-0.5 text-[9px] font-semibold text-muted-foreground">{t.priority}</span>}
                </div>
              ))
            )}
          </div>

          {/* Idées */}
          <div className="col-span-2 rounded-2xl border border-border bg-surface p-5 shadow-sm md:col-span-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Lightbulb className="h-4 w-4 text-faint" /> Idées de contenu
            </div>
            {ideas.length === 0 ? (
              <div className="text-xs text-muted-foreground">Aucune idée pour ce créateur.</div>
            ) : (
              ideas.slice(0, 6).map((x, i) => (
                <div key={i} className="flex items-center gap-2.5 border-b border-border py-2 last:border-0">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-indigo" />
                  <span className="flex-1 truncate text-xs">{x.text}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === "briefs" && (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          {briefs.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">Aucun brief.</div>
          ) : (
            briefs.map((b, i) => (
              <div key={i} className={"flex items-center gap-3 px-4 py-3 " + (i > 0 ? "border-t border-border" : "")}>
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

      {tab === "planning" && (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          {events.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">Aucun événement.</div>
          ) : (
            events.map((e, i) => (
              <div key={i} className={"flex items-center gap-3 px-4 py-3 " + (i > 0 ? "border-t border-border" : "")}>
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
      )}

      {tab === "documents" && (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          {docs.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">Aucun document.</div>
          ) : (
            docs.map((doc, i) => (
              <div key={i} className={"flex items-center gap-3 px-4 py-3 " + (i > 0 ? "border-t border-border" : "")}>
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
    </div>
  );
}
