import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAppState, mergeAppStateKey, formatEuro, type AppState } from "@/lib/appState";
import { useCreators } from "@/lib/useCreators";
import { useIsFounder } from "@/lib/useFounder";
import { useLiveKey } from "@/lib/useLive";
import { commissionMap, DEFAULT_COMMISSION, rateFor } from "@/lib/commission";
import { billingFor, cashModeFor, collabTake, invoiceLine, mandatesFrom, readSettings, socialRate, type Billing, type CashMode, type ComptaDetail, type ComptaInvoice } from "@/lib/compta";
import { collabIdMissing } from "@/lib/collabLinks";
import { HelpTip } from "@/components/ui/help-tip";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * « Ce que je prends » sur une collab (fiche collab, fondateurs seulement) : qui encaisse
 * (l'agence ou le créateur), la commission HT, les cotisations URSSAF et le net. Le bouton
 * « Créer la facture » de la fiche prépare la bonne facture selon ce choix (src/views/Collabs.tsx).
 * Calculs : src/lib/compta.ts (mêmes totaux que Facturation et Reversements).
 */
export function CollabTakeCard({ collab }: { collab: { id: string; brand: string; creator: string | null; cachet: string | null } }) {
  const founder = useIsFounder() === true;
  const live = useLiveKey();
  const creators = useCreators();
  const { data: app } = useAppState<AppState>();
  const [invoices, setInvoices] = useState<ComptaInvoice[]>([]);
  // Valeur enregistrée pour la collab : « agence », « mandat » (agence encaisse, facture au nom du créateur) ou « createur ».
  const [localSet, setLocalSet] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!founder) return;
    let alive = true;
    void supabase
      .from("invoices")
      .select("id,amount,status,creator,collab_id,date")
      .eq("collab_id", collab.id)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error && !collabIdMissing(error)) return; // erreur réseau : on garde l'affichage
        setInvoices((data as ComptaInvoice[]) ?? []);
      });
    return () => {
      alive = false;
    };
  }, [founder, collab.id, live]);

  const rawSettings = app?.comptaSettings;
  const settings = useMemo(() => readSettings(rawSettings), [rawSettings]);
  const stored = (app?.collabCashMode as Record<string, string>) ?? {};
  const modes = localSet ? { ...stored, [collab.id]: localSet } : stored;
  const mode = cashModeFor(collab.id, collab.creator, modes, mandatesFrom(app?.contractHistory));
  const billing = billingFor(collab.id, modes, settings);
  const rate = rateFor(collab.creator, commissionMap(creators), (app?.creatorCommission as Record<string, number>) ?? {}, DEFAULT_COMMISSION);
  const take = useMemo(() => {
    const details = (app?.invoiceDetails as Record<string, ComptaDetail>) ?? {};
    const lines = invoices.map((iv) => invoiceLine(iv, details[iv.id], rate, mode, settings, billing));
    return collabTake(collab, lines, rate, mode, settings);
  }, [app, invoices, rate, mode, billing, settings, collab]);

  if (!founder) return null;

  const save = async (value: string) => {
    if (saving || modes[collab.id] === value) return;
    setSaving(true);
    setLocalSet(value);
    const ok = await mergeAppStateKey("collabCashMode", { [collab.id]: value });
    setSaving(false);
    if (!ok) {
      setLocalSet(null);
      toast("Erreur, réessaie");
    }
  };
  // L'agence encaisse : garde le « au nom de » actuel ; le créateur encaisse : la question ne se pose pas.
  const setMode = (next: CashMode) => void save(next === "createur" ? "createur" : billing === "mandat" ? "mandat" : "agence");
  const setBilling = (next: Billing) => void save(next === "mandat" ? "mandat" : "agence");

  const status = take.received ? "Encaissé" : take.commissionToBill ? "Commission à facturer" : "À recevoir";
  const seg = (on: boolean) =>
    cn("h-9 flex-1 rounded-full px-3 text-[13px] font-medium transition-colors", on ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground");
  const pct = (n: number) => `${String(Math.round(n * 10) / 10).replace(".", ",")} %`;

  return (
    <div className="rounded-[20px] bg-panel p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[17px] font-semibold text-foreground">
          Ce que je prends
          <HelpTip title="Ce que je prends">
            <p>Ta commission HT sur cette collab, les cotisations URSSAF de la micro-entreprise ({pct(socialRate(settings))}, réglage de la page Compta) et ce qu'il te reste.</p>
            <p>« Agence encaisse » : la marque paie l'agence, qui reverse la part du créateur. « Créateur encaisse » : la marque paie le créateur, et « Créer la facture » prépare la facture de ta commission au créateur.</p>
            <p>Quand l'agence encaisse, la facture à la marque est faite au nom de l'agence (tout le HT compte dans ton chiffre d'affaires) ou au nom du créateur, en mandat (seule ta commission compte, la facture porte son nom et la mention du mandat).</p>
            {take.estimated ? <p>Pas encore de facture reliée : estimation sur le cachet.</p> : null}
          </HelpTip>
        </h3>
        <span className={cn("text-[12px] font-medium", take.received ? "text-ok" : take.commissionToBill ? "text-wait" : "text-muted-foreground")}>{status}</span>
      </div>
      <div role="group" aria-label="Qui encaisse" className="mb-3 flex rounded-full bg-field p-0.5">
        <button type="button" aria-pressed={mode === "agence"} disabled={saving} onClick={() => setMode("agence")} className={seg(mode === "agence")}>Agence encaisse</button>
        <button type="button" aria-pressed={mode === "createur"} disabled={saving} onClick={() => setMode("createur")} className={seg(mode === "createur")}>Créateur encaisse</button>
      </div>
      {mode === "agence" && (
        <div className="mb-3 flex flex-col gap-1.5">
          <span className="px-1 text-[12px] text-muted-foreground">Facture à la marque</span>
          <div role="group" aria-label="Facture à la marque" className="flex rounded-full bg-field p-0.5">
            <button type="button" aria-pressed={billing === "agence"} disabled={saving} onClick={() => setBilling("agence")} className={seg(billing === "agence")}>Au nom de l'agence</button>
            <button type="button" aria-pressed={billing === "mandat"} disabled={saving} onClick={() => setBilling("mandat")} className={seg(billing === "mandat")}>Au nom du créateur</button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-border bg-border">
        {[
          { l: "Commission HT", v: formatEuro(take.commission), sub: take.estimated ? "estimée" : `${pct(rate)} du HT` },
          { l: "URSSAF", v: formatEuro(take.social), sub: pct(socialRate(settings)) },
          { l: "Net", v: formatEuro(take.net), sub: "pour l'agence", strong: true },
        ].map((x) => (
          <div key={x.l} className="min-w-0 bg-surface px-3 py-2.5">
            <div className="truncate text-[12px] text-muted-foreground">{x.l}</div>
            <div className={cn("mt-0.5 truncate text-[16px] tabular-nums text-foreground", x.strong ? "font-bold" : "font-semibold")}>{x.v}</div>
            <div className="truncate text-[11px] text-faint">{x.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
