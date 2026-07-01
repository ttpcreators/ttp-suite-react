import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { useEffect, useState } from "react";

type Row = {
  id: string | number;
  day: number;
  date: string;
  time: string;
  title: string;
  type: string;
  who: string;
  sort_order: number;
};

const WEEKDAYS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

function weekdayAbbr(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return WEEKDAYS[d.getUTCDay()] ?? "";
}

export function Planning() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    const today = new Date().toISOString().slice(0, 10);

    supabase
      .from("events")
      .select("id, day, date, time, title, type, who, sort_order")
      .order("sort_order")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setError(true);
          setRows([]);
          return;
        }
        const list = ((data as Row[] | null) ?? [])
          .filter((r) => r.date >= today)
          .sort((a, b) => a.date.localeCompare(b.date));
        setRows(list);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      {rows === null ? (
        <div className="px-4 py-3">
          <AnimatedBadge status="loading" size="sm">
            Chargement…
          </AnimatedBadge>
        </div>
      ) : error ? (
        <div className="px-4 py-3 text-sm text-muted-foreground">
          Impossible de charger le planning.
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-3 text-sm text-muted-foreground">
          Aucun événement à venir
        </div>
      ) : (
        <ul>
          {rows.map((row, index) => (
            <li
              key={row.id}
              className={cn(
                "flex items-center gap-4 px-4 py-3 hover:bg-muted/60",
                index > 0 && "border-t border-border",
              )}
            >
              <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-muted">
                <span className="text-sm font-semibold text-foreground">
                  {row.day}
                </span>
                <span className="text-xs text-muted-foreground">
                  {weekdayAbbr(row.date)}
                </span>
              </div>

              <div className="w-12 shrink-0 text-xs text-muted-foreground">
                {row.time}
              </div>

              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">
                  {row.title}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {row.who}
                </div>
              </div>

              <AnimatedBadge status="info" size="sm">
                {row.type}
              </AnimatedBadge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
