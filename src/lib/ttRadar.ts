/**
 * Radar à collabs TikTok (Sourcing → Radar à marques → TikTok) : contenus marqués
 * « partenariat rémunéré » par des créatrices en France (table tt_commercial, API
 * Commercial Content de TikTok), regroupés par marque.
 */

export type TtContent = { id: string; created: string | null; label: string | null; brands: string[]; creator: string | null; video_url: string | null; cover: string | null };
export type TtBrand = {
  key: string; // nom normalisé (clé de tt_brand_status)
  name: string; // nom affiché (le plus fréquent)
  contents: TtContent[];
  creators: string[]; // @ des créatrices, les plus fréquentes d'abord
  last: string; // date du dernier contenu (YYYY-MM-DD)
};

/** Nom de marque → clé stable : minuscules, sans accents ni ponctuation superflue. */
export const brandKey = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Regroupe les contenus par marque ; les marques payant le plus de créatrices d'abord. */
export function groupByBrand(rows: TtContent[], sinceIso?: string): TtBrand[] {
  type Acc = { names: Map<string, number>; contents: TtContent[]; creators: Map<string, number>; last: string };
  const map = new Map<string, Acc>();
  for (const r of rows) {
    if (sinceIso && (r.created ?? "") < sinceIso) continue;
    for (const raw of r.brands ?? []) {
      const key = brandKey(raw);
      if (!key) continue;
      const e: Acc = map.get(key) ?? { names: new Map(), contents: [], creators: new Map(), last: "" };
      e.names.set(raw, (e.names.get(raw) ?? 0) + 1);
      e.contents.push(r);
      if (r.creator) e.creators.set(r.creator, (e.creators.get(r.creator) ?? 0) + 1);
      if ((r.created ?? "") > e.last) e.last = r.created ?? "";
      map.set(key, e);
    }
  }
  return [...map.entries()]
    .map(([key, e]) => ({
      key,
      name: [...e.names.entries()].sort((a, b) => b[1] - a[1])[0][0],
      contents: e.contents.sort((a, b) => (b.created ?? "").localeCompare(a.created ?? "")),
      creators: [...e.creators.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u),
      last: e.last,
    }))
    .sort((a, b) => b.creators.length - a.creators.length || b.contents.length - a.contents.length || b.last.localeCompare(a.last));
}

/** @ TikTok tiré d'une fiche (« @lea », « lea », « tiktok.com/@lea ») ; "" si illisible. */
export function tiktokUser(raw?: string | null): string {
  const s = (raw ?? "").trim();
  const m = /tiktok\.com\/@([\w.]+)/i.exec(s) ?? /^@?([\w.]{2,24})$/.exec(s);
  return m ? m[1].toLowerCase() : "";
}
