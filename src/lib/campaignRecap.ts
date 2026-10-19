/**
 * Bilan de campagne automatique (page Debrief) : 7 jours après la publication d'une
 * collab, ses chiffres (posts repérés par les synchros Instagram / TikTok / YouTube)
 * pré-remplissent le bilan pour la marque, avec une proposition de renouvellement.
 * Fonctions pures (testées) : la page n'a plus qu'à les afficher.
 */
import { totalsOf, emptyStat, fmtCompact, fmtPct, reliableEr, GOOD_ER_REACH, GOOD_ER_FOLLOWERS, type EngPlatform, type PostStat } from "./engagement";
import { parseAmountStrict } from "./money";

type IgPost = { id: string; at?: string; type?: string; product?: string; likes?: number | null; comments?: number | null; reach?: number | null; saves?: number | null; shares?: number | null; views?: number | null };
type TtPost = { id: string; at?: string; views?: number | null; likes?: number | null; comments?: number | null; shares?: number | null };
type YtPost = { id: string; at?: string; short?: boolean; views?: number | null; likes?: number | null; comments?: number | null };
export type CollabForRecap = {
  id: string; brand: string; creator: string | null; deliverables: string | null; cachet: string | null; step: number; created_at: string;
  ig?: { posts?: IgPost[] } | null; tt?: { posts?: TtPost[] } | null; yt?: { posts?: YtPost[] } | null;
};
export type StepRow = { collab_id: string; step: number; reached_at: string };

const DAY = 86400000;
const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const igKind = (p: IgPost) => (p.product === "REELS" ? "Reel" : p.type === "CAROUSEL_ALBUM" ? "Carrousel" : p.type === "VIDEO" ? "Vidéo" : "Post");

/** Date de publication : 1re arrivée à l'étape 6 (ou au-delà), sinon le 1er post repéré. */
export function publicationDate(c: CollabForRecap, steps: StepRow[]): string | null {
  const reached = steps.filter((s) => s.collab_id === c.id && s.step >= 6).map((s) => s.reached_at).sort()[0];
  if (reached) return reached;
  const posts = [...(c.ig?.posts ?? []), ...(c.tt?.posts ?? []), ...(c.yt?.posts ?? [])].map((p) => p.at).filter((x): x is string => !!x).sort();
  return posts[0] ?? null;
}

/** Prêt pour le bilan : publiée depuis au moins 7 jours. */
export function readyForRecap(pub: string | null, now = Date.now()): boolean {
  return !!pub && now - Date.parse(pub) >= 7 * DAY;
}

/** Une ligne par contenu publié (même format que le calculateur d'engagement). */
export function collabStats(c: CollabForRecap): { stats: PostStat[]; labels: Map<string, string> } {
  const stats: PostStat[] = [];
  const labels = new Map<string, string>();
  const day = (at?: string) => (at ? new Date(at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "");
  for (const p of c.ig?.posts ?? []) {
    const id = `ig-${p.id}`;
    stats.push({ ...emptyStat(id, igKind(p)), reach: n(p.reach), likes: n(p.likes), comments: n(p.comments), saves: n(p.saves), shares: n(p.shares), views: n(p.views) });
    labels.set(id, `${igKind(p)} Instagram du ${day(p.at)}`.trim());
  }
  for (const p of c.tt?.posts ?? []) {
    const id = `tt-${p.id}`;
    stats.push({ ...emptyStat(id, "TikTok"), likes: n(p.likes), comments: n(p.comments), shares: n(p.shares), views: n(p.views) });
    labels.set(id, `TikTok du ${day(p.at)}`);
  }
  for (const p of c.yt?.posts ?? []) {
    const id = `yt-${p.id}`;
    const kind = p.short ? "Short" : "YouTube";
    stats.push({ ...emptyStat(id, kind), likes: n(p.likes), comments: n(p.comments), views: n(p.views) });
    labels.set(id, `${kind === "Short" ? "Short YouTube" : "Vidéo YouTube"} du ${day(p.at)}`);
  }
  return { stats, labels };
}

export type Recap = {
  period: string; deliverables: string; budget: string; reach: string; engagement: string;
  summary: string; highlights: string[]; renewal: string; stats: PostStat[]; basis: "reach" | "followers";
  /** Abonnés qui ont servi au taux (0 si taux sur la couverture ou pas de taux). */
  followers: number;
};

const cap = (s: string) => s.split(/(\s+|-)/).map((w) => (w ? w.charAt(0).toLocaleUpperCase("fr") + w.slice(1) : w)).join("");

/**
 * Bilan pré-rempli : période, chiffres, synthèse, points forts et renouvellement proposé.
 * `followersBy` = abonnés du créateur PAR réseau (Instagram, TikTok, YouTube).
 */
export function buildRecap(c: CollabForRecap, pub: string | null, followersBy: Partial<Record<EngPlatform, number>>): Recap {
  const { stats, labels } = collabStats(c);
  const t = totalsOf(stats);
  const creator = c.creator ? cap(c.creator) : "le créateur";
  // Taux global seulement sur une base homogène (voir reliableEr) : couverture sur chaque
  // contenu, sinon abonnés du SEUL réseau publié ; sinon pas de taux plutôt qu'un faux.
  const rel = reliableEr(stats, followersBy);
  const er = rel.er;
  const basis: "reach" | "followers" = rel.basis ?? "reach";
  const pubDay = pub ? new Date(pub) : null;
  const period = pubDay ? `Publication le ${pubDay.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })} · bilan à 7 jours` : "";

  // Couverture additionnée sur plusieurs contenus : une même personne compte plusieurs fois.
  const withReach = stats.filter((s) => s.reach > 0).length;
  const parts = [
    t.views ? `${fmtCompact(t.views)} vues` : "",
    t.reach ? (withReach > 1 ? `${fmtCompact(t.reach)} de couverture cumulée` : `${fmtCompact(t.reach)} personnes touchées`) : "",
    t.interactions ? `${fmtCompact(t.interactions)} interactions` : "",
  ].filter(Boolean);
  const summary = stats.length
    ? `${stats.length} contenu${stats.length > 1 ? "s" : ""} publié${stats.length > 1 ? "s" : ""} par ${creator} pour ${c.brand}${parts.length ? ` : ${parts.join(", ")}` : ""}${er != null ? `, pour un taux d'engagement de ${fmtPct(er)} (${basis === "reach" ? "sur la couverture" : "sur les abonnés"})` : ""}.`
    : `Campagne ${c.brand} × ${creator} : chiffres à compléter.`;

  const highlights: string[] = [];
  const best = [...stats].sort((a, b) => (b.views || b.reach || b.likes) - (a.views || a.reach || a.likes))[0];
  if (best && (best.views || best.reach || best.likes)) {
    const v = best.views ? `${fmtCompact(best.views)} vues` : best.reach ? `${fmtCompact(best.reach)} personnes touchées` : `${fmtCompact(best.likes)} j'aime`;
    highlights.push(`Meilleur contenu : ${labels.get(best.id) ?? best.kind}, ${v}`);
  }
  if (t.saves) highlights.push(`${fmtCompact(t.saves)} enregistrements : le contenu est gardé pour plus tard, signe d'intérêt pour le produit`);
  if (t.shares) highlights.push(`${fmtCompact(t.shares)} partages : la communauté a relayé la marque elle-même`);
  if (t.comments) highlights.push(`${fmtCompact(t.comments)} commentaires`);

  // Proposition « forte » seulement si le taux est FIABLE (base homogène) et au-dessus du
  // repère partagé de l'app ; sinon proposition de seconde vague, sans comparaison au secteur.
  const strong = er != null && er >= (basis === "reach" ? GOOD_ER_REACH : GOOD_ER_FOLLOWERS);
  const renewal = strong
    ? `Ces résultats dépassent les moyennes habituelles du secteur. Nous vous proposons de prolonger le partenariat avec ${creator} sur trois mois, à raison d'un contenu par mois : la répétition installe ${c.brand} dans le quotidien de sa communauté et fait baisser le coût par personne touchée.`
    : `Pour aller plus loin, nous vous proposons une seconde vague avec ${creator}, en nous appuyant sur ce qui a le mieux fonctionné ici (format, angle, moment de publication), avec un objectif clair défini ensemble.`;

  return {
    period,
    deliverables: c.deliverables?.trim() || (stats.length ? stats.map((s) => s.kind).join(" · ") : ""),
    // Cachet ambigu (« 800 € x 2 ») : champ laissé vide, à saisir, plutôt qu'un montant faux.
    budget: parseAmountStrict(c.cachet) !== null ? (c.cachet ?? "").trim() : "",
    reach: t.reach ? fmtCompact(t.reach) : "",
    engagement: er != null ? fmtPct(er) : "",
    summary,
    highlights,
    renewal,
    stats,
    basis,
    followers: rel.followers,
  };
}
