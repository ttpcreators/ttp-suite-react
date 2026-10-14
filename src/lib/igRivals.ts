/**
 * Agences concurrentes (Sourcing → Concurrents), table `ig_rivals` remplie par
 * ig-sourcing : relevé d'abonnés jour par jour, créatrices mises en avant, marques.
 */

export type RivalPoint = { d: string; f: number; p?: number };
export type RivalCreator = { u: string; n: number; src: "posts" | "bio"; last: string; url: string; name: string; followers: number | null; er: number | null; picture: string };
export type RivalBrand = { u: string; n: number; paid: number; via: string[]; last: string; url: string; sure: boolean; name: string; followers: number | null; picture: string };
export type Rival = {
  username: string;
  self: boolean;
  data: { name?: string; followers?: number; posts?: number; er?: number | null; perWeek?: number | null; lastPost?: string | null; bio?: string; website?: string; picture?: string } | null;
  history: RivalPoint[];
  creators: RivalCreator[];
  brands: RivalBrand[];
  why: string | null;
  added_at: string;
  read_at: string | null;
};

const DAY = 86400000;

/**
 * Évolution des abonnés sur `days` jours : écart avec le relevé le plus proche de
 * « il y a `days` jours » (pas plus récent). null s'il n'y a pas assez d'historique
 * (moins de la moitié de la période couverte).
 */
export function growth(history: RivalPoint[], days: number): { abs: number; pct: number; days: number } | null {
  const pts = [...history].filter((x) => x?.d && Number.isFinite(x.f)).sort((a, b) => a.d.localeCompare(b.d));
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1];
  const target = Date.parse(last.d) - days * DAY;
  const before = pts.filter((x) => Date.parse(x.d) <= target);
  const base = before.length ? before[before.length - 1] : pts[0];
  const span = Math.round((Date.parse(last.d) - Date.parse(base.d)) / DAY);
  if (span < Math.max(1, days / 2) || base.f <= 0) return null;
  const abs = last.f - base.f;
  return { abs, pct: Math.round((abs / base.f) * 1000) / 10, days: span };
}

/** Points d'une petite courbe (SVG) : chemin « x,y » dans une boîte w × h. */
export function sparkPoints(history: RivalPoint[], w: number, h: number, max = 90): string {
  const pts = [...history].sort((a, b) => a.d.localeCompare(b.d)).slice(-max);
  if (pts.length < 2) return "";
  const lo = Math.min(...pts.map((p) => p.f));
  const hi = Math.max(...pts.map((p) => p.f));
  const range = hi - lo || 1;
  return pts.map((p, i) => `${((i / (pts.length - 1)) * w).toFixed(1)},${(h - ((p.f - lo) / range) * (h - 2) - 1).toFixed(1)}`).join(" ");
}

const AGENCY_WORD = /(agency|agence|mgmt|management|talents?|booking|models)/i;
/**
 * Comptes d'agence cités dans les indices « déjà en agence » des profils lus par le
 * Sourcing (« mgmt @wonder.agency », « géré par wondertalents »…), du plus cité au
 * moins cité. Sert à proposer les agences à suivre.
 */
export function agencyCandidates(hints: string[], skip: Set<string>): { u: string; n: number }[] {
  const count = new Map<string, number>();
  for (const h of hints) {
    const seen = new Set<string>();
    for (const m of h.toLowerCase().matchAll(/@?([a-z0-9._]{3,30})/g)) {
      const u = m[1].replace(/^[._]+|[._]+$/g, "");
      const explicit = m[0].startsWith("@");
      if (!u || skip.has(u) || seen.has(u) || /^\d+$/.test(u) || u.includes("..")) continue;
      // Un email (« contact@agence.fr ») n'est pas un compte.
      if (explicit && /[a-z0-9]$/.test(h.toLowerCase().slice(0, m.index ?? 0))) continue;
      if (/\.(com|fr|net|org|io|co|be|ch|uk)$/.test(u)) continue;
      if (!explicit && !AGENCY_WORD.test(u)) continue;
      // « agency », « management »… seuls ne désignent pas un compte : il faut un nom autour.
      if (!explicit && u.replace(/(agency|agence|mgmt|management|talents?|booking|models)/gi, "").replace(/[._]/g, "").length < 3) continue;
      seen.add(u);
      count.set(u, (count.get(u) ?? 0) + 1);
    }
  }
  return [...count.entries()].map(([u, n]) => ({ u, n })).sort((a, b) => b.n - a.n || a.u.localeCompare(b.u));
}
