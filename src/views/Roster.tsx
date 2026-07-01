import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { titleCase, initials } from "@/lib/utils";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";

type Creator = {
  name: string;
  handle: string | null;
  niche: string | null;
  platform: string | null;
  photo_url: string | null;
  sort_order: number | null;
};

export function Roster() {
  const [rows, setRows] = useState<Creator[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    supabase
      .from("public_roster")
      .select("name,handle,niche,platform,photo_url,sort_order")
      .order("sort_order")
      .then(({ data, error }) => {
        if (error) setError(true);
        else setRows((data as Creator[]) ?? []);
      });
  }, []);

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Impossible de charger le roster.
      </div>
    );
  }

  if (!rows) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <AnimatedBadge status="loading" size="sm">Chargement du roster…</AnimatedBadge>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 text-sm text-muted-foreground">
        {rows.length} créateur{rows.length > 1 ? "s" : ""} représenté
        {rows.length > 1 ? "s" : ""}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {rows.map((c, i) => (
          <div
            key={c.name}
            className={
              "flex items-center gap-3.5 px-4 py-3 transition-colors hover:bg-muted/60" +
              (i > 0 ? " border-t border-border" : "")
            }
          >
            {c.photo_url ? (
              <img
                src={c.photo_url}
                alt={titleCase(c.name)}
                className="h-11 w-11 shrink-0 rounded-xl object-cover"
              />
            ) : (
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-muted text-sm font-semibold text-muted-foreground">
                {initials(c.name)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {titleCase(c.name)}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {c.handle}
              </div>
            </div>
            {c.niche && (
              <span className="shrink-0 rounded-md bg-muted px-2.5 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
                {c.niche}
              </span>
            )}
            <AnimatedBadge status="success" size="sm" className="hidden sm:inline-flex">
              Actif
            </AnimatedBadge>
          </div>
        ))}
      </div>
    </>
  );
}
