// ============================================================================
// _shared/audience.ts : abonnés d'un créateur, tous réseaux (même règle que le Roster).
// Dernière mesure de chaque plateforme (blob `engagementHistory`), le chiffre du jour
// d'Instagram (creators.ig, Meta) l'emporte, TikTok / YouTube relevés (creators.tt / yt)
// seulement si aucune mesure de cette plateforme. Pur : testé par audience.test.ts.
// ============================================================================

export type EngEntry = { creator?: string; platform?: string; followers?: unknown; date?: string };
export type AudienceCreator = {
  name: string;
  followers?: unknown;
  ig?: { followers?: unknown } | null;
  tt?: { followers?: unknown } | null;
  yt?: { subscribers?: unknown } | null;
};
export type Audience = { total: number; perPlatform: Record<string, number> };

/** « 242 363 », « 56,8K », « 1.2M », 242363 → nombre (0 si illisible). */
export function parseCount(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const t = String(v ?? "").trim().replace(/\s/g, "").replace(",", ".").toUpperCase();
  const m = /^([0-9.]+)([KM]?)/.exec(t);
  if (!m) return 0;
  const n = parseFloat(m[1]) || 0;
  return m[2] === "K" ? n * 1e3 : m[2] === "M" ? n * 1e6 : n;
}

/** « jj/mm/aaaa » ou ISO → horodatage (0 si illisible). */
const ts = (d?: string) => {
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(d ?? "");
  if (fr) return new Date(+fr[3], +fr[2] - 1, +fr[1]).getTime();
  const iso = Date.parse(d ?? "");
  return Number.isFinite(iso) ? iso : 0;
};

/** Abonnés par plateforme et total, pour un créateur. */
export function audienceOf(c: AudienceCreator, history: EngEntry[]): Audience {
  const key = c.name.trim().toLowerCase();
  const mine = history.filter((h) => (h.creator ?? "").trim().toLowerCase() === key).sort((a, b) => ts(b.date) - ts(a.date));
  const per: Record<string, number> = {};
  for (const h of mine) {
    const pf = (h.platform ?? "").toLowerCase();
    if (pf && !(pf in per)) per[pf] = parseCount(h.followers);
  }
  const ig = parseCount(c.ig?.followers);
  if (ig > 0) per.instagram = ig;
  const tt = parseCount(c.tt?.followers);
  if (tt > 0 && !per.tiktok) per.tiktok = tt;
  const yt = parseCount(c.yt?.subscribers);
  if (yt > 0 && !per.youtube) per.youtube = yt;
  for (const k of Object.keys(per)) if (!(per[k] > 0)) delete per[k];
  const total = Object.values(per).reduce((a, n) => a + n, 0);
  return { total: total > 0 ? total : parseCount(c.followers), perPlatform: per };
}

/** « 634 K », « 1,2 M », « 950 » (comme l'app). */
export function compact(n: number): string {
  if (!(n > 0)) return "?";
  if (n >= 1e6) return `${(n / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M`;
  if (n >= 1e3) return `${(n / 1e3).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} K`;
  return String(Math.round(n));
}

const LABEL: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", snapchat: "Snapchat", x: "X", twitter: "X" };

/** « Instagram 242 K · TikTok 380 K » (plus grosse plateforme d'abord). */
export function perPlatformText(a: Audience): string {
  return Object.entries(a.perPlatform)
    .sort((x, y) => y[1] - x[1])
    .map(([k, n]) => `${LABEL[k] ?? k} ${compact(n)}`)
    .join(" · ");
}
