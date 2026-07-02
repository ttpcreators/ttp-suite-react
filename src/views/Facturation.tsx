import { useEffect, useState } from "react";
import { FileText, Eye, Download, Pencil } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSearch, matchQuery } from "@/lib/search";
import { cn, titleCase } from "@/lib/utils";
import { parseAmount, formatEuro } from "@/lib/appState";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import type { AnimatedBadgeStatus } from "@/components/ui/be-ui-animated-badge";
import { dbInsert, dbUpdate, dbDelete, nextOrder } from "@/lib/db";
import { toast } from "@/components/ui/toast";
import {
  AddButton,
  InlineForm,
  TextField,
  SelectField,
  DeleteButton,
} from "@/components/ui/form";
import { useCreators } from "@/lib/useCreators";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);

function invoiceHTML(
  r: { ref: string; party: string; amount: string; date: string; creator: string | null },
  statusLabel: string,
): string {
  const today = new Date().toLocaleDateString("fr-FR");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Facture ${esc(r.ref)}</title>
<style>*{box-sizing:border-box}body{font-family:'Inter',-apple-system,Arial,sans-serif;color:#18181b;max-width:720px;margin:0 auto;padding:48px 28px;background:#fff}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #16a34a;padding-bottom:18px;margin-bottom:8px}
h1{font-size:30px;letter-spacing:-1px;margin:0}.muted{color:#71717a;font-size:13px;line-height:1.5}
table{width:100%;border-collapse:collapse;margin-top:26px}th,td{padding:12px 0;border-bottom:1px solid #e4e4e7;text-align:left;font-size:14px}
th{color:#71717a;font-weight:600;width:180px}.badge{display:inline-block;padding:5px 12px;border-radius:20px;background:#f0fdf4;color:#15803d;font-size:11px;font-weight:700}
.total{margin-top:30px;text-align:right;font-size:13px;color:#71717a}.total b{display:block;font-size:30px;letter-spacing:-1px;color:#18181b;margin-top:4px}
.foot{margin-top:48px;font-size:11px;color:#a1a1aa;border-top:1px solid #e4e4e7;padding-top:16px}</style></head><body>
<div class="head"><div><h1>FACTURE</h1><div class="muted">Réf. ${esc(r.ref)}</div></div>
<div style="text-align:right"><strong style="font-size:15px">TTP Creators</strong><div class="muted">Lyon · France<br>partnerships@ttpcreators.pro</div></div></div>
<table><tr><th>Client</th><td>${esc(r.party)}</td></tr>
${r.creator ? `<tr><th>Créateur</th><td>${esc(titleCase(r.creator))}</td></tr>` : ""}
<tr><th>Date d'émission</th><td>${today}</td></tr>
<tr><th>Échéance</th><td>${esc(r.date)}</td></tr>
<tr><th>Statut</th><td><span class="badge">${esc(statusLabel)}</span></td></tr></table>
<div class="total">Montant total<b>${esc(r.amount)}</b></div>
<div class="foot">Document généré par TTP Suite · TVA non applicable, art. 293 B du CGI · Paiement à 30 jours fin de mois.</div>
</body></html>`;
}

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
  const [rows, setRows] = useState<Row[] | null>(() => getCache<Row[]>("invoices"));
  const [error, setError] = useState(false);
  const { query } = useSearch();
  const creators = useCreators();
  const live = useLiveKey();

  const [formOpen, setFormOpen] = useState(false);
  const [brand, setBrand] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [due, setDue] = useState("");
  const [status, setStatus] = useState<InvoiceStatus>("brouillon");
  const [creator, setCreator] = useState("");
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "Tous">("Tous");

  const [editId, setEditId] = useState<string | null>(null);
  const [editParty, setEditParty] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editStatus, setEditStatus] = useState<InvoiceStatus>("brouillon");
  const [editCreator, setEditCreator] = useState("");

  useEffect(() => {
    supabase
      .from("invoices")
      .select("id,ref,party,amount,date,status,creator,sort_order")
      .order("sort_order")
      .then(({ data, error }) => {
        if (error) setError(true);
        else {
          const list = (data as Row[]) ?? [];
          setCache("invoices", list);
          setRows(list);
        }
      });
  }, [live]);

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

  const filtered = rows.filter(
    (r) =>
      matchQuery(query, r.ref, r.party, r.creator, r.status) &&
      (statusFilter === "Tous" || r.status === statusFilter),
  );

  const statusChips: { value: InvoiceStatus | "Tous"; label: string }[] = [
    { value: "Tous", label: "Tous" },
    ...STATUS_OPTIONS,
  ];

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
    const maxNum = rows.reduce(
      (m, r) => Math.max(m, Number(String(r.ref).split("-").pop()) || 0),
      180,
    );
    const row = {
      ref: `${new Date().getFullYear()}-${String(maxNum + 1).padStart(3, "0")}`,
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

  const openEdit = (r: Row) => {
    setEditId(r.id);
    setEditParty(r.party);
    setEditAmount(r.amount);
    setEditDate(r.date);
    setEditStatus(r.status);
    setEditCreator(r.creator ?? "");
  };

  const saveEdit = async () => {
    if (!editId) return;
    const partyTrim = editParty.trim();
    if (!partyTrim) {
      toast("Renseigne le client");
      return;
    }
    const patch = {
      party: partyTrim,
      amount: editAmount.trim() || "—",
      date: editDate.trim() || "—",
      status: editStatus,
      creator: editCreator || null,
    };
    if (!(await dbUpdate("invoices", editId, patch))) {
      toast("Erreur — réessaie");
      return;
    }
    setRows(rows.map((x) => (x.id === editId ? { ...x, ...patch } : x)));
    toast("Facture modifiée ✓");
    setEditId(null);
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
            { value: "", label: "— Aucun —" },
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

      {/* Barre de filtres par statut */}
      <div className="mb-4 flex flex-wrap gap-2">
        {statusChips.map((chip) => {
          const active = statusFilter === chip.value;
          return (
            <button
              key={chip.value}
              type="button"
              onClick={() => setStatusFilter(chip.value)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-surface text-muted-foreground hover:bg-rowhover hover:text-foreground",
              )}
            >
              {chip.label}
            </button>
          );
        })}
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
        ) : filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Aucune facture pour ce statut.
          </div>
        ) : (
          filtered.map((r) => {
            const meta = STATUS_META[r.status];
            return (
              <div key={r.id}>
              <InlineForm
                open={editId === r.id}
                title={`Modifier · ${r.ref}`}
                onClose={() => setEditId(null)}
                onSubmit={saveEdit}
                submitLabel="Enregistrer"
              >
                <TextField label="Client" value={editParty} onChange={setEditParty} />
                <TextField
                  label="Montant"
                  value={editAmount}
                  onChange={setEditAmount}
                  placeholder="ex 3 000 €"
                />
                <TextField label="Échéance" value={editDate} onChange={setEditDate} />
                <SelectField
                  label="Statut"
                  value={editStatus}
                  onChange={(v) => setEditStatus(v as InvoiceStatus)}
                  options={STATUS_OPTIONS}
                />
                <SelectField
                  label="Créateur"
                  value={editCreator}
                  onChange={setEditCreator}
                  options={[
                    { value: "", label: "— Aucun —" },
                    ...creators.map((c) => ({ value: c.name, label: c.name })),
                  ]}
                />
              </InlineForm>
              <div
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
                      title="Modifier la facture"
                      onClick={() => openEdit(r)}
                      className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Aperçu de la facture"
                      onClick={() => {
                        const w = window.open("", "_blank", "width=820,height=920");
                        if (w) {
                          w.document.write(invoiceHTML(r, meta.label));
                          w.document.close();
                        } else {
                          toast("Autorise les pop-ups pour l'aperçu");
                        }
                      }}
                      className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Télécharger la facture"
                      onClick={() => {
                        const blob = new Blob([invoiceHTML(r, meta.label)], {
                          type: "text/html;charset=utf-8",
                        });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `facture-${r.ref}.html`;
                        a.click();
                        URL.revokeObjectURL(url);
                        toast("Facture téléchargée ✓");
                      }}
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
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
