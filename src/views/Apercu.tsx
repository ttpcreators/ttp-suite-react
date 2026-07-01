import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSearch, matchQuery } from "@/lib/search";
import { parseAmount, formatEuro } from "@/lib/appState";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import type { AnimatedBadgeStatus } from "@/components/ui/be-ui-animated-badge";
import { Wallet, Clock3, AlertTriangle, ReceiptEuro } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type InvoiceStatus = "payee" | "attente" | "retard" | "brouillon";

type Row = {
  ref: string;
  party: string;
  amount: string;
  date: string;
  status: InvoiceStatus;
  creator: string | null;
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

export function Apercu() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const { query } = useSearch();

  useEffect(() => {
    let active = true;
    supabase
      .from("invoices")
      .select("ref, party, amount, date, status, creator")
      .order("sort_order")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setError(true);
          setRows([]);
          return;
        }
        setRows((data ?? []) as Row[]);
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-sm">
        Impossible de charger les données.
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

  const sumByStatus = (status: InvoiceStatus): number =>
    rows
      .filter((r) => r.status === status)
      .reduce((acc, r) => acc + parseAmount(r.amount), 0);

  const encaisse = sumByStatus("payee");
  const attente = sumByStatus("attente");
  const retard = sumByStatus("retard");
  const total = rows.reduce((acc, r) => acc + parseAmount(r.amount), 0);

  const kpis: {
    label: string;
    value: number;
    icon: LucideIcon;
    accent: string;
  }[] = [
    { label: "CA encaissé", value: encaisse, icon: Wallet, accent: "text-signaltext" },
    { label: "En attente", value: attente, icon: Clock3, accent: "text-amber" },
    { label: "En retard", value: retard, icon: AlertTriangle, accent: "text-amber" },
    { label: "Total facturé", value: total, icon: ReceiptEuro, accent: "text-muted-foreground" },
  ];

  const recent = rows.slice(-5).reverse();
  const filtered = recent.filter((r) =>
    matchQuery(query, r.ref, r.party, r.creator, r.status),
  );

  return (
    <div className="space-y-4">
      {/* Rangée de cartes KPI */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div
              key={k.label}
              className="rounded-xl border border-border bg-card p-5 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">
                  {k.label}
                </span>
                <Icon className={`h-4 w-4 ${k.accent}`} strokeWidth={2} />
              </div>
              <div className="mt-3 whitespace-nowrap text-2xl font-bold tracking-tight text-foreground">
                {formatEuro(k.value)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Factures récentes */}
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">
            Factures récentes
          </h2>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">
            5 dernières
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="border-t border-border px-5 py-8 text-center text-sm text-muted-foreground">
            Aucune facture pour le moment.
          </div>
        ) : query.trim() && filtered.length === 0 ? (
          <div className="border-t border-border px-5 py-8 text-center text-sm text-muted-foreground">
            Aucun résultat pour « {query} »
          </div>
        ) : (
          <ul>
            {filtered.map((r) => {
              const meta = STATUS_META[r.status] ?? STATUS_META.brouillon;
              return (
                <li
                  key={r.ref}
                  className="flex items-center gap-3 border-t border-border px-5 py-3 transition-colors hover:bg-rowhover"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {r.party}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-faint">
                      #{r.ref} · {r.date}
                      {r.creator ? ` · ${r.creator}` : ""}
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-foreground">
                    {formatEuro(parseAmount(r.amount))}
                  </span>
                  <div className="hidden shrink-0 sm:block">
                    <AnimatedBadge status={meta.badge} size="sm">
                      {meta.label}
                    </AnimatedBadge>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
