import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useSearch, matchQuery } from "@/lib/search";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { useEffect, useState } from "react";
import {
  PencilLine,
  LayoutGrid,
  ReceiptText,
  FileText,
  type LucideIcon,
} from "lucide-react";

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

type TypeMeta = {
  label: string;
  icon: LucideIcon;
  className: string;
  tagClassName: string;
};

const DOC_TYPE_META: Record<string, TypeMeta> = {
  brief: {
    label: "Brief",
    icon: PencilLine,
    className: "bg-indigo/15 text-indigo",
    tagClassName: "bg-indigo/10 text-indigo",
  },
  mediakit: {
    label: "Media kit",
    icon: LayoutGrid,
    className: "bg-signal/15 text-signaltext",
    tagClassName: "bg-signal/10 text-signaltext",
  },
  facture: {
    label: "Facture",
    icon: ReceiptText,
    className: "bg-cyan/15 text-cyan",
    tagClassName: "bg-cyan/10 text-cyan",
  },
  autre: {
    label: "Document",
    icon: FileText,
    className: "bg-indigo/15 text-indigo",
    tagClassName: "bg-indigo/10 text-indigo",
  },
};

const metaFor = (type: string): TypeMeta =>
  DOC_TYPE_META[type] ?? DOC_TYPE_META.autre;

export function Documents() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const { query } = useSearch();

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

  const filtered = (rows ?? []).filter((row) =>
    matchQuery(query, row.name, row.type, row.creator)
  );

  return (
    <div className="rounded-2xl border border-border bg-card px-2 shadow-sm sm:px-5">
      {rows === null ? (
        <div className="px-2 py-3">
          <AnimatedBadge status="loading" size="sm">
            Chargement…
          </AnimatedBadge>
        </div>
      ) : error ? (
        <div className="px-2 py-3">
          <AnimatedBadge status="danger" size="sm">
            Erreur de chargement
          </AnimatedBadge>
        </div>
      ) : rows.length === 0 ? (
        <div className="px-2 py-3 text-sm text-muted-foreground">
          Aucun document
        </div>
      ) : query.trim() && filtered.length === 0 ? (
        <div className="px-2 py-8 text-center text-sm text-muted-foreground">
          Aucun résultat pour « {query} »
        </div>
      ) : (
        <ul>
          {filtered.map((row, index) => {
            const meta = metaFor(row.type);
            const Icon = meta.icon;
            const details = [row.size, formatDate(row.created_at)]
              .filter(Boolean)
              .join(" · ");
            return (
              <li
                key={row.id}
                className={cn(
                  "flex items-center gap-3.5 py-3.5",
                  index > 0 && "border-t border-border"
                )}
              >
                <div
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-xl",
                    meta.className
                  )}
                >
                  <Icon className="size-4" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-foreground">
                    {row.name}
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-faint">
                    {details}
                  </div>
                </div>

                {row.creator ? (
                  <span className="hidden shrink-0 whitespace-nowrap rounded-md bg-rowhover px-2.5 py-1 text-[8px] font-semibold uppercase tracking-wide text-muted-foreground sm:inline">
                    {row.creator}
                  </span>
                ) : null}

                <span
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[8px] font-semibold uppercase tracking-wide",
                    meta.tagClassName
                  )}
                >
                  {meta.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
