import { supabase } from "@/lib/supabase";
import { useSearch, matchQuery } from "@/lib/search";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { cn } from "@/lib/utils";
import { CalendarClock, Wallet, Target, Package } from "lucide-react";
import { useEffect, useState } from "react";

type Row = {
  id: string;
  brand: string;
  creator: string;
  deliverables: string;
  due: string;
  status: string;
  budget: string;
  objectif: string;
  sort_order: number;
};

type BadgeStatus = "success" | "warning" | "danger" | "neutral" | "info" | "loading";

function statusMeta(status: string): { variant: BadgeStatus; label: string; dot: string } {
  const s = String(status).toLowerCase();
  if (s.includes("valider") || s.includes("attente")) {
    return { variant: "warning", label: "À valider", dot: "bg-amber" };
  }
  if (s.includes("cours")) {
    return { variant: "info", label: "En cours", dot: "bg-cyan" };
  }
  if (s.includes("termine")) {
    return { variant: "success", label: "Terminé", dot: "bg-signal" };
  }
  return { variant: "neutral", label: status, dot: "bg-muted-foreground" };
}

export function Briefs() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const { query } = useSearch();

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("briefs")
        .select("id, brand, creator, deliverables, due, status, budget, objectif, sort_order")
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
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <AnimatedBadge status="loading" size="sm">Chargement…</AnimatedBadge>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <p className="text-sm text-muted-foreground">
          Une erreur est survenue lors du chargement des briefs.
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <p className="text-sm text-muted-foreground">Aucun brief pour le moment.</p>
      </div>
    );
  }

  const filtered = rows.filter((row) =>
    matchQuery(query, row.brand, row.creator, row.deliverables, row.status)
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
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {filtered.map((row) => {
        const meta = statusMeta(row.status);
        return (
          <div
            key={row.id}
            className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-sm transition-colors hover:bg-rowhover"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={cn("h-[7px] w-[7px] shrink-0 rounded-full", meta.dot)} />
                  <h2 className="truncate text-[15px] font-semibold tracking-tight text-foreground">
                    {row.brand}
                  </h2>
                </div>
                <p className="mt-1.5 truncate text-xs text-muted-foreground">
                  {row.creator || "—"} · échéance {row.due || "—"}
                </p>
              </div>
              <AnimatedBadge status={meta.variant} size="sm">
                {meta.label}
              </AnimatedBadge>
            </div>

            <div className="mt-4 rounded-xl bg-panel px-4 py-3">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                <Package className="h-3 w-3" />
                Livrables
              </div>
              <div className="mt-1.5 text-[13px] font-medium leading-snug text-foreground">
                {row.deliverables || "—"}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-panel px-4 py-3">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                  <Wallet className="h-3 w-3" />
                  Budget
                </div>
                <div className="mt-1.5 truncate text-[13px] font-medium text-foreground">
                  {row.budget || "—"}
                </div>
              </div>
              <div className="rounded-xl bg-panel px-4 py-3">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                  <Target className="h-3 w-3" />
                  Objectif
                </div>
                <div className="mt-1.5 truncate text-[13px] font-medium text-foreground">
                  {row.objectif || "—"}
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-1.5 border-t border-border pt-3 text-[11px] text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5 shrink-0 text-faint" />
              <span className="truncate">Échéance {row.due || "—"}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
