import { supabase } from "@/lib/supabase";
import { initials } from "@/lib/utils";
import { useSearch, matchQuery } from "@/lib/search";
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
  const { query } = useSearch();

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

  const filtered = rows.filter((row) =>
    matchQuery(query, row.brand, row.person, row.role, row.email, row.tag)
  );

  return (
    <>
      <div className="mb-4 text-sm text-muted-foreground">
        {rows.length} contact{rows.length > 1 ? "s" : ""}
      </div>

      <div className="rounded-xl border border-border bg-card px-5 shadow-sm">
        {rows.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            Aucun contact
          </div>
        ) : query.trim() && filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Aucun résultat pour « {query} »
          </div>
        ) : (
          filtered.map((row) => (
            <div
              key={row.id}
              className="flex cursor-pointer items-center gap-3.5 border-b border-border py-3.5 last:border-b-0 hover:bg-rowhover"
            >
              {/* Avatar */}
              <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[9px] bg-surface text-[11px] font-bold text-foreground">
                {initials(row.person)}
              </div>

              {/* Marque + person · role */}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-foreground">
                  {row.brand}
                </div>
                <div className="mt-0.5 truncate text-[11px] font-normal text-faint">
                  {row.person} · {row.role}
                </div>
              </div>

              {/* Email — masqué sur mobile */}
              <div className="hidden max-w-[200px] truncate text-[11px] font-medium text-muted-foreground sm:block">
                {row.email}
              </div>

              {/* Pastille tag */}
              <span className="shrink-0 whitespace-nowrap rounded-full bg-rowhover px-2.5 py-1 text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">
                {row.tag}
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
