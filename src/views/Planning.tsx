import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { EventCalendar, type Ev } from "@/components/ui/event-calendar";
import { dbInsert, dbUpdate, dbDelete } from "@/lib/db";
import { toast } from "@/components/ui/toast";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { useCreators } from "@/lib/useCreators";

export function Planning() {
  const [rows, setRows] = useState<Ev[] | null>(null);
  const [error, setError] = useState(false);
  const creators = useCreators();

  useEffect(() => {
    let alive = true;
    supabase
      .from("events")
      .select("id,day,date,time,title,type,who")
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
          date: (r.date as string) ?? "",
          time: (r.time as string) ?? "—",
          title: (r.title as string) ?? "",
          type: (r.type as string) ?? "call",
          who: (r.who as string | null) ?? null,
        })) as Ev[];
        setRows(list);
      });
    return () => {
      alive = false;
    };
  }, []);

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
    const row = {
      day: Number((e.date || "").split("-")[2]) || 1,
      date: e.date || null,
      time: e.time || "—",
      title: e.title,
      type: e.type,
      who: e.who || null,
      sort_order: rows.length + 1,
    };
    const created = await dbInsert("events", row);
    if (!created) {
      toast("Erreur — réessaie");
      return;
    }
    setRows([{ ...e, id: String((created as { id: string }).id) }, ...rows]);
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
    <EventCalendar
      events={rows}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onDelete={onDelete}
      creators={creators}
    />
  );
}
