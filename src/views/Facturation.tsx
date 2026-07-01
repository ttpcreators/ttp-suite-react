import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSearch, matchQuery } from "@/lib/search";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import type { AnimatedBadgeStatus } from "@/components/ui/be-ui-animated-badge";

type InvoiceStatus = "payee" | "attente" | "retard" | "brouillon";

type Row = {
  id: string;
  ref: string;
  party: string;
  amount: string;
  date: string;
  status: InvoiceStatus;
  creator: string | null;
  sort_order: number | null;
};

const STATUS_META: Record<
  InvoiceStatus,
  { badge: AnimatedBadgeStatus; label: string }
> = {
  payee: { badge: "success", label: "Payée" },
  attente: { badge: "warning", label: "En attente" },
  retard: { badge: "danger", label: "En retard" },
  brouillon: { badge: "neutral", label: "Brouillon" },
};

function parseAmount(value: string): number {
  return Number(String(value).replace(/[^0-9]/g, "")) || 0;
}

function formatAmount(value: number): string {
  return `${value.toLocaleString("fr-FR").replace(/ | /g, " ")} €`;
}

export function Facturation() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const { query } = useSearch();

  useEffect(() => {
    supabase
      .from("invoices")
      .select("id,ref,party,amount,date,status,creator,sort_order")
      .order("sort_order")
      .then(({ data, error }) => {
        if (error) setError(true);
        else setRows((data as Row[]) ?? []);
      });
  }, []);

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Impossible de charger la facturation.
      </div>
    );
  }

  if (!rows) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <AnimatedBadge status="loading" size="sm">
          Chargement…
        </AnimatedBadge>
      </div>
    );
  }

  const totals = rows.reduce(
    (acc, r) => {
      const amount = parseAmount(r.amount);
      acc.total += amount;
      if (r.status === "payee") acc.payee += amount;
      else if (r.status === "attente") acc.attente += amount;
      else if (r.status === "retard") acc.retard += amount;
      return acc;
    },
    { payee: 0, attente: 0, retard: 0, total: 0 },
  );

  const cards: { label: string; value: number; badge: AnimatedBadgeStatus }[] = [
    { label: "Encaissé", value: totals.payee, badge: "success" },
    { label: "En attente", value: totals.attente, badge: "warning" },
    { label: "En retard", value: totals.retard, badge: "danger" },
    { label: "Total facturé", value: totals.total, badge: "info" },
  ];

  const filtered = rows.filter((r) =>
    matchQuery(query, r.ref, r.party, r.creator, r.status),
  );

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-border bg-card p-4 shadow-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{c.label}</span>
              <AnimatedBadge status={c.badge} size="sm" />
            </div>
            <div className="mt-2 text-lg font-semibold text-foreground">
              {formatAmount(c.value)}
            </div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Aucune facture pour le moment.
        </div>
      ) : query.trim() && filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Aucun résultat pour « {query} »
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {filtered.map((r, i) => (
            <div
              key={r.id}
              className={
                "flex items-center gap-3.5 px-4 py-3 transition-colors hover:bg-muted/60" +
                (i > 0 ? " border-t border-border" : "")
              }
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  #{r.ref} · {r.party}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  Échéance {r.date}
                  {r.creator ? ` · ${r.creator}` : ""}
                </div>
              </div>
              <div className="shrink-0 text-sm font-semibold text-foreground">
                {formatAmount(parseAmount(r.amount))}
              </div>
              <AnimatedBadge status={STATUS_META[r.status].badge} size="sm">
                {STATUS_META[r.status].label}
              </AnimatedBadge>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
