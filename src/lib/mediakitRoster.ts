/**
 * État du media kit de chaque créateur, pour la liste de l'onglet Media kit › Créateurs :
 * kit rempli, à compléter ou vide, et date des derniers chiffres réels (relevé automatique
 * ou mesure du calculateur), avec le même seuil de fraîcheur que le contrôle des kits.
 */
import { chiffresDuKit, chiffresReels, FRAICHEUR_JOURS, type CreateurKit, type Mesure } from "../../supabase/functions/_shared/mediakitControle.ts";

export type KitEtat = "rempli" | "incomplet" | "vide";

type KitBlob = {
  bio?: unknown;
  platforms?: unknown;
  rates?: unknown;
  brands?: unknown;
  photos?: Record<string, unknown> | null;
  tags?: unknown;
};

const nonVide = (v: unknown) => Array.isArray(v) && v.length > 0;

/** Rempli = une bio et au moins un nombre d'abonnés ; vide = rien de saisi. */
export function kitEtat(mediakit: unknown): KitEtat {
  const mk = (mediakit && typeof mediakit === "object" ? mediakit : {}) as KitBlob;
  const bio = typeof mk.bio === "string" && mk.bio.trim().length > 0;
  const abonnes = chiffresDuKit(mk).some((c) => c.chiffre === "abonnes");
  if (bio && abonnes) return "rempli";
  const photo = Object.values(mk.photos ?? {}).some((u) => typeof u === "string" && u.trim());
  const quelqueChose = bio || abonnes || nonVide(mk.platforms) || nonVide(mk.rates) || nonVide(mk.brands) || nonVide(mk.tags) || photo;
  return quelqueChose ? "incomplet" : "vide";
}

/** Date (AAAA-MM-JJ) du chiffre réel le plus récent du créateur, tous réseaux confondus. */
export function derniersChiffres(c: CreateurKit, mesures: Mesure[]): string | null {
  let best: string | null = null;
  for (const parPf of Object.values(chiffresReels(c, mesures))) {
    for (const r of Object.values(parPf)) {
      if (r?.date && (!best || r.date > best)) best = r.date;
    }
  }
  return best;
}

/** Chiffres trop vieux (au delà du seuil du contrôle des kits, environ 2 mois). */
export function chiffresAnciens(date: string | null, maintenant: Date = new Date()): boolean {
  if (!date) return false;
  const age = (maintenant.getTime() - Date.parse(`${date}T12:00:00Z`)) / 86_400_000;
  return age > FRAICHEUR_JOURS;
}
