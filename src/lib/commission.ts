/**
 * Source UNIQUE du taux de commission agence : le champ `commission` de la fiche
 * créateur (roster). Facturation, Reversements et Aperçu lisent tous ce taux, si
 * bien qu'une modification sur la fiche se répercute partout.
 */
export const DEFAULT_COMMISSION = 20;

/** "25%", "25", "25,5 %" → 25 (nombre). null si vide/illisible. */
export function parseCommissionPct(s: string | null | undefined): number | null {
  if (s == null || s === "") return null;
  const m = /(\d+(?:[.,]\d+)?)/.exec(String(s));
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

/**
 * Taux d'un créateur : sa fiche roster, sinon le taux mémorisé à la dernière facture
 * (blob `creatorCommission`), sinon le défaut. Le nom se compare sans majuscules ni
 * espaces autour (« Léna Test » = « LÉNA TEST »).
 */
export function rateFor(
  name: string | null | undefined,
  roster: Record<string, number>,
  saved: Record<string, number> = {},
  fallback = DEFAULT_COMMISSION,
): number {
  const k = (name ?? "").trim().toLowerCase();
  if (!k) return fallback;
  const find = (map: Record<string, number>) => {
    if (map[name as string] != null) return map[name as string];
    for (const [n, v] of Object.entries(map)) if (n.trim().toLowerCase() === k && v != null) return v;
    return undefined;
  };
  const v = find(roster) ?? find(saved);
  return v != null && Number.isFinite(Number(v)) ? Number(v) : fallback;
}

/** Construit une table nom_créateur → taux (%) depuis le roster. */
export function commissionMap(creators: { name: string; commission?: string | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of creators) {
    const v = parseCommissionPct(c.commission);
    if (v != null) out[c.name] = v;
  }
  return out;
}

/** Origine d'un deal (contrat de représentation, barème « par origine »). */
export type DealOrigin = "agence" | "talent" | "autonome";
export const DEAL_ORIGINS: { value: DealOrigin; label: string }[] = [
  { value: "agence", label: "Apporté par l'agence" },
  { value: "talent", label: "Initié par le talent" },
  { value: "autonome", label: "Géré par le talent seul" },
];

type ContractRates = { uniform: number | null; agence: number; talent: number; autonome: number };

/**
 * Taux du DERNIER contrat de représentation de chaque créateur (blob `contractHistory`) :
 * taux unique si le contrat est « uniforme », sinon un taux par origine du deal.
 */
export function contractRatesFrom(history: unknown): Record<string, ContractRates> {
  const out: Record<string, ContractRates> = {};
  if (!Array.isArray(history)) return out;
  const n = (v: unknown, d: number) => {
    const x = parseCommissionPct(v == null ? null : String(v));
    return x == null ? d : x;
  };
  const sorted = [...history].sort((a, b) => String(a?.createdAt ?? "").localeCompare(String(b?.createdAt ?? "")));
  for (const h of sorted) {
    const name = String(h?.creator ?? "").trim().toLowerCase();
    const c = h?.config;
    if (!name || !c) continue;
    const uniform = c.modeCommission === "uniforme" ? n(c.commUniforme, DEFAULT_COMMISSION) : null;
    out[name] = { uniform, agence: n(c.commApportee, DEFAULT_COMMISSION), talent: n(c.commInitiee, DEFAULT_COMMISSION), autonome: n(c.commAutonome, 0) };
  }
  return out;
}

/** Taux du contrat pour un deal de cette origine (null : pas de contrat). */
export function contractRateFor(name: string | null | undefined, origin: DealOrigin, rates: Record<string, ContractRates>): number | null {
  const r = rates[(name ?? "").trim().toLowerCase()];
  if (!r) return null;
  if (origin === "autonome") return r.autonome;
  return r.uniform ?? (origin === "talent" ? r.talent : r.agence);
}

/**
 * Taux d'une collab : celui du contrat signé selon l'origine du deal (choix de Marc, 2 nov. 2026),
 * sinon le taux de la fiche du créateur (rateFor).
 */
export function collabRateFor(
  name: string | null | undefined,
  origin: DealOrigin | null | undefined,
  contracts: Record<string, ContractRates>,
  roster: Record<string, number>,
  saved: Record<string, number> = {},
): number {
  return contractRateFor(name, origin ?? "agence", contracts) ?? rateFor(name, roster, saved);
}

/** Origine enregistrée d'une collab (blob `collabDealOrigin`), « agence » par défaut. */
export function dealOriginOf(collabId: string | null | undefined, origins: unknown): DealOrigin {
  const v = collabId && origins && typeof origins === "object" ? (origins as Record<string, unknown>)[collabId] : null;
  return v === "talent" || v === "autonome" ? v : "agence";
}
