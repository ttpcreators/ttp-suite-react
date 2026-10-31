import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Settings2, X } from "@/components/icons";
import { supabase } from "@/lib/supabase";
import { useAppState, saveAppStateKey, mergeAppStateKey, formatEuro, type AppState } from "@/lib/appState";
import { useCreators } from "@/lib/useCreators";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";
import { commissionMap, DEFAULT_COMMISSION, rateFor } from "@/lib/commission";
import { collabIdMissing, guessCollabId } from "@/lib/collabLinks";
import {
  billingFor, cashModeFor, collabTake, comptePro, invoiceLine, mandatesFrom, readSettings, socialRate, thresholdAlerts,
  type Billing, type CashMode, type ComptaDetail, type ComptaInvoice, type ComptaSettings, type Payout,
} from "@/lib/compta";
import { ACTIVITIES, RATE_SOURCES, RATES_CHECKED, type Activity } from "@/lib/comptaRates";
import { PageHeaderRow } from "@/components/ui/page-header";
import { HelpTip } from "@/components/ui/help-tip";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { Overlay } from "@/components/mobile/ios-sheet";
import { toast } from "@/components/ui/toast";
import { fmtDay } from "@/lib/dates";
import { cn, titleCase } from "@/lib/utils";

/**
 * Compta de l'agence (micro-entreprise), fondateurs seulement : ce qu'il devrait y avoir sur
 * le compte pro, ce qu'il faut mettre de côté (créateurs, URSSAF, TVA), ce qui est vraiment
 * disponible, et ce que l'agence prend sur chaque collab. Calculs : src/lib/compta.ts ;
 * taux et seuils officiels : src/lib/comptaRates.ts (sources dans docs/compta-micro.md).
 */

type CollabRow = { id: string; brand: string; creator: string | null; cachet: string | null; status: string };

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const pct = (n: number) => `${String(Math.round(n * 100) / 100).replace(".", ",")} %`;

async function loadInvoices(): Promise<ComptaInvoice[] | null> {
  const withLink = await supabase.from("invoices").select("id,amount,status,creator,collab_id,date,party");
  if (!withLink.error) return (withLink.data as ComptaInvoice[]) ?? [];
  if (!collabIdMissing(withLink.error)) return null;
  const plain = await supabase.from("invoices").select("id,amount,status,creator,date,party");
  return plain.error ? null : ((plain.data as ComptaInvoice[]) ?? []);
}

export function Compta() {
  const live = useLiveKey();
  const creators = useCreators();
  const { data: app } = useAppState<AppState>();
  const [invoices, setInvoices] = useState<ComptaInvoice[] | null>(() => getCache<ComptaInvoice[]>("comptaInvoices"));
  const [collabs, setCollabs] = useState<CollabRow[]>(() => getCache<CollabRow[]>("comptaCollabs") ?? []);
  const [error, setError] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Qui encaisse, changé ici ligne par ligne (même réglage que la fiche collab : blob `collabCashMode`).
  // `local` : choix déjà enregistrés mais pas encore relus, pour que les totaux suivent tout de suite.
  const [openId, setOpenId] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([loadInvoices(), supabase.from("collabs").select("id,brand,creator,cachet,status")]).then(([inv, col]) => {
      if (!alive) return;
      if (inv) {
        setInvoices(inv);
        setCache("comptaInvoices", inv);
        setError(false);
      } else setError(true);
      if (!col.error) {
        const rows = ((col.data as CollabRow[]) ?? []).filter((c) => c.status !== "perdue");
        setCollabs(rows);
        setCache("comptaCollabs", rows);
      }
    });
    return () => {
      alive = false;
    };
  }, [live]);

  const rawSettings = app?.comptaSettings;
  const settings = useMemo(() => readSettings(rawSettings), [rawSettings]);
  const computed = useMemo(() => {
    if (!invoices) return null;
    const details = (app?.invoiceDetails as Record<string, ComptaDetail>) ?? {};
    const modes = { ...((app?.collabCashMode as Record<string, string>) ?? {}), ...local };
    const mandates = mandatesFrom(app?.contractHistory);
    const roster = commissionMap(creators);
    const saved = (app?.creatorCommission as Record<string, number>) ?? {};
    const rateOf = (name: string | null) => rateFor(name, roster, saved, DEFAULT_COMMISSION);
    // Facture de commission : son créateur est celui de sa collab (pour le mode et le taux).
    const collabById = new Map(collabs.map((c) => [c.id, c]));
    // Anciennes factures sans collab enregistrée : reliées à LA collab de même marque et même
    // créateur (sinon la commission était estimée, et la facture payée restait « à recevoir »).
    const lines = invoices
      .map((iv) => (iv.collab_id ? iv : { ...iv, collab_id: guessCollabId("invoices", iv, collabs) }))
      .filter((iv) => iv.status !== "brouillon" && iv.status !== "annulee")
      .map((iv) => {
        const who = iv.creator ?? collabById.get(iv.collab_id ?? "")?.creator ?? null;
        return invoiceLine(iv, details[iv.id], rateOf(who), cashModeFor(iv.collab_id, who, modes, mandates), settings, billingFor(iv.collab_id, modes, settings));
      });
    const box = comptePro(lines, (app?.creatorPayouts as Record<string, Payout[]>) ?? {}, settings, todayISO());
    const takes = collabs
      .map((c) => ({ c, billing: billingFor(c.id, modes, settings), t: collabTake(c, lines, rateOf(c.creator), cashModeFor(c.id, c.creator, modes, mandates), settings) }))
      .filter((x) => x.t.commission > 0)
      .sort((a, b) => Number(a.t.received) - Number(b.t.received) || b.t.commission - a.t.commission);
    const vatOnInvoices = settings.vatRegime === "franchise" && lines.some((l) => l.kind === "marque" && l.tva > 0 && l.mode === "agence");
    return { box, takes, alerts: thresholdAlerts(box.caYear, settings), vatOnInvoices, modes };
  }, [invoices, collabs, app, creators, settings, local]);

  if (!computed) {
    return error ? (
      <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted-foreground">Impossible de charger les factures.</div>
    ) : (
      <AnimatedBadge status="loading" size="sm">Chargement…</AnimatedBadge>
    );
  }
  const { box, takes, alerts, vatOnInvoices, modes } = computed;

  const saveMode = async (collabId: string, value: string) => {
    if (savingId || modes[collabId] === value) return;
    setSavingId(collabId);
    setLocal((m) => ({ ...m, [collabId]: value }));
    const ok = await mergeAppStateKey("collabCashMode", { [collabId]: value });
    setSavingId(null);
    if (!ok) {
      setLocal(({ [collabId]: _drop, ...rest }) => rest);
      toast("Erreur, réessaie");
    }
  };
  // L'agence encaisse : garde le « au nom de » actuel ; le créateur encaisse : la question ne se pose pas.
  const setMode = (id: string, billing: Billing, next: CashMode) => void saveMode(id, next === "createur" ? "createur" : billing === "mandat" ? "mandat" : "agence");
  const setBilling = (id: string, next: Billing) => void saveMode(id, next === "mandat" ? "mandat" : "agence");
  const seg = (on: boolean) =>
    cn("h-9 flex-1 rounded-full px-3 text-[13px] font-medium transition-colors", on ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground");
  const aside = box.aside.createurs + box.aside.urssaf + box.aside.tva;

  return (
    <div className="flex flex-col gap-5">
      <PageHeaderRow>
        <span className="text-[13px] text-muted-foreground">
          CA encaissé {new Date().getFullYear()} : <b className="font-semibold text-foreground tabular-nums">{formatEuro(box.caYear)}</b>
        </span>
        <button type="button" onClick={() => setSettingsOpen(true)} className="flex h-10 items-center gap-1.5 rounded-full bg-field px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-rowhover">
          <Settings2 className="h-4 w-4" /> Régler
        </button>
      </PageHeaderRow>

      {!settings.saved && (
        <div className="rounded-2xl border border-dashed border-border px-4 py-3 text-[13px] text-muted-foreground">
          Réglages par défaut : {ACTIVITIES[settings.activity].label}, {pct(socialRate(settings))} de cotisations, franchise de TVA. À confirmer avec « Régler ».
        </div>
      )}
      {[...alerts, ...(vatOnInvoices ? [{ level: "wait" as const, text: "Des factures portent de la TVA alors que le réglage dit franchise : vérifie le régime de TVA." }] : [])].map((a) => (
        <div key={a.text} className={cn("rounded-2xl px-4 py-3 text-[13px]", a.level === "late" ? "bg-dangersoft text-dangertext" : a.level === "wait" ? "bg-wait-soft text-wait" : "bg-panel text-muted-foreground")}>
          {a.text}
        </div>
      ))}

      {/* Compte pro */}
      <section className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-3">
        <div className="bg-surface px-5 py-4">
          <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            Sur le compte pro
            <HelpTip title="Sur le compte pro">
              <p>Ce qui est arrivé sur le compte de l'agence ({formatEuro(box.encaisse)} : factures payées à l'agence et commissions reçues) moins ce qui a été versé aux créateurs ({formatEuro(box.verse)}).</p>
              <p>C'est le solde théorique : les autres dépenses et rentrées de l'agence n'y sont pas. Les factures comptent à leur date d'émission (l'app ne connaît pas le jour exact du virement).</p>
            </HelpTip>
          </div>
          <div className="mt-1.5 text-[28px] font-semibold leading-none tracking-tight tabular-nums text-foreground">{formatEuro(box.solde)}</div>
        </div>
        <div className="bg-surface px-5 py-4">
          <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            À mettre de côté
            <HelpTip title="À mettre de côté">
              <p>Créateurs : leur part des factures payées, pas encore versée.</p>
              <p>URSSAF : {pct(socialRate(settings))} du chiffre d'affaires des périodes pas encore déclarées ({box.openPeriods.join(", ") || "aucune"}).</p>
              <p>TVA : celle encaissée sur ces mêmes périodes, due à l'État.</p>
            </HelpTip>
          </div>
          <div className="mt-1.5 text-[28px] font-semibold leading-none tracking-tight tabular-nums text-foreground">{formatEuro(aside)}</div>
          <div className="mt-2 flex flex-col gap-0.5 text-[12px] tabular-nums text-muted-foreground">
            <span>Créateurs {formatEuro(box.aside.createurs)}</span>
            <span>URSSAF {formatEuro(box.aside.urssaf)}</span>
            {box.aside.tva > 0 && <span>TVA {formatEuro(box.aside.tva)}</span>}
          </div>
        </div>
        <div className="bg-surface px-5 py-4">
          <div className="text-[13px] text-muted-foreground">Vraiment disponible</div>
          <div className={cn("mt-1.5 text-[28px] font-bold leading-none tracking-tight tabular-nums", box.dispo < 0 ? "text-dangertext" : "text-foreground")}>{formatEuro(box.dispo)}</div>
        </div>
      </section>

      {/* Ce que je prends */}
      <section className="flex flex-col gap-2">
        <h3 className="flex items-center gap-1.5 px-1 text-[15px] font-semibold text-foreground">
          Ce que je prends
          <HelpTip title="Ce que je prends">
            <p>Par collab : ta commission HT, les cotisations URSSAF ({pct(socialRate(settings))}) et le net. Sans facture reliée, la commission est estimée sur le cachet.</p>
            <p>Touche une ligne pour changer qui encaisse (l'agence ou le créateur) et au nom de qui la marque est facturée. Le même choix se règle aussi dans la fiche de la collab.</p>
          </HelpTip>
        </h3>
        {takes.length === 0 ? (
          <div className="rounded-2xl bg-surface px-4 py-6 text-center text-[13px] text-muted-foreground">Aucune</div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            {takes.map(({ c, t, billing }) => {
              const open = openId === c.id;
              const saving = savingId === c.id;
              return (
                <div key={c.id} className="border-b border-border last:border-0">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : c.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-rowhover"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium text-foreground">{c.brand}{c.creator ? ` × ${titleCase(c.creator).split(" ")[0]}` : ""}</div>
                      <div className="truncate text-[12px] text-muted-foreground">
                        {t.mode === "agence" ? (billing === "mandat" ? "Agence encaisse, au nom du créateur" : "Agence encaisse") : "Créateur encaisse"} · {t.received ? "Encaissé" : t.commissionToBill ? "Commission à facturer" : "À recevoir"}{t.estimated ? " · estimé" : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      <div className="text-[14px] font-semibold text-foreground">{formatEuro(t.net)}</div>
                      <div className="text-[11px] text-faint">{formatEuro(t.commission)} − {formatEuro(t.social)}</div>
                    </div>
                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-faint transition-transform", open && "rotate-180")} />
                  </button>
                  {open && (
                    <div className="flex flex-col gap-2 px-4 pb-4">
                      <div role="group" aria-label="Qui encaisse" className="flex rounded-full bg-field p-0.5">
                        <button type="button" aria-pressed={t.mode === "agence"} disabled={saving} onClick={() => setMode(c.id, billing, "agence")} className={seg(t.mode === "agence")}>Agence encaisse</button>
                        <button type="button" aria-pressed={t.mode === "createur"} disabled={saving} onClick={() => setMode(c.id, billing, "createur")} className={seg(t.mode === "createur")}>Créateur encaisse</button>
                      </div>
                      {t.mode === "agence" && (
                        <div role="group" aria-label="Facture à la marque" className="flex rounded-full bg-field p-0.5">
                          <button type="button" aria-pressed={billing === "agence"} disabled={saving} onClick={() => setBilling(c.id, "agence")} className={seg(billing === "agence")}>Au nom de l'agence</button>
                          <button type="button" aria-pressed={billing === "mandat"} disabled={saving} onClick={() => setBilling(c.id, "mandat")} className={seg(billing === "mandat")}>Au nom du créateur</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {settingsOpen && <SettingsSheet settings={settings} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[12px] font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function SettingsSheet({ settings, onClose }: { settings: ComptaSettings; onClose: () => void }) {
  const [s, setS] = useState<ComptaSettings>(settings);
  const [rateText, setRateText] = useState(String(settings.urssafRate).replace(".", ","));
  const [busy, setBusy] = useState(false);
  const pickActivity = (a: Activity) => {
    const base = ACTIVITIES[a];
    setS((x) => ({ ...x, activity: a, urssafRate: base.urssaf, cfpRate: base.cfp, vlRate: base.vl }));
    setRateText(String(base.urssaf).replace(".", ","));
  };
  const save = async () => {
    const rate = Number(rateText.replace(",", "."));
    if (!(rate > 0 && rate < 100)) return toast("Taux URSSAF invalide");
    setBusy(true);
    const ok = await saveAppStateKey("comptaSettings", { ...s, urssafRate: rate, saved: true });
    setBusy(false);
    if (!ok) return toast("Erreur, réessaie");
    toast("Réglages enregistrés ✓");
    onClose();
  };
  const seg = (on: boolean) => cn("min-h-11 flex-1 rounded-full px-3 text-[13px] font-medium transition-colors", on ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground");
  return (
    <Overlay className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClose={onClose} label="Réglages de la compta">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-[24px] bg-surface p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-xl sm:rounded-[24px]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[16px] font-semibold text-foreground">Réglages de la compta</div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="grid h-11 w-11 place-items-center rounded-full bg-field text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-4">
          <Row label="Activité déclarée à l'URSSAF">
            <div role="group" aria-label="Activité" className="flex flex-col gap-1 rounded-[20px] bg-field p-1 sm:flex-row">
              {(Object.keys(ACTIVITIES) as Activity[]).map((a) => (
                <button key={a} type="button" aria-pressed={s.activity === a} onClick={() => pickActivity(a)} className={seg(s.activity === a)}>
                  {ACTIVITIES[a].label} · {pct(ACTIVITIES[a].urssaf)}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Taux de cotisations (%)">
            <input value={rateText} onChange={(e) => setRateText(e.target.value)} inputMode="decimal" className="h-11 rounded-xl border border-border bg-field px-3 text-[16px] tabular-nums text-foreground outline-none focus:border-primary" />
            <span className="text-[11px] text-faint">+ formation professionnelle {pct(s.cfpRate)}</span>
          </Row>
          <Row label="Versement libératoire de l'impôt">
            <div role="group" className="flex rounded-full bg-field p-0.5">
              <button type="button" aria-pressed={!s.vl} onClick={() => setS((x) => ({ ...x, vl: false }))} className={seg(!s.vl)}>Non</button>
              <button type="button" aria-pressed={s.vl} onClick={() => setS((x) => ({ ...x, vl: true }))} className={seg(s.vl)}>Oui · {pct(s.vlRate)}</button>
            </div>
          </Row>
          <Row label="TVA">
            <div role="group" className="flex rounded-full bg-field p-0.5">
              <button type="button" aria-pressed={s.vatRegime === "franchise"} onClick={() => setS((x) => ({ ...x, vatRegime: "franchise" }))} className={seg(s.vatRegime === "franchise")}>Franchise (293 B)</button>
              <button type="button" aria-pressed={s.vatRegime === "assujetti"} onClick={() => setS((x) => ({ ...x, vatRegime: "assujetti" }))} className={seg(s.vatRegime === "assujetti")}>TVA {s.vatRate} %</button>
            </div>
          </Row>
          <Row label="Déclaration URSSAF">
            <div role="group" className="flex rounded-full bg-field p-0.5">
              <button type="button" aria-pressed={s.declaration === "mois"} onClick={() => setS((x) => ({ ...x, declaration: "mois" }))} className={seg(s.declaration === "mois")}>Chaque mois</button>
              <button type="button" aria-pressed={s.declaration === "trimestre"} onClick={() => setS((x) => ({ ...x, declaration: "trimestre" }))} className={seg(s.declaration === "trimestre")}>Chaque trimestre</button>
            </div>
          </Row>
          <Row label="Factures aux marques, par défaut">
            <div role="group" className="flex flex-col gap-1 rounded-[20px] bg-field p-1 sm:flex-row">
              <button type="button" aria-pressed={s.facturation === "agence"} onClick={() => setS((x) => ({ ...x, facturation: "agence" }))} className={seg(s.facturation === "agence")}>Au nom de l'agence</button>
              <button type="button" aria-pressed={s.facturation === "mandat"} onClick={() => setS((x) => ({ ...x, facturation: "mandat" }))} className={seg(s.facturation === "mandat")}>Au nom du créateur</button>
            </div>
            <span className="text-[11px] leading-snug text-faint">Au nom de l'agence : tout le HT compte dans ton chiffre d'affaires. Au nom du créateur (mandat) : seulement ta commission. Ce choix se change aussi collab par collab (fiche collab) et facture par facture.</span>
          </Row>
          <div className="rounded-xl bg-panel px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
            Taux officiels vérifiés le {fmtDay(RATES_CHECKED)} :
            {RATE_SOURCES.map((src) => (
              <a key={src.url} href={src.url} target="_blank" rel="noreferrer" className="block underline underline-offset-2 hover:text-foreground">{src.label}</a>
            ))}
          </div>
          <button type="button" onClick={() => void save()} disabled={busy} className="h-12 rounded-full bg-primary text-[15px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">Enregistrer</button>
        </div>
      </div>
    </Overlay>
  );
}
