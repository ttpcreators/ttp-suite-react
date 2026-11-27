// ============================================================================
// _shared/depots.ts : les dépôts des créateurs qui attendent l'agence (logique PURE).
// ----------------------------------------------------------------------------
// Constat W5 : le contenu, la facture ou les captures de stats qu'un créateur envoie depuis
// son espace deviennent des lignes `documents` sans suite. Un dépôt se reconnaît à son chemin
// `creator-uploads/<id du compte>/…` et à son type (« contenu », « facture », « stats »).
// Il attend l'agence tant que :
//   - son repère « document » n'est pas lu (SQL 2026-11-27 : la base en écrit un à chaque
//     dépôt ; l'agence le lit en ouvrant le fichier, ou avec « C'est vu ») ;
//   - et la collab n'a pas avancé derrière lui : contenu → « Validation marque » (étape 5)
//     atteinte après le dépôt ; facture → versement au créateur noté après le dépôt, ou
//     « Créateur payé » (étape 10) atteint après lui ; stats → le repère seul (les stats d'un
//     post font avancer la collab toutes seules). Jamais d'avancement automatique d'étape.
// Avant le SQL, aucun repère n'existe : rien n'attend, comme aujourd'hui.
// Sans `documents.collab_id` (avant le SQL), les dépôts sont regroupés par créateur et par
// type. Partagé par la page Aujourd'hui (« Les créateurs attendent ») et le contrôle des
// données (règle « dépôt sans suite », _shared/controle.ts). Testé par depots.test.ts.
// ============================================================================

import { foldName } from "./exclusivites.ts";

export type DepotType = "contenu" | "facture" | "stats";
export const DEPOT_TYPES: DepotType[] = ["contenu", "facture", "stats"];

export type Depot = { id: string; creator: string | null; type: string | null; name?: string | null; path?: string | null; created_at: string | null; collab_id?: string | null };
export type DepotCollab = { id: string; brand: string | null; creator?: string | null };
export type DepotStep = { collab_id: string; step: number; reached_at: string | null };

/** Étape qui vaut une suite donnée par l'agence, par type de dépôt (null : le repère seul). */
export const ETAPE_SUITE: Record<DepotType, number | null> = { contenu: 5, facture: 10, stats: null };

/** Un groupe de dépôts qui attendent : même type, même créateur, même collab (ou sans collab). */
export type GroupeDepots = {
  cle: string;
  type: DepotType;
  creator: string;
  collabId: string | null;
  brand: string | null;
  ids: string[];
  noms: string[];
  /** Le plus ancien dépôt du groupe (ISO). */
  depuis: string;
  /** Le plus récent (ISO). */
  dernier: string;
};

/** Une ligne `documents` déposée par un créateur depuis son espace (contenu, facture, stats). */
export function estDepotCreateur(d: Pick<Depot, "path" | "type">): boolean {
  const p = String(d.path ?? "");
  return p.startsWith("creator-uploads/") && !p.includes("/todo-attachments/") && (DEPOT_TYPES as string[]).includes(String(d.type ?? ""));
}

const temps = (iso: string | null | undefined) => {
  const t = Date.parse(String(iso ?? ""));
  return Number.isFinite(t) ? t : null;
};

/** Un versement au créateur noté le jour du dépôt ou après (blob `creatorPayouts`). */
function verseDepuis(payouts: Record<string, unknown> | null | undefined, creator: string, depuis: string): boolean {
  const who = foldName(creator);
  if (!who || !payouts || typeof payouts !== "object") return false;
  const jour = depuis.slice(0, 10);
  for (const [k, list] of Object.entries(payouts)) {
    if (foldName(k) !== who || !Array.isArray(list)) continue;
    if (list.some((p) => (Number((p as { amount?: unknown })?.amount) || 0) > 0 && String((p as { date?: unknown })?.date ?? "").slice(0, 10) >= jour)) return true;
  }
  return false;
}

/** La collab a-t-elle atteint `etape` (ou plus) APRÈS ce moment ? */
function etapeApres(steps: readonly DepotStep[] | null | undefined, collabId: string | null, etape: number, apres: number): boolean {
  if (!collabId || !steps) return false;
  return steps.some((s) => s.collab_id === collabId && Number(s.step) >= etape && (temps(s.reached_at) ?? 0) > apres);
}

/** Le dépôt a-t-il déjà eu une suite (collab avancée, versement noté) ? */
export function depotSuivi(d: Depot, ctx: { steps?: readonly DepotStep[] | null; payouts?: Record<string, unknown> | null }): boolean {
  const type = String(d.type ?? "") as DepotType;
  const at = temps(d.created_at);
  if (at == null) return false;
  const etape = ETAPE_SUITE[type];
  if (etape != null && etapeApres(ctx.steps, d.collab_id ?? null, etape, at)) return true;
  if (type === "facture" && verseDepuis(ctx.payouts, String(d.creator ?? ""), String(d.created_at))) return true;
  return false;
}

/**
 * Dépôts qui attendent l'agence, groupés (le plus ancien d'abord). `nonLus` : ids des
 * documents dont le repère agence n'est pas lu.
 */
export function depotsEnAttente(input: {
  depots: readonly Depot[];
  nonLus: ReadonlySet<string>;
  collabs?: readonly DepotCollab[] | null;
  steps?: readonly DepotStep[] | null;
  payouts?: Record<string, unknown> | null;
}): GroupeDepots[] {
  const brandOf = new Map((input.collabs ?? []).map((c) => [c.id, String(c.brand ?? "").trim() || null]));
  const groupes = new Map<string, GroupeDepots>();
  // Du plus ancien au plus récent : le premier id d'un groupe est son plus vieux dépôt (id stable).
  const parDate = [...input.depots].sort((a, b) => (temps(a.created_at) ?? 0) - (temps(b.created_at) ?? 0));
  for (const d of parDate) {
    if (!estDepotCreateur(d) || !input.nonLus.has(d.id) || !d.created_at) continue;
    if (depotSuivi(d, input)) continue;
    const type = String(d.type) as DepotType;
    const creator = String(d.creator ?? "").trim();
    const collabId = d.collab_id ?? null;
    const cle = `${type}|${collabId ?? ""}|${foldName(creator)}`;
    let g = groupes.get(cle);
    if (!g) {
      g = { cle, type, creator, collabId, brand: collabId ? brandOf.get(collabId) ?? null : null, ids: [], noms: [], depuis: d.created_at, dernier: d.created_at };
      groupes.set(cle, g);
    }
    g.ids.push(d.id);
    g.noms.push(String(d.name ?? "").trim() || "Fichier");
    if ((temps(d.created_at) ?? 0) < (temps(g.depuis) ?? 0)) g.depuis = d.created_at;
    if ((temps(d.created_at) ?? 0) > (temps(g.dernier) ?? 0)) g.dernier = d.created_at;
  }
  return [...groupes.values()].sort((a, b) => (temps(a.depuis) ?? 0) - (temps(b.depuis) ?? 0));
}

/** Jours entiers depuis `iso` jusqu'au jour `aujourdhui` (« AAAA-MM-JJ »), au moins 0. */
export function joursDepuis(iso: string, aujourdhui: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = aujourdhui.slice(0, 10).split("-").map(Number);
  const n = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86400000);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}
