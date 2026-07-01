import { supabase } from "@/lib/supabase";
import { initials } from "@/lib/utils";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { useEffect, useState } from "react";

type Row = {
  id: string;
  brand: string;
  person: string;
  role: string;
  tone: string;
  tag: string;
  email: string;
  phone: string;
  sort_order: number;
};

export function Contacts() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    supabase
      .from("contacts")
      .select("id, brand, person, role, tone, tag, email, phone, sort_order")
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

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-sm px-4 py-3">
        <AnimatedBadge status="danger" size="sm">
          Erreur de chargement
        </AnimatedBadge>
      </div>
    );
  }

  if (rows === null) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-sm px-4 py-3">
        <AnimatedBadge status="loading" size="sm">
          Chargement…
        </AnimatedBadge>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="px-4 py-3">
        <span className="text-sm font-semibold text-foreground">
          {rows.length} contacts
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="border-t border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">Aucun contact</p>
        </div>
      ) : (
        rows.map((row) => (
          <div
            key={row.id}
            className="flex items-start gap-3 border-t border-border px-4 py-3 hover:bg-muted/60"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-foreground">
              {initials(row.person)}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-foreground">
                  {row.brand}
                </span>
                <span className="shrink-0 rounded-lg bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {row.tag}
                </span>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {row.person} · {row.role}
              </p>
              <p className="truncate text-xs text-muted-foreground">{row.email}</p>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
