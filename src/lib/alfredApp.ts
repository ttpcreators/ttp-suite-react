/**
 * Alfred dans l'app : logique pure (testée par alfredApp.test.ts). Miroir côté serveur :
 * supabase/functions/_shared/alfredPont.ts (mêmes réglages d'origine).
 */

export type ReglagesAlfred = {
  heures: { matin: number; soir: number; veille: number[]; vigie: number; contenu: number; bilan_soir: number };
  sonner: { points: boolean; valider: boolean };
  commandes: { texte: string; maj_le: string };
};

const BASE = { matin: 9, soir: 17, veille: [11, 13, 15], vigie: 6, contenu: 16, bilan_soir: 20 };
const h = (v: unknown, d: number) => (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 23 ? Number(v) : d);

/** Les réglages enregistrés (colonne agent.agents.reglages), complétés par ceux d'origine. */
export function lireReglages(v: unknown): ReglagesAlfred {
  const o = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, any>;
  const x = (o.heures ?? {}) as Record<string, unknown>;
  const veille = Array.isArray(x.veille) ? (x.veille as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 23) : BASE.veille;
  return {
    heures: { matin: h(x.matin, BASE.matin), soir: h(x.soir, BASE.soir), veille, vigie: h(x.vigie, BASE.vigie), contenu: h(x.contenu, BASE.contenu), bilan_soir: h(x.bilan_soir, BASE.bilan_soir) },
    sonner: { points: o.sonner?.points !== false, valider: o.sonner?.valider !== false },
    commandes: { texte: String(o.commandes?.texte ?? ""), maj_le: String(o.commandes?.maj_le ?? "") },
  };
}

/** En ligne si l'iMac a donné signe de vie depuis moins de 5 minutes. */
export function alfredEnLigne(vuLe: string | null, maintenant: Date): { enLigne: boolean; jamais: boolean; minutes: number } {
  if (!vuLe) return { enLigne: false, jamais: true, minutes: 0 };
  const minutes = Math.max(0, Math.floor((maintenant.getTime() - Date.parse(vuLe)) / 60_000));
  return { enLigne: minutes < 5, jamais: false, minutes };
}

/** La journée d'Alfred en une phrase, pour vérifier ses réglages d'un coup d'œil. */
export function heuresTexte(x: ReglagesAlfred["heures"]): string {
  const f = (n: number) => `${n} h`;
  return `Vigie à ${f(x.vigie)}, point à ${f(x.matin)}, veilles à ${x.veille.length ? x.veille.map(f).join(", ") : "aucune heure"}, point du soir et liste à ${f(x.soir)}, bilan à ${f(x.bilan_soir)} ; point contenu le mardi et le vendredi à ${f(x.contenu)}.`;
}
