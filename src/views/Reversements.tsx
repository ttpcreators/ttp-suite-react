import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Check, Wallet } from "@/components/icons";
import { StatsBento } from "@/components/ui/stats-bento";
import { supabase } from "@/lib/supabase";
import { useAppState, mergeAppStateKey, getAppState, invalidateAppState, parseAmount, formatEuro, type AppState } from "@/lib/appState";
import { useCreators } from "@/lib/useCreators";
import { commissionMap, DEFAULT_COMMISSION } from "@/lib/commission";
import { cents } from "@/lib/invoice";
import { mandatesFrom, noPayoutIds, type ComptaDetail } from "@/lib/compta";
import { collabIdMissing } from "@/lib/collabLinks";
import { owesMoney, overpaid, reversementRows, type Payout, type PayoutsMap, type RevInvoice, type RevRow } from "@/lib/reversements";
import { titleCase } from "@/lib/utils";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { toast } from "@/components/ui/toast";
import { DateInput } from "@/components/ui/date-range-picker";
import { fmtDayAny } from "@/lib/dates";

/**
 * Suivi des reversements créateurs : combien l'agence doit à chaque créateur
 * (CA encaissé − commission), combien a déjà été payé, et le reste dû.
 * Les paiements sont stockés dans le blob agence `creatorPayouts`.
 */

type Inv = RevInvoice & { collab_id?: string | null };
let _uid = 0;
const uid = () => `pay${Date.now().toString(36)}${(_uid += 1)}`;
// Date LOCALE (toISOString = UTC → la veille entre minuit et 2 h en France)
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  // Le blob live a changé (autre poste, realtime) : il redevient la source de vérité
  const livePayouts = app?.creatorPayouts;
  useEffect(() => {
    setLocalPayouts(null);
  }, [livePayouts]);

  useEffect(() => {
    let alive = true;
    // Collab de la facture (mode d'encaissement, page Compta) ; sans la colonne : sans elle.
    const load = async () => {
      const withLink = await supabase.from("invoices").select("id,amount,status,creator,collab_id");
      return withLink.error && collabIdMissing(withLink.error) ? supabase.from("invoices").select("id,amount,status,creator") : withLink;
    };
    void load()
      .then(({ data, error }) => {
        if (!alive) return;
        // Échec d'un rafraîchissement : on garde la liste déjà affichée (pas de vidage)
        if (error) {
          setError(true);
          return;
        }
        const next = (data as Inv[]) ?? [];
        setCache("revInvoices", next);
        setInvoices(next);
        setError(false); // un chargement réussi efface l'erreur précédente
      });
    return () => {
      alive = false;
    };
  }, [live]);

  // Calcul au centime, partagé avec Facturation et les gains du créateur (src/lib/reversements.ts).
  const rows: RevRow[] = useMemo(() => {
    if (!invoices) return [];
    const details = (app?.invoiceDetails as Record<string, ComptaDetail>) ?? {};
    return reversementRows({
      invoices,
      details,
      payouts: payoutsMap,
      rosterRates: commissionMap(creators),
      savedRates: commissions,
      defaultRate: DEFAULT_COMMISSION,
      // Marque qui paie le créateur, facture de commission : rien à reverser (page Compta).
      skip: noPayoutIds(invoices, details, (app?.collabCashMode as Record<string, string>) ?? {}, mandatesFrom(app?.contractHistory)),
    });
  }, [invoices, commissions, payoutsMap, creators, app]);

  const totalReste = cents(rows.reduce((s, r) => s + (owesMoney(r) ? r.reste : 0), 0));
  const totalDu = cents(rows.reduce((s, r) => s + r.du, 0));
  const totalReverse = cents(rows.reduce((s, r) => s + r.reverse, 0));

  // Relit FRAIS le blob et ne fusionne QUE les entrées modifiées (paiements = argent :
  // deux postes ne doivent jamais s'écraser). Renvoie le booléen d'écriture.
  const mutatePayouts = async (change: (fresh: PayoutsMap) => PayoutsMap): Promise<boolean> => {
    let ok = false;
    let next: PayoutsMap = {};
    try {
      invalidateAppState();
      const fresh = ((await getAppState())["creatorPayouts"] as PayoutsMap) ?? {};
      const part = change(fresh);
      next = { ...fresh, ...part };
      // N'envoie QUE les entrées de ce créateur (fusion côté base, sous verrou).
      ok = Object.keys(part).length > 0 && (await mergeAppStateKey("creatorPayouts", part));
    } catch {
      ok = false;
    }
    // État local appliqué SEULEMENT après écriture réussie (argent : pas d'affichage fantôme)
    if (ok) setLocalPayouts(next);
    else toast("Erreur, réessaie");
    return ok;
  };

  const [openFor, setOpenFor] = useState<string | null>(null);
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [pendingDel, setPendingDel] = useState<null | { message: string; run: () => void }>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // garde synchrone contre le double clic (pas de paiement en double)

  const openAdd = (creator: string, reste: number) => {
    setOpenFor(creator);
    setAmt(reste > 0 ? String(cents(reste)) : "");
    setDate(todayISO());
    setNote("");
  };
  const submitPayout = async (r: RevRow) => {
    if (busyRef.current) return;
    const n = cents(parseAmount(amt));
    if (!(n > 0)) {
      toast("Montant invalide");
      return;
    }
    const entry: Payout = { id: uid(), date: date || todayISO(), amount: n, note: note.trim() || undefined };
    busyRef.current = true;
    setBusy(true);
    try {
      const ok = await mutatePayouts((fresh) => ({ [r.writeKey]: [entry, ...(fresh[r.writeKey] ?? [])] }));
      // Échec : le formulaire reste ouvert (saisie conservée)
      if (ok) {
        setOpenFor(null);
        toast("Paiement enregistré ✓");
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const removePayout = async (r: RevRow, id: string) => {
    // Retire le versement de la graphie du nom qui le contient (relue fraîche).
    const ok = await mutatePayouts((fresh) =>
      Object.fromEntries(
        r.keys.filter((k) => (fresh[k] ?? []).some((p) => p.id === id)).map((k) => [k, (fresh[k] ?? []).filter((p) => p.id !== id)]),
      ),
    );
    if (ok) toast("Paiement supprimé");
  };

  // Erreur affichée seulement s'il n'y a rien à montrer (sinon on garde les données en place)
  if (error && !invoices)
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
      {rows.length > 0 && (() => {
        const nbAPayer = rows.filter(owesMoney).length;
        return (
          <StatsBento phoneStrip
            primary={{
              eyebrow: "Reste à reverser",
              value: formatEuro(totalReste),
              caption: `${nbAPayer} créateur${nbAPayer > 1 ? "s" : ""} à payer · ${formatEuro(totalDu)} dû au total.`,
            }}
            // Valeur cohérente avec l'intitulé et les barres (reste dû) ; le déjà reversé a sa propre case.
            bars={{ label: "Plus gros reste dû", value: formatEuro(Math.max(0, ...rows.map((r) => r.reste))), series: rows.map((r) => Math.max(0, r.reste)) }}
            small={{ value: String(nbAPayer), label: "À payer" }}
            accent={{ value: formatEuro(totalReverse), label: "Déjà reversé", icon: Wallet }}
          />
        );
      })()}

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
                  <CreatorAvatar
                    name={titleCase(r.creator)}
                    photoUrl={creators.find((c) => c.name.trim().toLowerCase() === r.creator.trim().toLowerCase())?.photo_url ?? null}
                    className="h-10 w-10 shrink-0 rounded-xl"
                  />
                  <div>
                    <div className="text-sm font-semibold text-foreground">{titleCase(r.creator)}</div>
                    <div className="text-[11px] text-faint">Commission TTP {r.rate} %</div>
                  </div>
                </div>
                {owesMoney(r) ? (
                  <div className="rounded-full bg-amber/15 px-3 py-1 text-[12px] font-bold text-amber">Reste {formatEuro(r.reste)}</div>
                ) : overpaid(r) ? (
                  // Versé plus que dû (facture supprimée ou repassée « en attente » après un virement).
                  <div className="rounded-full bg-amber/15 px-3 py-1 text-[12px] font-bold text-amber">Trop versé {formatEuro(-r.reste)}</div>
                ) : (
                  <div className="rounded-full bg-signal/15 px-3 py-1 text-[12px] font-bold text-signaltext">À jour ✓</div>
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Payé par la marque (HT)" value={formatEuro(r.ht)} />
                <Metric label={`Commission TTP (${r.rate} %)`} value={formatEuro(r.commission)} />
                <Metric label="Part créateur" value={formatEuro(r.du)} />
                <Metric label="Déjà reversé" value={formatEuro(r.reverse)} />
              </div>
              {/* Le calcul tombe juste : HT − commission = part créateur ; la TVA va à l'État. */}
              {r.encaisse - r.ht > 0.004 && (
                <p className="mt-2 text-[12px] text-muted-foreground">
                  Reçu {formatEuro(r.encaisse)} TTC = {formatEuro(r.ht)} HT + {formatEuro(r.encaisse - r.ht)} de TVA (pour l'État, pas pour le créateur).
                </p>
              )}

              {r.payouts.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {r.payouts.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 rounded-lg bg-panel px-3 py-2 text-xs">
                      <Check className="h-3.5 w-3.5 shrink-0 text-signaltext" />
                      <span className="font-semibold text-foreground">{formatEuro(p.amount)}</span>
                      <span className="text-faint">{fmtDayAny(p.date)}</span>
                      {p.note && <span className="truncate text-muted-foreground">· {p.note}</span>}
                      <button
                        type="button"
                        onClick={() => setPendingDel({ message: `Supprimer ce paiement de ${formatEuro(p.amount)} ?`, run: () => removePayout(r, p.id) })}
                        className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-dangertext"
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
                    <span className="text-[11px] font-medium text-muted-foreground">Montant (€)</span>
                    <input type="number" value={amt} onChange={(e) => setAmt(e.target.value)} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
                  </label>
                  <label className="flex min-w-0 flex-1 flex-col gap-1 sm:min-w-[130px]">
                    <span className="text-[11px] font-medium text-muted-foreground">Date</span>
                    <DateInput value={date} onChange={setDate} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
                  </label>
                  <label className="flex min-w-0 flex-[2] flex-col gap-1 sm:min-w-[150px]">
                    <span className="text-[11px] font-medium text-muted-foreground">Note (optionnel)</span>
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Virement, espèces…" className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
                  </label>
                  <button type="button" onClick={() => submitPayout(r)} disabled={busy} className="h-[38px] shrink-0 rounded-full bg-primary px-4 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60">
                    {busy ? "Enregistrement…" : "Enregistrer"}
                  </button>
                  <button type="button" onClick={() => setOpenFor(null)} className="h-[38px] shrink-0 rounded-lg border border-border px-3 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover">
                    Annuler
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => openAdd(r.creator, r.reste)}
                  className="mt-3 flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-2 text-[12px] font-semibold text-primary transition-colors hover:bg-rowhover"
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
          title="Supprimer définitivement"
          message={pendingDel.message}
          confirmLabel="Supprimer définitivement"
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-panel p-3">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-bold tracking-tight text-foreground">{value}</div>
    </div>
  );
}
