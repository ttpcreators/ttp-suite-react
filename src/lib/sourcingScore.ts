/**
 * Score « Potentiel » du Sourcing (page Sourcing › Trouver des créateurs).
 *
 * Une note sur 100 pour trier vite les comptes trouvés, et son détail facteur par
 * facteur (le panneau « Profil sélectionné » dit POURQUOI un compte a sa note).
 * Le détail et la note viennent du même calcul : la note = somme des points des
 * facteurs, moins 15 par signal d'alerte, bornée entre 0 et 100.
 *
 *   Instagram : engagement par rapport à sa taille (40), rythme (15), déjà payé par
 *               des marques (15), email trouvé (10), pas d'agence (10), actif (10).
 *   YouTube   : vues moyennes par rapport aux abonnés (30), engagement des vidéos (10),
 *               rythme (15), déjà sponsorisé (15), email (10), pas d'agence (10),
 *               actif ce mois-ci (10).
 *
 * Les mots (« Excellent », « Faible »…) ne changent rien à la note : ils lisent les
 * mêmes seuils que le calcul (repère d'engagement selon la taille, plafond des points,
 * seuil d'alerte).
 */
import type { StatusTone } from "@/lib/statusTone";

/** Les chiffres d'un compte utiles au score (un sous-ensemble du profil lu par le Sourcing). */
export type ScoreInput = {
  followers?: number;
  following?: number;
  er?: number | null;
  perWeek?: number | null;
  lastPost?: string | null;
  email?: string;
  agency?: string | null;
  deals?: string[];
  platform?: "youtube";
  avgViews?: number | null;
  sponsored?: number;
};

/** Ton d'un verdict : vert (bon), orange (à surveiller), gris (absent ou nul). */
export type FactorTone = Extract<StatusTone, "ok" | "wait" | "closed">;
export type ScoreFactor = { key: string; label: string; points: number; max: number; verdict: string; tone: FactorTone };
export type ScoreBreakdown = { score: number; factors: ScoreFactor[]; flags: string[]; penalty: number };

/** Points retirés par signal d'alerte. */
export const FLAG_PENALTY = 15;
/** À partir de cette note, un compte est une « pépite ». */
export const PEPITE = 70;

/** Taux d'engagement « normal » selon la taille du compte (repère public). */
export const erRef = (f: number) => (f < 10_000 ? 5 : f < 50_000 ? 3.5 : f < 200_000 ? 2.5 : f < 1_000_000 ? 1.8 : 1.2);

const DAY = 86_400_000;
/** Jours depuis le dernier post (999 = inconnu). */
const quietDays = (lastPost: string | null | undefined, now: number) => (lastPost ? (now - Date.parse(lastPost)) / DAY : 999);

/** Verdict d'un facteur « à paliers » (rythme) d'après la part des points obtenus. */
function byShare(points: number, max: number, known: boolean): Pick<ScoreFactor, "verdict" | "tone"> {
  if (!known) return { verdict: "Inconnu", tone: "closed" };
  if (points >= max) return { verdict: "Excellent", tone: "ok" };
  if (points >= max / 2) return { verdict: "Moyen", tone: "wait" };
  if (points > 0) return { verdict: "Faible", tone: "wait" };
  return { verdict: "Aucun", tone: "closed" };
}

/** Facteurs communs aux deux réseaux : partenariats, email, agence, activité. */
function common(d: ScoreInput, paid: boolean, quiet: number, activeDays: number): ScoreFactor[] {
  return [
    { key: "deals", label: "Partenariats", points: paid ? 15 : 0, max: 15, verdict: paid ? "Déjà payé" : "Aucun repéré", tone: paid ? "ok" : "closed" },
    { key: "email", label: "Email", points: d.email ? 10 : 0, max: 10, verdict: d.email ? "Trouvé" : "Absent", tone: d.email ? "ok" : "closed" },
    { key: "agency", label: "Agence", points: d.agency ? 0 : 10, max: 10, verdict: d.agency ? "En agence ?" : "Sans agence", tone: d.agency ? "wait" : "ok" },
    {
      key: "active",
      label: "Activité",
      points: quiet < activeDays ? 10 : 0,
      max: 10,
      ...(quiet < activeDays ? { verdict: "Récente", tone: "ok" as const } : quiet >= 999 ? { verdict: "Inconnue", tone: "closed" as const } : { verdict: "Pas récente", tone: "wait" as const }),
    },
  ];
}

function finish(factors: ScoreFactor[], flags: string[]): ScoreBreakdown {
  const penalty = flags.length * FLAG_PENALTY;
  const raw = factors.reduce((s, f) => s + f.points, 0) - penalty;
  return { score: Math.max(0, Math.min(100, Math.round(raw))), factors, flags, penalty };
}

/** Détail du score d'un compte Instagram. */
export function instagramBreakdown(d: ScoreInput, now = Date.now()): ScoreBreakdown {
  const f = d.followers ?? 0;
  const ref = erRef(f);
  const quiet = quietDays(d.lastPost, now);
  const ratio = d.er != null ? d.er / ref : null;
  const erPts = ratio != null ? Math.min(40, ratio * 30) : 0;
  const engagement: ScoreFactor = {
    key: "er",
    label: "Engagement",
    points: erPts,
    max: 40,
    ...(ratio == null
      ? { verdict: "Inconnu", tone: "closed" as const }
      : erPts >= 40
        ? { verdict: "Excellent", tone: "ok" as const }
        : ratio >= 1
          ? { verdict: "Bon", tone: "ok" as const }
          : ratio >= 0.25
            ? { verdict: "Faible", tone: "wait" as const }
            : { verdict: "Très bas", tone: "closed" as const }),
  };
  const rhythmPts = Math.min(15, (d.perWeek ?? 0) * 5);
  const rhythm: ScoreFactor = { key: "rhythm", label: "Rythme", points: rhythmPts, max: 15, ...byShare(rhythmPts, 15, d.perWeek != null) };
  const flags: string[] = [];
  if (ratio != null && ratio < 0.25) flags.push("Engagement très bas pour sa taille");
  if ((d.following ?? 0) > f && f < 50_000) flags.push("Suit plus de comptes qu'il n'a d'abonnés");
  if (quiet > 60 && quiet < 999) flags.push("Rien publié depuis 2 mois");
  return finish([engagement, rhythm, ...common(d, !!d.deals?.length, quiet, 14)], flags);
}

/** Détail du score d'une chaîne YouTube. */
export function youtubeBreakdown(d: ScoreInput, now = Date.now()): ScoreBreakdown {
  const f = d.followers ?? 0;
  const quiet = quietDays(d.lastPost, now);
  const vr = d.avgViews != null && f > 0 ? d.avgViews / f : null;
  const viewsPts = vr != null ? Math.min(30, (vr / 0.25) * 22) : d.avgViews ? 15 : 0; // abonnés masqués : on juge sur les vues seules
  const views: ScoreFactor = {
    key: "views",
    label: "Vues",
    points: viewsPts,
    max: 30,
    ...(vr == null
      ? d.avgViews
        ? { verdict: "Abonnés masqués", tone: "wait" as const }
        : { verdict: "Inconnu", tone: "closed" as const }
      : viewsPts >= 30
        ? { verdict: "Excellent", tone: "ok" as const }
        : vr >= 0.25
          ? { verdict: "Bon", tone: "ok" as const }
          : vr >= 0.02
            ? { verdict: "Faible", tone: "wait" as const }
            : { verdict: "Très bas", tone: "closed" as const }),
  };
  const erPts = d.er != null ? Math.min(10, (d.er / 4) * 8) : 0;
  const engagement: ScoreFactor = { key: "er", label: "Engagement", points: erPts, max: 10, ...byShare(erPts, 10, d.er != null) };
  const rhythmPts = Math.min(15, (d.perWeek ?? 0) * 10);
  const rhythm: ScoreFactor = { key: "rhythm", label: "Rythme", points: rhythmPts, max: 15, ...byShare(rhythmPts, 15, d.perWeek != null) };
  const flags: string[] = [];
  if (vr != null && vr < 0.02) flags.push("Très peu de vues pour sa taille");
  if (quiet > 90 && quiet < 999) flags.push("Aucune vidéo depuis 3 mois");
  return finish([views, engagement, rhythm, ...common(d, !!(d.deals?.length || d.sponsored), quiet, 30)], flags);
}

/** Détail du score, selon le réseau du compte. */
export const scoreBreakdown = (d: ScoreInput, now = Date.now()) => (d.platform === "youtube" ? youtubeBreakdown(d, now) : instagramBreakdown(d, now));

/** Note + signaux d'alerte (ce qu'utilisent le tri et les lignes). */
export function scoreOf(d: ScoreInput, now = Date.now()): { score: number; flags: string[] } {
  const { score, flags } = scoreBreakdown(d, now);
  return { score, flags };
}

/** Couleur de l'anneau de score : vert dès 70, orange de 40 à 69, gris en dessous. */
export const scoreTone = (score: number): FactorTone => (score >= PEPITE ? "ok" : score >= 40 ? "wait" : "closed");
