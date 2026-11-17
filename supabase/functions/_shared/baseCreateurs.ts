// ============================================================================
// Base créateurs (façon Kolsquare) : logique commune à la page de l'app
// (src/views/BaseCreateurs.tsx) et à l'outil `base_createurs` du connecteur Claude
// (Alfred, l'araignée). Pur : aucune lecture de base ici, seulement le tri et le texte.
// ============================================================================

import { guessNiche } from "./niche.ts";

export type BaseProf = {
  name?: string; followers?: number; er?: number | null; perWeek?: number | null; lastPost?: string | null;
  bio?: string; website?: string; email?: string; agency?: string | null; deals?: string[]; cites?: string[];
  picture?: string; isBrand?: boolean; pending?: boolean; platform?: string;
};
export type BaseRow = { username: string; data: BaseProf | null; at?: string | null };
export type BaseMeta = { username: string; niche: string | null; ville: string | null; note: string | null; excluded: boolean };
export type BaseCreateur = {
  username: string; data: BaseProf; at: string | null;
  niche: string | null; ville: string | null; guessed: boolean; note: string | null; excluded: boolean;
  tag: "roster" | "scouting" | null;
};
export type BaseFiltres = {
  recherche?: string; niche?: string; ville?: string;
  abonnesMin?: number; abonnesMax?: number; engagementMin?: number;
  actif30j?: boolean; avecPartenariats?: boolean; sansAgence?: boolean; horsTtp?: boolean;
  tri?: "abonnes" | "engagement" | "recent" | "nom";
};

export const VILLES = [
  "Paris", "Marseille", "Lyon", "Toulouse", "Nice", "Nantes", "Montpellier", "Strasbourg", "Bordeaux", "Lille", "Rennes", "Reims",
  "Toulon", "Grenoble", "Dijon", "Angers", "Nîmes", "Annecy", "Biarritz", "Cannes", "Monaco", "Bruxelles", "Genève", "Lausanne",
  "Montréal", "Londres", "Dubaï", "Rouen", "Tours", "Metz", "Brest", "Caen", "Perpignan", "Ajaccio", "Clermont-Ferrand", "Saint-Étienne",
];

export const deburr = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const cleanUser = (h: string) =>
  h.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").toLowerCase();

/** Ville citée dans la bio (« 📍Lyon », « Paris / Londres ») : la première de la liste trouvée. */
export function guessVille(bio: string): string | null {
  const b = ` ${deburr(bio).replace(/[^a-z0-9]+/g, " ")} `;
  return VILLES.find((v) => b.includes(` ${deburr(v).replace(/[^a-z0-9]+/g, " ")} `)) ?? null;
}

/** Un profil lu compte dans la base : chiffres connus, pas une marque, pas en attente, pas YouTube. */
export const dansLaBase = (r: BaseRow) =>
  !!r.data && typeof r.data.followers === "number" && !r.data.isBrand && !r.data.pending && r.data.platform !== "youtube";

/** Profils lus + corrections de l'agence → créateurs de la base (niche et ville devinées si besoin). */
export function construireBase(rows: BaseRow[], meta: Record<string, BaseMeta>, roster: Set<string>, scouting: Set<string>): BaseCreateur[] {
  return rows.filter(dansLaBase).map((r) => {
    const d = r.data as BaseProf;
    const m = meta[r.username];
    const gn = m?.niche ? null : guessNiche(`${d.name ?? ""} ${d.bio ?? ""}`);
    const gv = m?.ville ? null : guessVille(d.bio ?? "");
    return {
      username: r.username, data: d, at: r.at ?? null,
      niche: m?.niche || gn, ville: m?.ville || gv, guessed: !m?.niche && !!gn,
      note: m?.note ?? null, excluded: !!m?.excluded,
      tag: roster.has(r.username) ? "roster" : scouting.has(r.username) ? "scouting" : null,
    };
  });
}

/** Filtre et trie. Les créateurs retirés (RGPD) ne sortent jamais d'ici, sauf `retires`. */
export function filtrerBase(list: BaseCreateur[], f: BaseFiltres, now = Date.now(), retires = false): BaseCreateur[] {
  const words = deburr(f.recherche ?? "").split(/\s+/).filter(Boolean);
  const month = now - 30 * 864e5;
  const niche = f.niche ? deburr(f.niche) : "";
  const ville = f.ville ? deburr(f.ville) : "";
  const out = list.filter((c) => {
    if (c.excluded !== retires) return false;
    const d = c.data;
    if (words.length) {
      const hay = deburr(`${c.username} ${d.name ?? ""} ${d.bio ?? ""} ${c.niche ?? ""} ${c.ville ?? ""} ${(d.deals ?? []).join(" ")}`);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    if (niche && deburr(c.niche ?? "") !== niche) return false;
    if (ville && deburr(c.ville ?? "") !== ville) return false;
    const fol = d.followers ?? 0;
    if (f.abonnesMin != null && fol < f.abonnesMin) return false;
    if (f.abonnesMax != null && fol >= f.abonnesMax) return false;
    if (f.engagementMin && (d.er ?? 0) < f.engagementMin) return false;
    if (f.actif30j && !(d.lastPost && Date.parse(d.lastPost) > month)) return false;
    if (f.avecPartenariats && !(d.deals ?? []).length) return false;
    if (f.sansAgence && d.agency) return false;
    if (f.horsTtp && c.tag) return false;
    return true;
  });
  const by = {
    abonnes: (a: BaseCreateur, b: BaseCreateur) => (b.data.followers ?? 0) - (a.data.followers ?? 0),
    engagement: (a: BaseCreateur, b: BaseCreateur) => (b.data.er ?? -1) - (a.data.er ?? -1),
    recent: (a: BaseCreateur, b: BaseCreateur) => Date.parse(b.at ?? "0") - Date.parse(a.at ?? "0"),
    nom: (a: BaseCreateur, b: BaseCreateur) => (a.data.name || a.username).localeCompare(b.data.name || b.username, "fr"),
  };
  return out.sort(by[f.tri ?? "abonnes"]);
}

const compactFr = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M` : n >= 1e4 ? `${Math.round(n / 1e3)} K` : String(Math.round(n));
const erFr = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`);

/** Une ligne lisible pour Claude (Alfred, l'araignée) : tout ce qu'il faut pour choisir, sans la bio entière. */
export function ligneBase(c: BaseCreateur, now = Date.now()): string {
  const d = c.data;
  const bits = [
    `@${c.username}${d.name ? ` (${d.name})` : ""}`,
    `${compactFr(d.followers ?? 0)} abonnés`,
    `engagement ${erFr(d.er)}`,
    c.niche ? `${c.niche}${c.guessed ? " (devinée)" : ""}` : "",
    c.ville ?? "",
    d.perWeek != null ? `${d.perWeek} post(s)/sem.` : "",
    d.lastPost ? `dernier post il y a ${Math.max(0, Math.round((now - Date.parse(d.lastPost)) / 864e5))} j` : "",
    d.deals?.length ? `partenariats : ${d.deals.slice(0, 5).map((b) => `@${b}`).join(" ")}` : "",
    d.agency ? `agence : ${d.agency}` : "",
    c.tag === "roster" ? "AU ROSTER" : c.tag === "scouting" ? "déjà en Scouting" : "",
    d.email ? `email : ${d.email}` : "",
    c.note ? `note TTP : ${c.note}` : "",
  ];
  return `- ${bits.filter(Boolean).join(" · ")}`;
}
