import { contractEnd, contractTypeLabel } from "./anticipation";
import type { AujDeadline } from "./aujourdhui";
import { titleCase } from "./utils";
import type { Exclusivite } from "../../supabase/functions/_shared/exclusivites.ts";

/*
 * Échéances posées sur le Planning en lecture seule (demande de Marc, 4 nov. 2026) :
 *   - fin des contrats suivis (blob `contractDeadlines`, page Échéances). Un contrat
 *     renouvelé (même créateur, même type, fin plus tardive) ne montre que sa dernière fin ;
 *   - fin des exclusivités confirmées (blob `exclusivites`, celles « à confirmer » non) ;
 *   - anniversaires des créateurs actifs, l'année d'avant, l'année en cours et la suivante.
 * Un clic ouvre la page d'origine (Échéances, Exclusivités, fiche du créateur).
 */

export type EcheanceKind = "contrat" | "exclu" | "anniv";
/** `label` = le titre sans le nom du créateur (type de contrat, marque, âge), pour son propre agenda. */
export type Echeance = { id: string; date: string; title: string; label: string; who: string | null; kind: EcheanceKind };
export type BirthCreator = { name: string; birth: string | null; status?: string | null };

/** « 1999-11-05 », « 05/11/1999 » → « 1999-11-05 » ; illisible ou vide → "". */
function isoOf(s: unknown): string {
  const t = String(s ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  return fr ? `${fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}` : "";
}

const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function contractEcheances(list: readonly AujDeadline[]): Echeance[] {
  const key = (d: AujDeadline) => `${(d.type || "").toLowerCase()}|${(d.creator || "").trim().toLowerCase()}`;
  const withEnd = list.flatMap((d) => {
    // `months` peut être enregistré en texte (« 12 ») : en nombre, sinon « 10 + "12" » concatène.
    const end = d && d.creator ? contractEnd(d.start, Number(d.months) || 0) : null;
    return end ? [{ d, end }] : [];
  });
  const latest = new Map<string, string>();
  for (const x of withEnd) if ((latest.get(key(x.d)) ?? "") < x.end) latest.set(key(x.d), x.end);
  const seen = new Set<string>();
  const out: Echeance[] = [];
  for (const { d, end } of withEnd) {
    const k = key(d);
    if (latest.get(k) !== end || seen.has(k)) continue;
    seen.add(k);
    out.push({
      id: `contrat:${d.id ?? k}`,
      date: end,
      title: `${titleCase(d.creator.trim())} · ${contractTypeLabel(d.type)}`,
      label: contractTypeLabel(d.type),
      who: d.creator.trim(),
      kind: "contrat",
    });
  }
  return out;
}

export function excluEcheances(list: readonly Pick<Exclusivite, "id" | "creator" | "brand" | "end" | "pending">[]): Echeance[] {
  return list.flatMap((x) => {
    const end = isoOf(x.end);
    if (x.pending || !end || !x.creator?.trim()) return [];
    const brand = x.brand?.trim();
    return [{
      id: `exclu:${x.id}`,
      date: end,
      title: `${titleCase(x.creator.trim())}${brand ? ` × ${brand}` : ""}`,
      label: brand ?? "",
      who: x.creator.trim(),
      kind: "exclu" as const,
    }];
  });
}

export function birthdayEcheances(creators: readonly BirthCreator[], today: string): Echeance[] {
  const year = Number(today.slice(0, 4));
  const out: Echeance[] = [];
  for (const c of creators) {
    if (String(c.status ?? "actif").toLowerCase() === "inactif") continue;
    const b = isoOf(c.birth);
    if (!b || !c.name?.trim()) continue;
    const born = Number(b.slice(0, 4));
    for (const y of [year - 1, year, year + 1]) {
      let md = b.slice(5);
      if (md === "02-29" && !leap(y)) md = "02-28";
      const age = born > 1900 && born < y ? y - born : null;
      out.push({
        id: `anniv:${c.name.trim()}:${y}`,
        date: `${y}-${md}`,
        title: `${titleCase(c.name.trim())}${age ? ` · ${age} ans` : ""}`,
        label: age ? `${age} ans` : "",
        who: c.name.trim(),
        kind: "anniv",
      });
    }
  }
  return out;
}
