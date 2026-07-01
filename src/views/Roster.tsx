import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { cn, titleCase, initials } from "@/lib/utils";
import { useSearch, matchQuery } from "@/lib/search";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";

type CreatorRow = {
  name: string;
  handle: string | null;
  niche: string | null;
  platform: string | null;
  followers: string | null;
  er: string | null;
  ca: string | null;
  status: string | null;
  photo_url: string | null;
  sort_order: number | null;
};

type Creator = {
  name: string;
  handle: string;
  niche: string;
  platform: string;
  followers: string;
  er: string;
  ca: string;
  status: string;
  photo: string;
};

function mapCreator(r: CreatorRow): Creator {
  return {
    name: r.name,
    handle: r.handle ?? "",
    niche: r.niche ?? "",
    platform: r.platform ?? "",
    followers: r.followers ?? "—",
    er: r.er ?? "—",
    ca: r.ca ?? "—",
    status: (r.status ?? "actif").toLowerCase(),
    photo: r.photo_url ?? "",
  };
}

const STATUS_LABEL: Record<string, string> = {
  live: "LIVE",
  actif: "ACTIF",
  pause: "PAUSE",
};

export function Roster() {
  const [rows, setRows] = useState<Creator[] | null>(null);
  const [error, setError] = useState(false);
  const { query } = useSearch();

  useEffect(() => {
    supabase
      .from("creators")
      .select("*")
      .order("sort_order")
      .then(({ data, error }) => {
        if (error) setError(true);
        else setRows(((data as CreatorRow[]) ?? []).map(mapCreator));
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
        <AnimatedBadge status="loading" size="sm">
          Chargement du roster…
        </AnimatedBadge>
      </div>
    );
  }

  const filtered = rows.filter((c) =>
    matchQuery(query, c.name, c.handle, c.niche, c.platform),
  );

  const cols =
    "grid-cols-[2.4fr_1fr_0.9fr_0.8fr_1.1fr_0.9fr] gap-3";

  return (
    <>
      <div className="mb-4 text-sm text-muted-foreground">
        {rows.length} créateur{rows.length > 1 ? "s" : ""} représenté
        {rows.length > 1 ? "s" : ""}
      </div>

      {query.trim() && filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Aucun résultat pour « {query} »
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-2 shadow-sm">
          {/* En-tête de tableau (desktop) */}
          <div
            className={cn(
              "hidden items-center px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-faint md:grid",
              cols,
            )}
          >
            <span>Créateur</span>
            <span>Niche</span>
            <span className="text-right">Abonnés</span>
            <span className="text-right">ER</span>
            <span className="text-right">CA · Mois</span>
            <span className="text-right">Statut</span>
          </div>

          {filtered.map((c) => {
            const label = STATUS_LABEL[c.status] ?? "ACTIF";
            const badgeStatus =
              c.status === "live"
                ? "danger"
                : c.status === "pause"
                  ? "warning"
                  : "success";
            return (
              <div
                key={c.name}
                className={cn(
                  "rounded-xl px-4 py-2.5 transition-colors hover:bg-rowhover",
                  "flex items-center gap-3 md:grid",
                  cols,
                )}
              >
                {/* Créateur : avatar carré + nom titleCase + @handle */}
                <div className="flex min-w-0 flex-1 items-center gap-3 md:flex-none">
                  {c.photo ? (
                    <img
                      src={c.photo}
                      alt={titleCase(c.name)}
                      className="h-10 w-10 shrink-0 rounded-xl object-cover"
                    />
                  ) : (
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface text-xs font-semibold text-muted-foreground">
                      {initials(c.name)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {titleCase(c.name)}
                    </div>
                    <div className="truncate text-xs text-faint">
                      {c.handle}
                    </div>
                  </div>
                </div>

                {/* Niche : pastille sur mobile, texte sur desktop */}
                <span className="hidden truncate text-xs text-muted-foreground md:inline">
                  {c.niche}
                </span>

                {/* Abonnés / ER / CA — masqués sur mobile */}
                <span className="hidden text-right text-xs font-semibold text-foreground md:inline">
                  {c.followers}
                </span>
                <span className="hidden text-right text-xs font-semibold text-foreground md:inline">
                  {c.er}
                </span>
                <span className="hidden text-right text-xs font-semibold text-foreground md:inline">
                  {c.ca}
                </span>

                {/* Bloc droit mobile : niche + statut */}
                <div className="flex shrink-0 items-center gap-2 md:contents">
                  {c.niche && (
                    <span className="rounded-md bg-surface px-2.5 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground md:hidden">
                      {c.niche}
                    </span>
                  )}
                  <div className="flex items-center justify-end md:col-start-6">
                    <AnimatedBadge status={badgeStatus} size="sm">
                      {titleCase(label.toLowerCase())}
                    </AnimatedBadge>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
