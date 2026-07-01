import { supabase } from "@/lib/supabase";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
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

function statusMeta(status: string): { variant: BadgeStatus; label: string } {
  const s = String(status).toLowerCase();
  if (s.includes("valider") || s.includes("attente")) {
    return { variant: "warning", label: "À valider" };
  }
  if (s.includes("cours")) {
    return { variant: "info", label: "En cours" };
  }
  if (s.includes("termine")) {
    return { variant: "success", label: "Terminé" };
  }
  return { variant: "neutral", label: status };
}

export function Briefs() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

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

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {rows.map((row) => {
        const meta = statusMeta(row.status);
        return (
          <div
            key={row.id}
            className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm transition-colors hover:bg-muted/60"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-foreground">{row.brand}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  échéance {row.due} · budget {row.budget}
                </p>
              </div>
              <AnimatedBadge status={meta.variant} size="sm">
                {meta.label}
              </AnimatedBadge>
            </div>
            <p className="mt-3 border-t border-border pt-3 text-sm text-foreground">
              {row.deliverables}
            </p>
          </div>
        );
      })}
    </div>
  );
}
