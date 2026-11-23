import { useEffect, useRef, useState } from "react";
import { Picker } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { TONE_TEXT } from "@/lib/statusTone";
import { CACHET_DEVISES, CACHET_ILLISIBLE, DEVISE_SIGNE, cachetSaisi, lireCachet, type CachetDevise } from "../../supabase/functions/_shared/cachet.ts";

/**
 * Champ « Cachet » d'une collab : un montant, une devise (EUR par défaut) et une case
 * « Affiliation ». La colonne reste un texte, écrit sous UNE forme (« 550 € »,
 * « 550 $ + affiliation », « Affiliation seule » : supabase/functions/_shared/cachet.ts).
 * Un ancien texte illisible reste affiché et gardé tel quel tant qu'on ne saisit rien.
 * Un montant tapé illisible ne change jamais la valeur : `onInvalid(true)` prévient le
 * formulaire, qui bloque l'enregistrement (CACHET_ILLISIBLE).
 */
type State = { amount: string; devise: CachetDevise; affiliation: boolean; legacy: string };

const montantTexte = (n: number) => String(n).replace(".", ",");

function stateOf(value: string): State {
  const l = lireCachet(value);
  if (!l.lisible) return { amount: "", devise: l.devise, affiliation: false, legacy: value.trim() };
  return { amount: l.montant != null ? montantTexte(l.montant) : "", devise: l.devise, affiliation: l.affiliation, legacy: "" };
}

const DEVISE_OPTIONS = CACHET_DEVISES.map((d) => ({ value: d, label: d === "CHF" ? "CHF" : `${DEVISE_SIGNE[d]} ${d}` }));

export function CachetField({ value, onChange, onInvalid, label = "Cachet", className }: {
  value: string;
  onChange: (v: string) => void;
  /** Montant tapé illisible (true) ou de nouveau lisible (false). */
  onInvalid?: (bad: boolean) => void;
  label?: string;
  className?: string;
}) {
  const [st, setSt] = useState<State>(() => stateOf(value));
  // Dernière valeur envoyée au parent : une autre valeur (formulaire vidé, autre collab) recharge le champ.
  const sent = useRef(value);
  useEffect(() => {
    if (value === sent.current) return;
    sent.current = value;
    setSt(stateOf(value));
    onInvalid?.(false);
    // onInvalid : fonction du parent, pas une donnée à suivre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const update = (patch: Partial<State>) => {
    const next = { ...st, ...patch };
    setSt(next);
    const r = cachetSaisi(next.amount, next.devise, next.affiliation, next.legacy);
    onInvalid?.("illisible" in r);
    // Montant illisible : la valeur précédente reste, rien n'est envoyé.
    if ("illisible" in r) return;
    sent.current = r.valeur;
    onChange(r.valeur);
  };

  const unreadable = "illisible" in cachetSaisi(st.amount, st.devise, st.affiliation, st.legacy);
  const replaced = st.legacy !== "" && !unreadable && (st.amount.trim() !== "" || st.affiliation);
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col gap-1.5 sm:min-w-[260px]", className)}>
      <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <div className="flex h-[42px] min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-foreground transition-shadow focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
          <input
            inputMode="decimal"
            aria-label={`${label} : montant`}
            value={st.amount}
            onChange={(e) => update({ amount: e.target.value.replace(/[^\d\s.,]/g, "") })}
            placeholder="Montant"
            className="min-w-0 flex-1 bg-transparent text-sm tabular-nums text-foreground outline-none placeholder:text-faint"
          />
        </div>
        <Picker ariaLabel={`${label} : devise`} className="w-[92px] shrink-0" value={st.devise} onChange={(v) => update({ devise: v as CachetDevise })} options={DEVISE_OPTIONS} />
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted-foreground">
        <Checkbox checked={st.affiliation} onCheckedChange={(v) => update({ affiliation: v === true })} />
        {st.amount.trim() ? "+ affiliation" : "Affiliation seule"}
      </label>
      {unreadable && <span className={cn("text-[11px]", TONE_TEXT.wait)}>{CACHET_ILLISIBLE}</span>}
      {st.legacy && (
        <span className="text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
          Ancien cachet : « {st.legacy} ». {replaced ? "Remplacé par ta saisie." : "Gardé tel quel tant que rien n'est saisi."}
        </span>
      )}
    </div>
  );
}
