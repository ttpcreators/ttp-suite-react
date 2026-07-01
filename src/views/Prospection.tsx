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

// Ordre de colonnes fidèle à l'original (app.js : stages).
const STAGE_ORDER = ["Prospection", "Contact", "Négociation", "Signé"];

// Couleur de la pastille par tone (équivalents de toneHex de l'original).
const DOT_CLASS: Record<NonNullable<Row["tone"]>, string> = {
  success: "bg-signal",
  info: "bg-indigo",
  neutral: "bg-cyan",
  warning: "bg-amber",
  danger: "bg-signal",
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
      <div className="rounded-2xl border border-border bg-surface shadow-sm px-4 py-10 text-center">
        <p className="text-sm font-medium text-foreground">Pipeline vide</p>
        <p className="text-xs text-muted-foreground mt-1.5">
          {error
            ? "Impossible de charger les prospects."
            : "Ajoute ta première marque à prospecter avec « + Marque »."}
        </p>
      </div>
    );
  }

  const filtered = rows.filter((row) =>
    matchQuery(query, row.brand, row.contact, row.stage),
  );

  if (query.trim() && filtered.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface shadow-sm">
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          Aucun résultat pour « {query} »
        </div>
      </div>
    );
  }

  // Groupement par étape : d'abord l'ordre canonique du pipeline, puis toute
  // étape hors liste rencontrée dans les données (fallback "Sans étape").
  const present = new Set(filtered.map((row) => row.stage ?? "Sans étape"));
  const stages = [
    ...STAGE_ORDER.filter((s) => present.has(s)),
    ...[...present].filter((s) => !STAGE_ORDER.includes(s)),
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5 items-start">
      {stages.map((stage) => {
        const cards = filtered.filter(
          (row) => (row.stage ?? "Sans étape") === stage,
        );
        return (
          <div key={stage}>
            <div className="flex items-center justify-between px-1.5 pb-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground">
                {stage}
              </span>
              <span className="text-[10px] font-semibold text-muted-foreground">
                {cards.length}
              </span>
            </div>
            <div className="flex flex-col gap-2.5">
              {cards.map((card) => (
                <div
                  key={card.id}
                  className={cn(
                    "rounded-xl bg-surface p-3.5 transition-colors hover:bg-rowhover",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-[7px] w-[7px] shrink-0 rounded-full",
                        card.tone ? DOT_CLASS[card.tone] : "bg-cyan",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                      {card.brand}
                    </span>
                  </div>
                  {card.contact && (
                    <p className="mt-1.5 truncate text-[10px] text-muted-foreground">
                      {card.contact}
                    </p>
                  )}
                  <p className="mt-2 text-[13px] font-semibold text-foreground">
                    {card.value ?? "—"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
