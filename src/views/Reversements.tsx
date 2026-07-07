import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, parseAmount, formatEuro, type AppState } from "@/lib/appState";
import { useCreators } from "@/lib/useCreators";
import { commissionMap } from "@/lib/commission";
import { titleCase, initials } from "@/lib/utils";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { toast } from "@/components/ui/toast";

/**
 * Suivi des reversements créateurs : combien l'agence doit à chaque créateur
 * (CA encaissé − commission), combien a déjà été payé, et le reste dû.
 * Les paiements sont stockés dans le blob agence `creatorPayouts`.
 */

type Inv = { amount: string; status: string; creator: string | null };
type Payout = { id: string; date: string; amount: number; note?: string };
type PayoutsMap = Record<string, Payout[]>;

const DEFAULT_COMMISSION = 20;
let _uid = 0;
const uid = () => `pay${Date.now().toString(36)}${(_uid += 1)}`;
const todayISO = () => new Date().toISOString().slice(0, 10);

type Row = {
  creator: string;
  encaisse: number;
  rate: number;
  commission: number;
  du: number;
  reverse: number;
  reste: number;
  payouts: Payout[];
};

export function Reversements() {
  const [invoices, setInvoices] = useState<Inv[] | null>(() => getCache<Inv[]>("revInvoices"));
  const [error, setError] = useState(false);
  const live = useLiveKey();
  const { data: app } = useAppState<AppState>();
  const creators = useCreators();
  const [localPayouts, setLocalPayouts] = useState<PayoutsMap | null>(null);

  const commissions = (app?.creatorCommission as Record<string, number>) ?? {};
  const payoutsMap: PayoutsMap = localPayouts ?? ((app?.creatorPayouts as PayoutsMap) ?? {});

  useEffect(() => {
    let alive = true;
    supabase
      .from("invoices")
      .select("amount,status,creator")
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          setError(true);
          return;
        }
        const next = (data as Inv[]) ?? [];
        setCache("revInvoices", next);
        setInvoices(next);
      });
    return () => {
      alive = false;
    };
  }, [live]);

  const rows: Row[] = useMemo(() => {
    if (!invoices) return [];
    const rosterCommission = commissionMap(creators);
    const enc = new Map<string, number>();
    for (const iv of invoices) {
      if (iv.status !== "payee") continue;
      const c = (iv.creator || "").trim();
      if (!c) continue;
      enc.set(c, (enc.get(c) ?? 0) + parseAmount(iv.amount));
    }
    // Inclure aussi les créateurs qui ont déjà des paiements enregistrés.
    for (const c of Object.keys(payoutsMap)) if (!enc.has(c)) enc.set(c, 0);
    const out: Row[] = [];
    for (const [creator, encaisse] of enc) {
      const rate = rosterCommission[creator] ?? (commissions[creator] != null ? commissions[creator] : DEFAULT_COMMISSION);
      const commission = Math.round(encaisse * (rate / 100));
      const du = encaisse - commission;
      const list = payoutsMap[creator] ?? [];
      const reverse = list.reduce((s, p) => s + (p.amount || 0), 0);
      out.push({ creator, encaisse, rate, commission, du, reverse, reste: du - reverse, payouts: list });
    }
    return out.sort((a, b) => b.reste - a.reste);
  }, [invoices, commissions, payoutsMap, creators]);

  const totalReste = rows.reduce((s, r) => s + Math.max(0, r.reste), 0);
  const totalDu = rows.reduce((s, r) => s + r.du, 0);
  const totalReverse = rows.reduce((s, r) => s + r.reverse, 0);

  // Relit FRAIS le blob et ne fusionne QUE le créateur modifié (paiements = argent :
  // deux postes ne doivent jamais s'écraser). Renvoie le booléen d'écriture.
  const mutatePayouts = async (creator: string, fn: (arr: Payout[]) => Payout[]): Promise<boolean> => {
    invalidateAppState();
    const fresh = ((await getAppState())["creatorPayouts"] as PayoutsMap) ?? {};
    const next: PayoutsMap = { ...fresh, [creator]: fn(fresh[creator] ?? []) };
    setLocalPayouts(next);
    const ok = await saveAppStateKey("creatorPayouts", next);
    if (!ok) toast("Erreur — réessaie");
    return ok;
  };

  const [openFor, setOpenFor] = useState<string | null>(null);
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [pendingDel, setPendingDel] = useState<null | { message: string; run: () => void }>(null);

  const openAdd = (creator: string, reste: number) => {
    setOpenFor(creator);
    setAmt(reste > 0 ? String(reste) : "");
    setDate(todayISO());
    setNote("");
  };
  const submitPayout = async (creator: string) => {
    const n = Number(amt.replace(",", ".")) || 0;
    if (n <= 0) {
      toast("Montant invalide");
      return;
    }
    const entry: Payout = { id: uid(), date: date || todayISO(), amount: n, note: note.trim() || undefined };
    setOpenFor(null);
    const ok = await mutatePayouts(creator, (arr) => [entry, ...arr]);
    if (ok) toast("Paiement enregistré ✓");
  };
  const removePayout = async (creator: string, id: string) => {
    const ok = await mutatePayouts(creator, (arr) => arr.filter((p) => p.id !== id));
    if (ok) toast("Paiement supprimé");
  };

  if (error)
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted-foreground">
        Impossible de charger les reversements.
      </div>
    );
  if (!invoices)
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <AnimatedBadge status="loading" size="sm">
          Chargement…
        </AnimatedBadge>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="Reste à reverser" value={formatEuro(totalReste)} tone="amber" />
        <SummaryCard label="Total dû aux créateurs" value={formatEuro(totalDu)} tone="primary" />
        <SummaryCard label="Déjà reversé" value={formatEuro(totalReverse)} tone="signal" />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground shadow-sm">
          Aucun reversement à suivre. Marque des factures comme « payées » dans Facturation pour voir ce que tu dois à chaque créateur.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.creator} className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-[11px] font-semibold text-muted-foreground">
                    {initials(r.creator)}
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-foreground">{titleCase(r.creator)}</div>
                    <div className="text-[11px] text-faint">Commission agence {r.rate}%</div>
                  </div>
                </div>
                {r.reste > 0.5 ? (
                  <div className="rounded-full bg-amber/15 px-3 py-1 text-[12px] font-bold text-amber">Reste {formatEuro(r.reste)}</div>
                ) : (
                  <div className="rounded-full bg-signal/15 px-3 py-1 text-[12px] font-bold text-signaltext">À jour ✓</div>
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Encaissé" value={formatEuro(r.encaisse)} />
                <Metric label={`Commission (${r.rate}%)`} value={formatEuro(r.commission)} />
                <Metric label="Dû au créateur" value={formatEuro(r.du)} />
                <Metric label="Déjà reversé" value={formatEuro(r.reverse)} />
              </div>

              {r.payouts.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {r.payouts.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 rounded-lg bg-panel px-3 py-2 text-xs">
                      <Check className="h-3.5 w-3.5 shrink-0 text-signaltext" />
                      <span className="font-semibold text-foreground">{formatEuro(p.amount)}</span>
                      <span className="text-faint">{p.date}</span>
                      {p.note && <span className="truncate text-muted-foreground">· {p.note}</span>}
                      <button
                        type="button"
                        onClick={() => setPendingDel({ message: `Supprimer ce paiement de ${formatEuro(p.amount)} ?`, run: () => removePayout(r.creator, p.id) })}
                        className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-rose-500"
                        title="Supprimer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {openFor === r.creator ? (
                <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-border bg-panel p-3">
                  <label className="flex min-w-0 flex-1 flex-col gap-1 sm:min-w-[110px]">
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Montant (€)</span>
                    <input type="number" value={amt} onChange={(e) => setAmt(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
                  </label>
                  <label className="flex min-w-0 flex-1 flex-col gap-1 sm:min-w-[130px]">
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Date</span>
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
                  </label>
                  <label className="flex min-w-0 flex-[2] flex-col gap-1 sm:min-w-[150px]">
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">Note (optionnel)</span>
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Virement, espèces…" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
                  </label>
                  <button type="button" onClick={() => submitPayout(r.creator)} className="h-[38px] shrink-0 rounded-lg bg-primary px-4 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">
                    Enregistrer
                  </button>
                  <button type="button" onClick={() => setOpenFor(null)} className="h-[38px] shrink-0 rounded-lg border border-border px-3 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover">
                    Annuler
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => openAdd(r.creator, r.reste)}
                  className="mt-3 flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-semibold text-primary transition-colors hover:bg-rowhover"
                >
                  <Plus className="h-3.5 w-3.5" /> Enregistrer un paiement
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {pendingDel && (
        <ConfirmDialog
          title="Supprimer le paiement"
          message={pendingDel.message}
          confirmLabel="Supprimer"
          danger
          onCancel={() => setPendingDel(null)}
          onConfirm={() => {
            pendingDel.run();
            setPendingDel(null);
          }}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: "amber" | "primary" | "signal" }) {
  const toneCls = tone === "amber" ? "text-amber" : tone === "signal" ? "text-signaltext" : "text-primary";
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-faint">{label}</div>
      <div className={"mt-1.5 text-xl font-bold tracking-tight " + toneCls}>{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-panel p-3">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-1 truncate text-sm font-bold tracking-tight text-foreground">{value}</div>
    </div>
  );
}
