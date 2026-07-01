import { supabase } from "@/lib/supabase";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { useEffect, useState } from "react";

type Row = {
  ref: string;
  party: string;
  amount: string;
  date: string;
  status: string;
  creator: string;
};

type BadgeStatus = "success" | "warning" | "danger" | "neutral" | "info" | "loading";

function parseAmount(x: string): number {
  return Number(String(x).replace(/[^0-9]/g, "")) || 0;
}

function formatAmount(n: number): string {
  return `${n.toLocaleString("fr-FR").replace(/ /g, " ")} €`;
}

function statusBadge(status: string): BadgeStatus {
  switch (status) {
    case "payee":
      return "success";
    case "attente":
      return "warning";
    case "retard":
      return "danger";
    default:
      return "neutral";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "payee":
      return "Payée";
    case "attente":
      return "En attente";
    case "retard":
      return "En retard";
    case "brouillon":
      return "Brouillon";
    default:
      return status;
  }
}

export function Apercu() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<boolean>(false);

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

  if (rows === null) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <AnimatedBadge status="loading" size="sm">
          Chargement…
        </AnimatedBadge>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <p className="text-sm text-muted-foreground">
          Impossible de charger les données.
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <p className="text-sm text-muted-foreground">Aucune facture pour le moment.</p>
      </div>
    );
  }

  const sumByStatus = (status: string): number =>
    rows
      .filter((r) => r.status === status)
      .reduce((acc, r) => acc + parseAmount(r.amount), 0);

  const encaisse = sumByStatus("payee");
  const attente = sumByStatus("attente");
  const retard = sumByStatus("retard");
  const total = rows.reduce((acc, r) => acc + parseAmount(r.amount), 0);

  const stats: { label: string; value: number }[] = [
    { label: "CA encaissé", value: encaisse },
    { label: "En attente", value: attente },
    { label: "En retard", value: retard },
    { label: "Total facturé", value: total },
  ];

  const recent = rows.slice(-5).reverse();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {s.label}
            </p>
            <p className="mt-1 text-2xl font-semibold text-foreground">
              {formatAmount(s.value)}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Factures récentes</h2>
        </div>
        <ul>
          {recent.map((r) => (
            <li
              key={r.ref}
              className="flex items-center justify-between border-t border-border px-4 py-3 hover:bg-muted/60"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {r.party}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.ref} · {r.date}
                </p>
              </div>
              <div className="flex items-center gap-3 pl-3">
                <span className="text-sm font-semibold text-foreground">
                  {formatAmount(parseAmount(r.amount))}
                </span>
                <AnimatedBadge status={statusBadge(r.status)} size="sm">
                  {statusLabel(r.status)}
                </AnimatedBadge>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
