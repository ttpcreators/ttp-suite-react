// ============================================================================
// _shared/mediakitChiffres.ts : mise à jour des CHIFFRES d'un media kit (outil
// maj_chiffres_mediakit du connecteur, utilisé par Alfred le 1er du mois après le « oui »
// de Marc). Ne touche qu'aux chiffres d'UNE plateforme (abonnés, engagement, vues) :
// la bio, les marques, les tarifs, les photos et les autres réseaux restent tels quels.
// Même format que ig-sync / tt-sync / yt-sync (chaînes, engagement « 4,25% »).
// Logique pure, testée par mediakitChiffres.test.ts.
// ============================================================================

type Json = Record<string, unknown>;

export const PLATEFORMES_KIT = ["instagram", "tiktok", "youtube"] as const;

export type ChiffresKit = {
  plateforme: string;
  abonnes?: unknown;
  engagement?: unknown;
  vues_moyennes?: unknown;
  vues_story?: unknown;
};

/** « 12 345 », « 12,3k », 12345 → 12345 ; null si illisible ou négatif. */
export function nombre(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  const s = String(v).trim().toLowerCase().replace(/\s/g, "").replace(",", ".");
  const m = /^(\d+(?:\.\d+)?)([km])?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] === "m" ? 1_000_000 : m[2] === "k" ? 1_000 : 1);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** « 4.256 », « 4,26 % » → « 4,26% » (le format des relevés automatiques) ; null si illisible. */
export function pourcentage(v: unknown): string | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace("%", "").replace(",", ".").trim());
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return `${n.toFixed(2).replace(".", ",")}%`;
}

/** Applique les chiffres à la plateforme. Renvoie le nouveau media kit et la liste « avant → après ». */
export function appliquerChiffres(mk: unknown, c: ChiffresKit): { mediakit: Json; changements: string[] } | { error: string } {
  const key = String(c.plateforme ?? "").trim().toLowerCase();
  if (!(PLATEFORMES_KIT as readonly string[]).includes(key)) return { error: "Plateforme : instagram, tiktok ou youtube." };
  const kit: Json = mk && typeof mk === "object" && !Array.isArray(mk) ? { ...(mk as Json) } : {};
  const platforms = Array.isArray(kit.platforms) ? [...(kit.platforms as Json[])] : [];
  let i = platforms.findIndex((p) => p && typeof p === "object" && String(p.key ?? "").toLowerCase() === key);
  const bloc: Json = i === -1 ? { key } : { ...platforms[i] };

  const champs: [string, string, string | null, unknown][] = [
    ["followers", "abonnés", c.abonnes == null || c.abonnes === "" ? null : nombre(c.abonnes) == null ? "x" : String(nombre(c.abonnes)), c.abonnes],
    ["er", "engagement", c.engagement == null || c.engagement === "" ? null : pourcentage(c.engagement) ?? "x", c.engagement],
    ["avgViews", "vues moyennes", c.vues_moyennes == null || c.vues_moyennes === "" ? null : nombre(c.vues_moyennes) == null ? "x" : String(nombre(c.vues_moyennes)), c.vues_moyennes],
    ["avgStoryViews", "vues des stories", c.vues_story == null || c.vues_story === "" ? null : nombre(c.vues_story) == null ? "x" : String(nombre(c.vues_story)), c.vues_story],
  ];
  const illisible = champs.find(([, , v]) => v === "x");
  if (illisible) return { error: `Chiffre illisible pour ${illisible[1]} : « ${String(illisible[3])} ».` };
  const changements: string[] = [];
  for (const [champ, libelle, v] of champs) {
    if (v == null || String(bloc[champ] ?? "") === v) continue;
    changements.push(`${libelle} : ${String(bloc[champ] ?? "vide")} → ${v}`);
    bloc[champ] = v;
  }
  if (!changements.length) return { mediakit: kit, changements };
  if (i === -1) {
    platforms.push(bloc);
    i = platforms.length - 1;
  } else platforms[i] = bloc;
  return { mediakit: { ...kit, platforms }, changements };
}
