import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import { useSearch, matchQuery } from "@/lib/search";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { useEffect, useState } from "react";

type Priority = "haute" | "moyenne" | "basse";
type Source = "agency" | "creator";

type Row = {
  id: string;
  text: string;
  descr: string | null;
  tag: string | null;
  due: string | null;
  creator: string | null;
  priority: Priority;
  source: Source;
  done: boolean;
  sort_order: number;
};

const priorityBadge: Record<
  Priority,
  { status: "danger" | "warning" | "neutral"; label: string }
> = {
  haute: { status: "danger", label: "Haute" },
  moyenne: { status: "warning", label: "Moyenne" },
  basse: { status: "neutral", label: "Basse" },
};

export function Todo() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const { query } = useSearch();

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("todos")
        .select("id, text, descr, tag, due, creator, priority, source, done, sort_order")
        .eq("done", false)
        .order("sort_order");
      if (!active) return;
      if (error) {
        setError(true);
        setRows([]);
        return;
      }
      setRows((data as Row[]) ?? []);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (rows === null) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-sm px-4 py-3">
        <AnimatedBadge status="loading" size="sm">
          Chargement…
        </AnimatedBadge>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-sm px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Impossible de charger les tâches.
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-sm px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Aucune tâche en cours.
        </p>
      </div>
    );
  }

  const filtered = rows.filter((row) =>
    matchQuery(query, row.text, row.descr, row.creator, row.tag)
  );

  if (query.trim() && filtered.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          Aucun résultat pour « {query} »
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {filtered.map((row, index) => {
        const badge = priorityBadge[row.priority];
        return (
          <div
            key={row.id}
            className={cn(
              "flex items-start gap-3 px-4 py-3 hover:bg-muted/60",
              index > 0 && "border-t border-border"
            )}
          >
            <div className="mt-0.5 h-4 w-4 shrink-0 rounded border border-border bg-background" />

            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground truncate">
                {row.text}
              </p>
              {row.descr && (
                <p className="text-xs text-muted-foreground truncate">
                  {row.descr}
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {row.source === "creator" && (
                <span className="rounded-lg bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  Du créateur
                </span>
              )}
              <span className="rounded-lg bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {row.creator ? titleCase(row.creator) : "Agence"}
              </span>
              <AnimatedBadge status={badge.status} size="sm">
                {badge.label}
              </AnimatedBadge>
            </div>
          </div>
        );
      })}
    </div>
  );
}
