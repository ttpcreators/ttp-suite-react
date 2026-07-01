import { supabase } from "@/lib/supabase";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { useEffect, useState } from "react";

type Row = {
  id: string;
  text: string;
  creator: string | null;
  status: string | null;
  source: string | null;
  sort_order: number | null;
};

export function Idees() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    supabase
      .from("ideas")
      .select("id, text, creator, status, source, sort_order")
      .order("sort_order")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setError(true);
          setRows([]);
          return;
        }
        setRows((data ?? []) as Row[]);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      {rows === null && (
        <div className="px-4 py-3">
          <AnimatedBadge status="loading" size="sm">
            Chargement…
          </AnimatedBadge>
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <div className="px-4 py-3 text-sm text-muted-foreground">
          {error
            ? "Impossible de charger les idées."
            : "Aucune idée pour le moment."}
        </div>
      )}

      {rows !== null &&
        rows.length > 0 &&
        rows.map((row, index) => (
          <div
            key={row.id}
            className={cnRow(index)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {row.text}
                </div>
                <div className="text-xs text-muted-foreground">
                  {row.creator || "Toutes"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {row.source === "creator"
                    ? "Proposée par le créateur"
                    : "Ajoutée par l'agence"}
                </div>
              </div>
              {row.status && (
                <AnimatedBadge status="neutral" size="sm">
                  {row.status}
                </AnimatedBadge>
              )}
            </div>
          </div>
        ))}
    </div>
  );
}

function cnRow(index: number): string {
  return index === 0
    ? "px-4 py-3"
    : "px-4 py-3 border-t border-border";
}
