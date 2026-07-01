import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { useEffect, useState } from "react";
import { FileTextIcon } from "lucide-react";

type Row = {
  id: string;
  name: string;
  type: string;
  size: string;
  creator: string;
  path: string;
  created_at: string;
  sort_order: number;
};

export function Documents() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, name, type, size, creator, path, created_at, sort_order")
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

  const formatDate = (value: string) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      {rows === null ? (
        <div className="px-4 py-3">
          <AnimatedBadge status="loading" size="sm">
            Chargement…
          </AnimatedBadge>
        </div>
      ) : error ? (
        <div className="px-4 py-3">
          <AnimatedBadge status="danger" size="sm">
            Erreur de chargement
          </AnimatedBadge>
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-3 text-sm text-muted-foreground">
          Aucun document
        </div>
      ) : (
        <ul>
          {rows.map((row, index) => (
            <li
              key={row.id}
              className={cn(
                "flex items-center gap-3 px-4 py-3 hover:bg-muted/60",
                index > 0 && "border-t border-border"
              )}
            >
              <FileTextIcon className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">
                  {row.name}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {row.type} · {row.size} · créateur {row.creator}
                </div>
              </div>
              <div className="shrink-0 text-xs text-muted-foreground">
                {formatDate(row.created_at)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
