import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useSearch, matchQuery } from "@/lib/search";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { useEffect, useState } from "react";

type Row = {
  id: string;
  brand: string;
  contact: string | null;
  value: string | null;
  stage: string | null;
  tone: "success" | "warning" | "danger" | "neutral" | "info" | null;
  sort_order: number | null;
};

export function Prospection() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const { query } = useSearch();

  useEffect(() => {
    let active = true;
    supabase
      .from("prospects")
      .select("id, brand, contact, value, stage, tone, sort_order")
      .order("sort_order")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setError(true);
          setRows([]);
          return;
        }
        setRows((data as Row[]) ?? []);
      });
    return () => {
      active = false;
    };
  }, []);

  if (rows === null) {
    return (
      <div className="flex items-center gap-2">
        <AnimatedBadge status="loading" size="sm">
          Chargement…
        </AnimatedBadge>
      </div>
    );
  }

  if (error || rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-sm px-4 py-10 text-center">
        <p className="text-sm font-semibold text-foreground">Pipeline vide</p>
        <p className="text-xs text-muted-foreground mt-1">
          {error
            ? "Impossible de charger les prospects."
            : "Aucun prospect pour le moment."}
        </p>
      </div>
    );
  }

  const filtered = rows.filter((row) =>
    matchQuery(query, row.brand, row.contact, row.stage),
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

  const stages = filtered.reduce<string[]>((acc, row) => {
    const stage = row.stage ?? "Sans étape";
    if (!acc.includes(stage)) acc.push(stage);
    return acc;
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {stages.map((stage) => {
        const cards = filtered.filter((row) => (row.stage ?? "Sans étape") === stage);
        return (
          <div
            key={stage}
            className="rounded-xl border border-border bg-card shadow-sm"
          >
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-semibold text-foreground">
                {stage}
              </span>
              <span className="text-xs text-muted-foreground">
                {cards.length}
              </span>
            </div>
            <div>
              {cards.map((card) => (
                <div
                  key={card.id}
                  className={cn(
                    "border-t border-border px-4 py-3 transition-colors hover:bg-muted/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground truncate">
                      {card.brand}
                    </span>
                    {card.tone && (
                      <AnimatedBadge status={card.tone} size="sm">
                        {card.tone}
                      </AnimatedBadge>
                    )}
                  </div>
                  {card.contact && (
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {card.contact}
                    </p>
                  )}
                  {card.value && (
                    <p className="text-sm text-foreground mt-1">{card.value}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
