import { useEffect, useState } from "react";
import { ArrowLeft, FileText, CalendarDays, Files, LayoutDashboard } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { titleCase } from "@/lib/utils";
import { useCreators } from "@/lib/useCreators";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { useLiveKey } from "@/lib/useLive";

type Creator = {
  name: string;
  handle: string | null;
  niche: string | null;
  followers: string | null;
  er: string | null;
  ca: string | null;
  photo_url: string | null;
};
type Br = { brand: string; deliverables: string | null; due: string | null; status: string | null };
type Ev = { date: string | null; day: number | null; time: string | null; title: string; type: string };
type Doc = { name: string; type: string | null; size: string | null; created_at: string | null };

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
  const live = useLiveKey();

  useEffect(() => {
    if (!name) return;
    let alive = true;
    supabase.from("creators").select("name,handle,niche,followers,er,ca,photo_url").eq("name", name).limit(1).then(({ data }) => alive && setC((data?.[0] as Creator) ?? null));
    supabase.from("briefs").select("brand,deliverables,due,status").eq("who", name).then(({ data }) => alive && setBriefs((data as Br[]) ?? []));
    supabase.from("events").select("date,day,time,title,type,who").then(({ data }) => alive && setEvents(((data as (Ev & { who: string | null })[]) ?? []).filter((e) => (e.who ?? "").split(", ").includes(name))));
    supabase.from("documents").select("name,type,size,created_at").eq("creator", name).then(({ data }) => alive && setDocs((data as Doc[]) ?? []));
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

  const stat = (label: string, val: string | null) => (
    <div className="rounded-xl border border-border bg-surface p-[18px] shadow-sm">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-faint">{label}</div>
      <div className="mt-2 whitespace-nowrap text-2xl font-bold tracking-tight">{val || "—"}</div>
    </div>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button onClick={onExit} className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint transition-colors hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Espace agence
        </button>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Portail de
          <select
            value={name}
            onChange={(e) => onPick(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground outline-none focus:border-primary"
          >
            {creators.map((cr) => (
              <option key={cr.id} value={cr.name}>
                {titleCase(cr.name)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* creator header */}
      <div className="mb-5 flex items-center gap-4">
        <CreatorAvatar name={name} photoUrl={c?.photo_url ?? null} className="h-14 w-14 rounded-2xl" />
        <div>
          <div className="text-xl font-semibold tracking-tight">{titleCase(name)}</div>
          <div className="text-sm text-faint">{[c?.handle, c?.niche].filter(Boolean).join(" · ") || "—"}</div>
        </div>
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
          {stat("Abonnés", c?.followers ?? null)}
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
                  <div className="truncate text-xs text-faint">
                    {[doc.type, doc.size].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
