import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { EventCalendar, type Ev } from "@/components/ui/event-calendar";
import { linkNewToCollab } from "@/components/collab-links";
import { GoogleConnect } from "@/components/ui/google-connect";
import { dbInsert, dbUpdate, dbDelete } from "@/lib/db";
import { toast } from "@/components/ui/toast";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { useCreators } from "@/lib/useCreators";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";
import { toISODate, todayISO } from "@/lib/dates";
import { notifyCreator } from "@/lib/push";
import { FolderTabs, type FolderTabItem } from "@/components/ui/folder-tabs";
import { useVisitedTabs } from "@/lib/useVisitedTabs";
import { useNavSub, useSetNavSub } from "@/lib/navSub";
import { IgPlanner } from "@/components/IgPlanner";
import { KIND_LABEL, type PlanKind } from "@/lib/igPlanner";

/**
 * PLANNING = 2 onglets : l'AGENDA (rendez-vous, échéances de briefs / to-do /
 * factures, posts Instagram programmés) et les POSTS INSTAGRAM du compte TTP
 * (programmation, publiés tout seuls à l'heure). Un clic sur un post de l'agenda
 * ouvre ce post dans l'onglet Posts Instagram.
 */
export function Planning() {
  const [tab, setTab] = useState<"agenda" | "instagram">("agenda");
  const [focus, setFocus] = useState<string | null>(null);
  const sub = useNavSub();
  const setNavSub = useSetNavSub();
  useEffect(() => {
    if (sub === "agenda" || sub === "instagram") setTab(sub);
  }, [sub]);
  const go = (v: "agenda" | "instagram") => {
    setTab(v);
    setNavSub(v);
  };
  // Onglet ouvert une fois = gardé monté (masqué) : une légende de post en cours n'est pas perdue.
  const visited = useVisitedTabs(tab);
  return (
    // Sous-pages en onglets « dossier » (comme Agents), synchronisées avec la sidebar.
    <FolderTabs label="Sous-pages Planning" orderKey="planning" items={PLANNING_TABS} value={tab} onValueChange={(v) => go(v === "instagram" ? "instagram" : "agenda")}>
      {visited.includes("agenda") && (
        <div hidden={tab !== "agenda"}>
          <Agenda
            onOpenPost={(id) => {
              setFocus(id);
              go("instagram");
            }}
          />
        </div>
      )}
      {visited.includes("instagram") && (
        <div hidden={tab !== "instagram"}>
          <IgPlanner focusId={focus} onFocused={() => setFocus(null)} />
        </div>
      )}
    </FolderTabs>
  );
}

const PLANNING_TABS: FolderTabItem[] = [
  { value: "agenda", label: "Agenda" },
  { value: "instagram", label: "Posts Instagram" },
];

/** Date locale « YYYY-MM-DD » et heure « HH:mm » d'un horodatage. */
function localDay(iso: string): { date: string; time: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
}

function Agenda({ onOpenPost }: { onOpenPost: (id: string) => void }) {
  const [rows, setRows] = useState<Ev[] | null>(() => getCache<Ev[]>("events"));
  // Échéances briefs + to-do datées, superposées en lecture seule.
  const [overlays, setOverlays] = useState<Ev[]>([]);
  const [error, setError] = useState(false);
  const creators = useCreators();
  const live = useLiveKey();

  useEffect(() => {
    let alive = true;
    supabase
      .from("events")
      .select("id,day,date,time,title,type,who,description")
      .or("deleted.is.null,deleted.eq.false")
      .order("sort_order")
      .then(({ data, error }) => {
        if (!alive) return;
        // Rafraîchissement raté : on garde les événements déjà affichés (l'erreur
        // ne s'affiche que si rien n'est encore chargé).
        if (error) {
          setError(true);
          return;
        }
        setError(false);
        const list = ((data as Record<string, unknown>[]) ?? []).map((r) => ({
          id: String(r.id),
          date: ((r.date as string) && (r.date as string).trim()) ? (r.date as string) : todayISO(),
          time: (r.time as string) ?? "—",
          title: (r.title as string) ?? "",
          type: (r.type as string) ?? "call",
          who: (r.who as string | null) ?? null,
          description: (r.description as string | null) ?? null,
        })) as Ev[];
        setCache("events", list);
        setRows(list);
      });
    return () => {
      alive = false;
    };
  }, [live]);

  // Charge les briefs + to-do datés → puces lecture seule (couleur/kind distincts).
  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase.from("briefs").select("id,brand,creator,due"),
      supabase.from("todos").select("id,text,creator,due,done"),
      supabase.from("invoices").select("id,ref,party,date,status"),
      supabase.from("ig_planned").select("id,kind,caption,scheduled_at,status").not("scheduled_at", "is", null),
    ]).then(([b, t, iv, ig]) => {
      if (!alive) return;
      const out: Ev[] = [];
      for (const r of (b.data as Record<string, unknown>[] | null) ?? []) {
        const date = toISODate(r.due);
        if (!date) continue;
        out.push({
          id: `brief:${r.id}`,
          date,
          time: "",
          title: String(r.brand ?? "").trim() || "Brief",
          type: "deadline",
          who: (r.creator as string | null) ?? null,
          kind: "brief",
        });
      }
      for (const r of (t.data as Record<string, unknown>[] | null) ?? []) {
        if (r.done === true) continue; // une to-do terminée n'a plus d'échéance à suivre
        const date = toISODate(r.due);
        if (!date) continue;
        out.push({
          id: `todo:${r.id}`,
          date,
          time: "",
          title: String(r.text ?? "").trim() || "To-do",
          type: "deadline",
          who: (r.creator as string | null) ?? null,
          kind: "todo",
        });
      }
      // Échéances de FACTURES (non payées / non brouillon) → puces « Facture ».
      for (const r of (iv.data as Record<string, unknown>[] | null) ?? []) {
        const status = String(r.status ?? "");
        if (status === "payee" || status === "brouillon") continue;
        const date = toISODate(r.date);
        if (!date) continue;
        out.push({
          id: `facture:${r.id}`,
          date,
          time: "",
          title: `Facture ${String(r.ref ?? "").trim()}${r.party ? ` · ${r.party}` : ""}`.trim(),
          type: "deadline",
          who: null,
          kind: "facture",
        });
      }
      // Posts Instagram programmés (table absente avant le SQL : rien, sans erreur).
      for (const r of (ig.data as { id: string; kind: PlanKind; caption: string; scheduled_at: string; status: string }[] | null) ?? []) {
        const at = localDay(r.scheduled_at);
        if (!at) continue;
        const what = r.caption.trim().split("\n")[0].slice(0, 40) || KIND_LABEL[r.kind] || "Post";
        const tag = r.status === "brouillon" ? "Brouillon · " : r.status === "erreur" ? "À corriger · " : r.status === "publie" ? "Publié · " : "";
        out.push({ id: `post:${r.id}`, date: at.date, time: at.time, title: `${tag}${what}`, type: "deadline", who: null, kind: "post" });
      }
      setOverlays(out);
    });
    return () => {
      alive = false;
    };
  }, [live]);

  // Vrais événements + échéances superposées (briefs/to-do).
  const allEvents = useMemo(() => [...(rows ?? []), ...overlays], [rows, overlays]);

  if (error && !rows)
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted-foreground">
        Impossible de charger le planning.
      </div>
    );
  if (!rows)
    return (
      <AnimatedBadge status="loading" size="sm">
        Chargement du planning…
      </AnimatedBadge>
    );

  // Les callbacks renvoient true en cas de succès : le calendrier ne ferme la modale qu'alors.
  const onCreate = async (e: Omit<Ev, "id">): Promise<boolean> => {
    if (!e.title.trim()) {
      toast("Renseigne le titre");
      return false;
    }
    // date par défaut = aujourd'hui (sinon l'événement n'apparaît nulle part)
    const dateVal = e.date && e.date.trim() ? e.date : todayISO();
    const row = {
      day: Number(dateVal.split("-")[2]) || 1,
      date: dateVal,
      time: e.time || "—",
      title: e.title,
      type: e.type,
      who: e.who || null,
      description: e.description ?? null,
      sort_order: rows.length + 1,
    };
    const created = await dbInsert("events", row);
    if (!created) {
      toast("Erreur, réessaie");
      return false;
    }
    if (e.collabId) void linkNewToCollab("events", String((created as { id: string }).id), e.collabId);
    setRows((prev) => [{ ...e, collabId: undefined, date: dateVal, id: String((created as { id: string }).id) }, ...(prev ?? [])]);
    // Push à chaque créateur concerné (who peut être une liste "Nom A, Nom B").
    (e.who ?? "").split(",").map((c) => c.trim()).filter(Boolean).forEach((c) => notifyCreator("event", c, e.title));
    toast("Événement ajouté ✓");
    return true;
  };

  const onUpdate = async (id: string, patch: Partial<Ev>): Promise<boolean> => {
    const dbPatch: Record<string, unknown> = { ...patch };
    if (patch.date) dbPatch.day = Number(patch.date.split("-")[2]) || 1;
    if (await dbUpdate("events", id, dbPatch)) {
      setRows((prev) => (prev ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
      toast("Événement modifié ✓");
      return true;
    }
    toast("Erreur");
    return false;
  };

  const onDelete = async (id: string): Promise<boolean> => {
    if (await dbDelete("events", id)) {
      setRows((prev) => (prev ?? []).filter((r) => r.id !== id));
      toast("Supprimé définitivement");
      return true;
    }
    toast("Suppression impossible");
    return false;
  };

  return (
    <div className="space-y-4">
      <GoogleConnect />
      <EventCalendar
        events={allEvents}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onNavigate={(kind, ev) =>
          kind === "post"
            ? onOpenPost(ev.id.replace(/^post:/, ""))
            : window.dispatchEvent(
                new CustomEvent("ttp-navigate", { detail: kind === "brief" ? "briefs" : kind === "facture" ? "facturation" : "todo" }),
              )
        }
        creators={creators}
        navAdd
        collabLinks
      />
    </div>
  );
}
