import { useState, type ReactNode } from "react";
import { Check, Minus, Plus, RotateCcw, TriangleAlert } from "@/components/icons";
import { formatEuro } from "@/lib/money";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { HelpTip } from "@/components/ui/help-tip";
import {
  COEF_MAX, COEF_MIN, DEFAULT_TARIF_GRID, TARIF_FORMATS, gridDiff, type Alert, type TarifGrid, type TarifResult,
} from "@/lib/pricingTTP";
import { saveTarifGrid } from "@/lib/pricingTTPDb";

/*
 * Page Tarifs, mode Influence : briques de la méthode TARIF (calcul : src/lib/pricingTTP.ts).
 * Tailles téléphone : cibles de 44 px, champs en 16 px (pas de zoom iOS).
 */

export const T_INPUT = "h-9 w-full min-w-0 rounded-[10px] border border-border bg-surface px-2.5 text-[13px] tabular-nums outline-none focus:border-primary max-md:h-11 max-md:text-[16px]";
const num1 = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

/** Nombre entier avec « − » et « + » (0 permis), et son unité (« mois »). */
export function Stepper({ value, onChange, min = 0, max = 99, unit, label }: { value: number; onChange: (n: number) => void; min?: number; max?: number; unit?: (n: number) => string; label: string }) {
  const b = "grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-40 max-md:h-11 max-md:w-11";
  return (
    <div className="flex items-center gap-1 rounded-full bg-surface p-0.5" role="group" aria-label={label}>
      <button type="button" className={b} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} aria-label={`${label} : un de moins`}>
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="min-w-[4.5rem] text-center text-[13px] font-semibold tabular-nums text-foreground">{unit ? unit(value) : value}</span>
      <button type="button" className={b} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} aria-label={`${label} : un de plus`}>
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Case à cocher sur toute la ligne (44 px au téléphone). */
export function CheckRow({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("flex min-h-9 cursor-pointer items-center gap-2.5 text-[13px] text-foreground max-md:min-h-11", disabled && "cursor-not-allowed opacity-50")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 shrink-0 accent-[var(--primary)] max-md:h-5 max-md:w-5" />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

export type Justifs = { audience: boolean; expertise: boolean; engagement: boolean };

/** Coefficient qualité : curseur 0,8 à 1,5 et les trois justifications. */
export function QualityBlock({ coef, suggested, manual, justifs, onCoef, onJustif, onReset, hints }: {
  coef: number;
  suggested: number;
  manual: boolean;
  justifs: Justifs;
  onCoef: (c: number) => void;
  onJustif: (k: keyof Justifs, v: boolean) => void;
  onReset: () => void;
  hints: { audience: string; expertise: string };
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
          Coefficient qualité
          <HelpTip title="Coefficient qualité">
            <p>Multiplie le prix média. 1 = neutre, +0,15 par justification cochée, entre 0,8 et 1,5.</p>
            <p>Le curseur permet d'ajuster à la main. Les cases sont pré-cochées depuis le media kit et la crédibilité : à vérifier.</p>
          </HelpTip>
        </span>
        <span className="text-[15px] font-semibold tabular-nums text-foreground">× {num1(coef)}</span>
      </div>
      <input
        type="range"
        min={COEF_MIN}
        max={COEF_MAX}
        step={0.05}
        value={coef}
        onChange={(e) => onCoef(parseFloat(e.target.value))}
        aria-label="Coefficient qualité"
        className="mt-2 h-9 w-full accent-[var(--primary)] max-md:h-11"
      />
      <div className="flex justify-between text-[11px] tabular-nums text-faint">
        <span>{num1(COEF_MIN)}</span>
        {manual ? (
          <button type="button" onClick={onReset} className="flex items-center gap-1 font-medium text-primary max-md:min-h-11">
            <RotateCcw className="h-3 w-3" /> Suggéré {num1(suggested)}
          </button>
        ) : (
          <span>Suggéré {num1(suggested)}</span>
        )}
        <span>{num1(COEF_MAX)}</span>
      </div>
      <div className="mt-2 flex flex-col">
        <CheckRow checked={justifs.audience} onChange={(v) => onJustif("audience", v)}>
          Audience cœur de cible <span className="text-faint">{hints.audience}</span>
        </CheckRow>
        <CheckRow checked={justifs.expertise} onChange={(v) => onJustif("expertise", v)}>
          Expertise crédible <span className="text-faint">{hints.expertise}</span>
        </CheckRow>
        <CheckRow checked={justifs.engagement} onChange={(v) => onJustif("engagement", v)}>
          Engagement fort sur les vues
        </CheckRow>
      </div>
    </div>
  );
}

const Verify = () => <span className="ml-1.5 rounded-[5px] bg-field px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">À vérifier</span>;

/** Données manquantes, chiffres à vérifier et garde-fous : en tête du résultat. */
export function TarifWarnings({ missing, verify, alerts, notes }: { missing: string[]; verify: string[]; alerts: Alert[]; notes: string[] }) {
  if (!missing.length && !verify.length && !alerts.length && !notes.length) return null;
  return (
    <div className="mt-3 flex flex-col gap-2 text-[12px] leading-snug">
      {alerts.map((a, i) => (
        <div key={i} className="flex gap-2 rounded-[10px] bg-wait-soft px-2.5 py-2 font-medium text-wait">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" /> {a.text}
        </div>
      ))}
      {missing.length > 0 && (
        <div className="rounded-[10px] bg-field px-2.5 py-2">
          <div className="font-semibold text-foreground">Données manquantes</div>
          <div className="mt-0.5 text-muted-foreground">{missing.join(" · ")}</div>
        </div>
      )}
      {verify.length > 0 && (
        <div className="rounded-[10px] bg-field px-2.5 py-2">
          <div className="font-semibold text-foreground">À vérifier</div>
          <div className="mt-0.5 text-muted-foreground">{verify.join(" · ")}</div>
        </div>
      )}
      {notes.map((n, i) => (
        <div key={i} className="px-0.5 text-muted-foreground">{n}</div>
      ))}
    </div>
  );
}

/** Ancrage, cible, plancher : le haut de la carte de prix. */
export function TarifPrice({ r }: { r: TarifResult }) {
  return (
    <>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-[30px] font-semibold leading-tight tracking-tight tabular-nums text-foreground xl:text-[36px]">{formatEuro(r.target)} HT</span>
        <Verify />
      </div>
      <div className="mt-1 text-[13px] text-muted-foreground">
        Cible{r.complete ? "" : ", livrables chiffrés seulement"} · Ancrage <span className="font-semibold tabular-nums text-foreground">{formatEuro(r.anchor)}</span> · Plancher{" "}
        <span className="font-semibold tabular-nums text-foreground">{formatEuro(r.floor)}</span>
      </div>
    </>
  );
}

/** Détail : tableau par livrable, lignes séparées, CPM effectif, paliers, répartition. */
export function TarifDetail({ r, split, commissionPct }: { r: TarifResult; split: { agency: number; creator: number }; commissionPct: number }) {
  const row = "flex justify-between gap-3";
  return (
    <div className="mt-4 divide-y divide-border border-t border-border text-[13px]">
      {r.lines.map((l, i) => (
        <div key={i} className="py-2">
          <div className={row}>
            <span className="min-w-0 truncate text-muted-foreground">{l.label} × {l.qty}</span>
            <span className="shrink-0 font-medium tabular-nums text-foreground">{l.priced ? formatEuro(l.total) : "—"}</span>
          </div>
          <div className="mt-0.5 text-[11px] leading-snug text-faint">
            {l.priced
              ? [
                  `${l.views.toLocaleString("fr-FR")} vues`,
                  `CPM ${formatEuro(l.cpm)}`,
                  `coef ${num1(l.coef)}`,
                  `base ${formatEuro(l.unitBase)}${l.qty > 1 ? ` × ${l.qty}` : ""}${l.floored ? " (plancher)" : ""}`,
                  ...(l.majorations ? [`+${formatEuro(l.majorations)}`] : []),
                  ...(l.remises ? [`−${formatEuro(l.remises)}`] : []),
                ].join(" · ")
              : "Pas de prix : vues manquantes"}
          </div>
        </div>
      ))}
      {r.majorations.map((m) => (
        <div key={m.id} className={cn(row, "py-2")}>
          <span className="min-w-0 truncate text-muted-foreground">{m.label}</span>
          <span className="shrink-0 tabular-nums text-foreground">+{m.pct} %</span>
        </div>
      ))}
      {r.remises.map((m) => (
        <div key={m.id} className={cn(row, "py-2")}>
          <span className="min-w-0 truncate text-muted-foreground">{m.label}</span>
          <span className="shrink-0 tabular-nums text-foreground">−{m.pct} %</span>
        </div>
      ))}
      {r.retouches.amount > 0 && (
        <div className={cn(row, "py-2")}>
          <span className="min-w-0 truncate text-muted-foreground">Retouches en plus × {r.retouches.qty}</span>
          <span className="shrink-0 font-medium tabular-nums text-foreground">{formatEuro(r.retouches.amount)}</span>
        </div>
      )}
      {r.paid.amount > 0 && (
        <div className={cn(row, "py-2")}>
          <span className="min-w-0 truncate text-muted-foreground">Paid media {r.paid.months} mois (+{r.paid.pct} %)</span>
          <span className="shrink-0 font-medium tabular-nums text-foreground">{formatEuro(r.paid.amount)}</span>
        </div>
      )}
      <div className={cn(row, "py-2.5")}>
        <span className="font-semibold text-foreground">Cible HT</span>
        <span className="flex shrink-0 items-center font-semibold tabular-nums text-foreground">{formatEuro(r.target)}<Verify /></span>
      </div>
      {r.effectiveCpm > 0 && (
        <div className="py-2">
          <div className={row}>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              CPM effectif
              <HelpTip title="CPM effectif">
                <p>Prix des livrables (hors paid media et retouches) pour 1000 vues attendues : vues médianes du créateur × nombre de contenus.</p>
                <p>Argument pour la marque : « {formatEuro(r.effectiveCpm)} pour 1000 vues, calculé sur les vues médianes réelles du créateur. » Aucun chiffre de marché.</p>
              </HelpTip>
            </span>
            <span className="shrink-0 font-medium tabular-nums text-foreground">{formatEuro(r.effectiveCpm)}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-faint">{r.expectedViews.toLocaleString("fr-FR")} vues attendues</div>
        </div>
      )}
      {r.steps.length > 0 && (
        <div className="py-2">
          <div className="mb-1 text-[12px] font-semibold text-foreground">Paliers de baisse</div>
          {r.steps.map((s, i) => (
            <div key={i} className="py-1">
              <div className={row}>
                <span className="min-w-0 text-muted-foreground">{s.label}</span>
                <span className="shrink-0 tabular-nums text-foreground">−{formatEuro(s.amount)} → {formatEuro(s.after)}</span>
              </div>
              <div className="text-[11px] text-faint">Contre : {s.contrepartie}</div>
            </div>
          ))}
        </div>
      )}
      <div className="py-2">
        <div className={row}>
          <span className="text-muted-foreground">Créateur</span>
          <span className="flex shrink-0 items-center tabular-nums text-foreground">{formatEuro(split.creator)}<Verify /></span>
        </div>
        <div className={cn(row, "mt-1")}>
          <span className="text-muted-foreground">Agence ({num1(commissionPct)} %)</span>
          <span className="flex shrink-0 items-center tabular-nums text-foreground">{formatEuro(split.agency)}<Verify /></span>
        </div>
      </div>
    </div>
  );
}

/** Barème de la méthode (blob `pricingRates.ttp`) : valeurs de départ, à ajuster. */
export function TarifGridEditor({ grid, onClose }: { grid: TarifGrid; onClose: () => void }) {
  const [draft, setDraft] = useState<TarifGrid>(grid);
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const n = (v: string) => Math.max(0, parseFloat(v.replace(",", ".")) || 0);
  const save = async (next: TarifGrid) => {
    if (Object.values(next.cpm).some((v) => !(v > 0))) return toast("Un CPM doit être supérieur à 0 : rien n'a été enregistré");
    setSaving(true);
    const ok = await saveTarifGrid(gridDiff(next));
    setSaving(false);
    toast(ok ? "Barème enregistré pour toute l'équipe ✓" : "Erreur, réessaie");
    if (ok) onClose();
  };
  const box = "h-8 w-16 shrink-0 rounded-md border border-border bg-surface px-1.5 text-center text-[12px] tabular-nums outline-none focus:border-primary max-md:h-11 max-md:text-[16px]";
  const field = (label: string, value: number, set: (v: number) => void, unit: string) => (
    <label key={label} className="flex items-center justify-between gap-2 py-0.5 text-[12px]">
      <span className="min-w-0 text-foreground">{label}</span>
      <span className="flex shrink-0 items-center gap-1 text-faint">
        <input defaultValue={value} onBlur={(e) => set(n(e.target.value))} inputMode="decimal" className={box} aria-label={label} /> {unit}
      </span>
    </label>
  );
  const pct = (k: keyof TarifGrid) => (v: number) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <div className="p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
        Méthode TARIF
        <HelpTip title="Barème de la méthode TARIF">
          <p>Valeurs de départ, à ajuster. Elles servent à la page Tarifs et à Claude (outil « Méthode TARIF »).</p>
          <p>CPM = € HT pour 1000 vues médianes. Pourcentages = part du prix de base.</p>
        </HelpTip>
      </div>
      <div className="mb-2 text-[11px] text-wait">Valeurs de départ, à ajuster</div>
      <div className="max-h-[min(60vh,420px)] overflow-y-auto pr-1">
        <div className="mb-1 text-[11px] font-medium text-muted-foreground">CPM par format</div>
        {TARIF_FORMATS.map((f) => field(f.label, draft.cpm[f.key], (v) => setDraft((d) => ({ ...d, cpm: { ...d.cpm, [f.key]: v } })), "€"))}
        <div className="mb-1 mt-3 text-[11px] font-medium text-muted-foreground">Production et plancher, par contenu</div>
        {field("Production simple", draft.production.simple, (v) => setDraft((d) => ({ ...d, production: { ...d.production, simple: v } })), "€")}
        {field("Production moyenne", draft.production.moyen, (v) => setDraft((d) => ({ ...d, production: { ...d.production, moyen: v } })), "€")}
        {field("Production élaborée", draft.production.elabore, (v) => setDraft((d) => ({ ...d, production: { ...d.production, elabore: v } })), "€")}
        {field("Plancher par défaut", draft.floor, pct("floor"), "€")}
        {field("Retouche en plus", draft.extraRetouch, pct("extraRetouch"), "€")}
        <div className="mb-1 mt-3 text-[11px] font-medium text-muted-foreground">Majorations</div>
        {field("Droits organiques, par 3 mois", draft.rightsPct, pct("rightsPct"), "%")}
        {field("Paid media, par mois", draft.paidPct, pct("paidPct"), "%")}
        {field("Exclusivité restreinte, par mois", draft.exclRestrictedPct, pct("exclRestrictedPct"), "%")}
        {field("Exclusivité large, par mois", draft.exclWidePct, pct("exclWidePct"), "%")}
        {field("Urgence", draft.rushPct, pct("rushPct"), "%")}
        {field("Urgence sous", draft.rushDays, pct("rushDays"), "j")}
        {field("Lien en bio ou code promo", draft.linkPct, pct("linkPct"), "%")}
        <div className="mb-1 mt-3 text-[11px] font-medium text-muted-foreground">Remises et garde-fous</div>
        {field("Package", draft.packPct, pct("packPct"), "%")}
        {field("Package à partir de", draft.packMin, pct("packMin"), "cont.")}
        {field("Partenariat", draft.partnerPct, pct("partnerPct"), "%")}
        {field("Partenariat à partir de", draft.partnerMonths, pct("partnerMonths"), "mois")}
        {field("Ancrage au-dessus de la cible", draft.anchorPct, pct("anchorPct"), "%")}
        {field("CPM effectif minimum", draft.minCpm, pct("minCpm"), "€")}
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {confirmReset ? (
          <button type="button" onClick={() => void save(DEFAULT_TARIF_GRID)} disabled={saving} className="flex h-9 items-center gap-1 rounded-full bg-destructive px-3 text-[12px] font-semibold text-white disabled:opacity-50 max-md:h-11">
            <Check className="h-3.5 w-3.5" /> Confirmer
          </button>
        ) : (
          <button type="button" onClick={() => setConfirmReset(true)} disabled={saving} className="flex h-9 items-center gap-1 rounded-full border border-border px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover max-md:h-11">
            <RotateCcw className="h-3.5 w-3.5" /> Rétablir
          </button>
        )}
        <button type="button" onClick={onClose} className="h-9 rounded-full border border-border px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover max-md:h-11">Annuler</button>
        <button type="button" onClick={() => void save(draft)} disabled={saving} className="h-9 rounded-full bg-primary px-3.5 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 max-md:h-11">Enregistrer</button>
      </div>
    </div>
  );
}
