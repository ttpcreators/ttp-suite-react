import { useEffect, useState } from "react";
import { FileText, Eye, Download } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSearch, matchQuery } from "@/lib/search";
import { cn, titleCase } from "@/lib/utils";
import { parseAmount, formatEuro } from "@/lib/appState";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import type { AnimatedBadgeStatus } from "@/components/ui/be-ui-animated-badge";
import { dbInsert, dbDelete, nextOrder } from "@/lib/db";
import { toast } from "@/components/ui/toast";
import {
  AddButton,
  InlineForm,
  TextField,
  SelectField,
  DeleteButton,
} from "@/components/ui/form";
import { useCreators } from "@/lib/useCreators";

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

const STATUS_OPTIONS: { value: InvoiceStatus; label: string }[] = [
  { value: "brouillon", label: "Brouillon" },
  { value: "attente", label: "En attente" },
  { value: "payee", label: "Payée" },
  { value: "retard", label: "En retard" },
];

export function Facturation() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const { query } = useSearch();
  const creators = useCreators();

  const [formOpen, setFormOpen] = useState(false);
  const [brand, setBrand] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [due, setDue] = useState("");
  const [status, setStatus] = useState<InvoiceStatus>("brouillon");
  const [creator, setCreator] = useState("");

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
      else if (r.status === "attente") {
        acc.attente += amount;
        acc.attenteCount += 1;
      } else if (r.status === "retard") acc.retard += amount;
      return acc;
    },
    { payee: 0, attente: 0, retard: 0, total: 0, attenteCount: 0 },
  );

  const cards: {
    label: string;
    value: number;
    hint: string;
    hintClass: string;
  }[] = [
    {
      label: "Facturé · total",
      value: totals.total,
      hint: `${rows.length} facture${rows.length > 1 ? "s" : ""}`,
      hintClass: "text-muted-foreground",
    },
    {
      label: "Encaissé",
      value: totals.payee,
      hint: "payé",
      hintClass: "text-signaltext",
    },
    {
      label: "En attente",
      value: totals.attente,
      hint: `${totals.attenteCount} en cours`,
      hintClass: "text-indigo",
    },
    {
      label: "En retard",
      value: totals.retard,
      hint: "à relancer",
      hintClass: "text-amber",
    },
  ];

  const filtered = rows.filter((r) =>
    matchQuery(query, r.ref, r.party, r.creator, r.status),
  );

  const submit = async () => {
    const brandTrim = brand.trim();
    if (!brandTrim) {
      toast("Renseigne la marque");
      return;
    }
    const amount =
      (Number(String(amountInput).replace(/[^0-9]/g, "")) || 0).toLocaleString(
        "fr-FR",
      ) + " €";
    const party = creator
      ? `${brandTrim} × ${titleCase(creator).split(" ")[0]}`
      : brandTrim;
    const row = {
      ref: `${new Date().getFullYear()}-${String(180 + rows.length).padStart(3, "0")}`,
      party,
      amount,
      date: due.trim() || "—",
      status,
      creator: creator || null,
      sort_order: nextOrder(rows),
    };
    const created = await dbInsert("invoices", row);
    if (!created) {
      toast("Erreur — réessaie");
      return;
    }
    setRows([created as unknown as Row, ...rows]);
    toast("Facture ajoutée ✓");
    setFormOpen(false);
    setBrand("");
    setAmountInput("");
    setDue("");
    setStatus("brouillon");
    setCreator("");
  };

  return (
    <>
      {/* Barre d'en-tête */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {rows.length} facture{rows.length > 1 ? "s" : ""}
        </div>
        <AddButton label="Facture" onClick={() => setFormOpen(true)} />
      </div>

      {/* Formulaire d'ajout */}
      <InlineForm
        open={formOpen}
        title="Nouvelle facture"
        onClose={() => setFormOpen(false)}
        onSubmit={submit}
      >
        <TextField label="Marque" value={brand} onChange={setBrand} />
        <TextField
          label="Montant"
          value={amountInput}
          onChange={setAmountInput}
          placeholder="ex 3000"
        />
        <TextField label="Échéance" value={due} onChange={setDue} />
        <SelectField
          label="Statut"
          value={status}
          onChange={(v) => setStatus(v as InvoiceStatus)}
          options={STATUS_OPTIONS}
        />
        <SelectField
          label="Créateur"
          value={creator}
          onChange={setCreator}
          options={[
            { value: "", label: "—" },
            ...creators.map((c) => ({ value: c.name, label: c.name })),
          ]}
        />
      </InlineForm>

      {/* Cartes de totaux */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-border bg-surface p-4 shadow-sm"
          >
            <div className="text-[9px] font-semibold uppercase tracking-wider text-faint">
              {c.label}
            </div>
            <div className="mt-2 whitespace-nowrap text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              {formatEuro(c.value)}
            </div>
            <div className={cn("mt-1 text-[10px] font-semibold", c.hintClass)}>
              {c.hint}
            </div>
          </div>
        ))}
      </div>

      {/* Liste des factures */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface p-2 shadow-sm">
        {/* En-tête colonnes (desktop) */}
        <div className="hidden grid-cols-[0.9fr_2.2fr_1.2fr_1.1fr_1.3fr] gap-3 px-4 py-3 text-[9px] font-semibold uppercase tracking-wider text-faint md:grid">
          <span>Réf.</span>
          <span>Marque × Créateur</span>
          <span className="text-right">Montant</span>
          <span className="text-center">Échéance</span>
          <span className="text-right">Statut</span>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <div className="text-sm font-medium text-foreground">
              Aucune facture
            </div>
            <div className="mt-1.5 text-xs text-faint">
              Crée ta première facture avec « + Facture ».
            </div>
          </div>
        ) : query.trim() && filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Aucun résultat pour « {query} »
          </div>
        ) : (
          filtered.map((r) => {
            const meta = STATUS_META[r.status];
            return (
              <div
                key={r.id}
                className="grid grid-cols-1 items-center gap-1 rounded-xl px-4 py-3 transition-colors hover:bg-rowhover md:grid-cols-[0.9fr_2.2fr_1.2fr_1.1fr_1.3fr] md:gap-3"
              >
                {/* Réf. */}
                <span className="flex items-center gap-2 text-[11px] font-medium text-faint">
                  <FileText className="h-3.5 w-3.5 md:hidden" />#{r.ref}
                </span>

                {/* Marque × Créateur */}
                <span className="truncate text-sm font-medium text-foreground">
                  {r.party}
                </span>

                {/* Montant */}
                <span className="text-sm font-semibold text-foreground md:text-right">
                  {formatEuro(parseAmount(r.amount))}
                </span>

                {/* Échéance */}
                <span className="text-[11px] font-medium text-muted-foreground md:text-center">
                  <span className="md:hidden">Échéance </span>
                  {r.date}
                </span>

                {/* Statut + actions */}
                <span className="mt-1 flex items-center justify-start gap-2 md:mt-0 md:justify-end">
                  <AnimatedBadge status={meta.badge} size="sm">
                    {meta.label}
                  </AnimatedBadge>
                  <span className="hidden items-center gap-1 md:flex">
                    <button
                      type="button"
                      title="Aperçu de la facture"
                      className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Télécharger la facture"
                      className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </span>
                  <DeleteButton
                    onClick={async () => {
                      if (await dbDelete("invoices", r.id)) {
                        setRows(rows.filter((x) => x.id !== r.id));
                        toast("Supprimé");
                      }
                    }}
                  />
                </span>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
