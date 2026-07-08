import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { EventCalendar, type Ev } from "@/components/ui/event-calendar";
import { GoogleConnect } from "@/components/ui/google-connect";
import { dbInsert, dbUpdate, dbDelete } from "@/lib/db";
import { toast } from "@/components/ui/toast";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { useCreators } from "@/lib/useCreators";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";
import { toISODate, todayISO } from "@/lib/dates";

export function Planning() {
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
        if (error) {
          setError(true);
          setRows([]);
          return;
        }
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
    ]).then(([b, t]) => {
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
      setOverlays(out);
    });
    return () => {
      alive = false;
    };
  }, [live]);

  // Vrais événements + échéances superposées (briefs/to-do).
  const allEvents = useMemo(() => [...(rows ?? []), ...overlays], [rows, overlays]);

  if (error)
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

  const onCreate = async (e: Omit<Ev, "id">) => {
    if (!e.title.trim()) {
      toast("Renseigne le titre");
      return;
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
      toast("Erreur — réessaie");
      return;
    }
    setRows([{ ...e, date: dateVal, id: String((created as { id: string }).id) }, ...rows]);
    toast("Événement ajouté ✓");
  };

  const onUpdate = async (id: string, patch: Partial<Ev>) => {
    const dbPatch: Record<string, unknown> = { ...patch };
    if (patch.date) dbPatch.day = Number(patch.date.split("-")[2]) || 1;
    if (await dbUpdate("events", id, dbPatch)) {
      setRows((prev) => (prev ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
      toast("Événement modifié ✓");
    } else {
      toast("Erreur");
    }
  };

  const onDelete = async (id: string) => {
    if (await dbDelete("events", id)) {
      setRows((prev) => (prev ?? []).filter((r) => r.id !== id));
      toast("Supprimé");
    }
  };

  return (
    <div className="space-y-4">
      <GoogleConnect />
      <EventCalendar
        events={allEvents}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onNavigate={(kind) =>
          window.dispatchEvent(
            new CustomEvent("ttp-navigate", { detail: kind === "brief" ? "briefs" : "todo" }),
          )
        }
        creators={creators}
      />
    </div>
  );
}
