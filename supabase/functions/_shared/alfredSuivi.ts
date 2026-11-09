// ============================================================================
// _shared/alfredSuivi.ts : logique pure (testée) de deux outils d'Alfred.
//  1. Les droits d'utilisation vendus aux marques (registre `usageRights` du blob agence) :
//     état de chaque droit (en cours, finit bientôt, expiré) pour facturer les prolongations.
//  2. Les posts des créateurs qui cartonnent : un post récent qui fait au moins deux fois
//     ses chiffres habituels, pour relancer les marques au bon moment.
// ============================================================================

type Json = Record<string, unknown>;

// ── 1. Droits d'utilisation ─────────────────────────────────────────────────

export type DroitUsage = {
  id: string;
  marque: string;
  createur: string;
  /** organique (repost par la marque), publicite (ads, whitelisting), les deux… texte libre court. */
  type: string;
  /** AAAA-MM-JJ */
  debut: string;
  /** AAAA-MM-JJ */
  fin: string;
  contenu?: string;
  collab_id?: string;
  prix?: string;
  note?: string;
  /** Prolongation facturée ou refusée : le droit ne remonte plus. */
  clos?: boolean;
  maj?: string;
};

export type EtatDroit = "en_cours" | "bientot" | "expire" | "clos" | "sans_date";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const jours = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

/** État d'un droit à une date : expiré, finit dans `prevenir` jours ou moins, en cours. */
export function etatDroit(d: Pick<DroitUsage, "fin" | "clos">, today: string, prevenir = 21): { etat: EtatDroit; jours: number | null } {
  if (d.clos) return { etat: "clos", jours: null };
  if (!ISO.test(d.fin ?? "")) return { etat: "sans_date", jours: null };
  const n = jours(today, d.fin);
  if (n < 0) return { etat: "expire", jours: n };
  if (n <= prevenir) return { etat: "bientot", jours: n };
  return { etat: "en_cours", jours: n };
}

/** Lit la liste du blob sans planter sur une valeur bizarre. */
export function lireDroits(v: unknown): DroitUsage[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is DroitUsage => !!x && typeof x === "object" && typeof (x as Json).id === "string" && typeof (x as Json).marque === "string");
}

/** Texte de l'outil : expirés d'abord (argent à aller chercher), puis ceux qui finissent bientôt, puis le reste. */
export function droitsTexte(list: DroitUsage[], today: string, filtre = ""): string {
  const f = filtre.trim().toLowerCase();
  const rows = list
    .filter((d) => !f || `${d.marque} ${d.createur}`.toLowerCase().includes(f))
    .map((d) => ({ d, ...etatDroit(d, today) }));
  const ordre: Record<EtatDroit, number> = { expire: 0, bientot: 1, en_cours: 2, sans_date: 3, clos: 4 };
  rows.sort((a, b) => ordre[a.etat] - ordre[b.etat] || String(a.d.fin).localeCompare(String(b.d.fin)));
  const libelle = (r: (typeof rows)[number]) =>
    r.etat === "expire" ? `EXPIRÉ depuis ${-(r.jours ?? 0)} j` : r.etat === "bientot" ? `finit dans ${r.jours} j` : r.etat === "clos" ? "clos" : r.etat === "sans_date" ? "sans date de fin" : `en cours (${r.jours} j)`;
  const line = (r: (typeof rows)[number]) =>
    `- ${r.d.marque} × ${r.d.createur} · ${r.d.type || "droits"} · ${r.d.debut || "?"} → ${r.d.fin || "?"} · ${libelle(r)}${r.d.prix ? ` · ${r.d.prix}` : ""}${r.d.contenu ? ` · ${r.d.contenu}` : ""}${r.d.note ? ` · ${r.d.note}` : ""} · id ${r.d.id}`;
  const expire = rows.filter((r) => r.etat === "expire").length;
  const bientot = rows.filter((r) => r.etat === "bientot").length;
  return [
    `# Droits d'utilisation · ${rows.length} · ${expire} expiré(s) · ${bientot} qui finissent dans 21 j`,
    ...rows.map(line),
    rows.length ? "" : "Aucun droit noté. Les droits se notent avec noter_droits quand une collab ou un contrat en accorde.",
  ].filter(Boolean).join("\n");
}

// ── 2. Les posts qui cartonnent ─────────────────────────────────────────────

export type PostCourt = { id?: string; url?: string; at?: string; type?: string; caption?: string; title?: string; views?: number | null; likes?: number | null; comments?: number | null; shares?: number | null };
export type PostNote = PostCourt & { score: number; habituel: number; ratio: number; mesure: "vues" | "interactions" };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const mediane = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Note chaque post par rapport aux autres posts du même compte : vues si au moins la moitié
 * des posts en ont, sinon likes + commentaires. `habituel` = médiane des AUTRES posts
 * (un seul post qui explose ne fausse pas sa propre référence).
 */
export function noterPosts(posts: PostCourt[]): PostNote[] {
  const avecVues = posts.filter((p) => (num(p.views) ?? 0) > 0).length;
  const mesure: PostNote["mesure"] = posts.length && avecVues * 2 >= posts.length ? "vues" : "interactions";
  const score = (p: PostCourt) => (mesure === "vues" ? num(p.views) ?? 0 : (num(p.likes) ?? 0) + (num(p.comments) ?? 0));
  const scores = posts.map(score);
  return posts.map((p, i) => {
    const autres = scores.filter((_, j) => j !== i && scores[j] > 0);
    const habituel = mediane(autres);
    return { ...p, score: scores[i], habituel, ratio: habituel > 0 ? Math.round((scores[i] / habituel) * 10) / 10 : 0, mesure };
  });
}

/** Les posts publiés depuis `jours` jours ou moins qui font au moins `facteur` fois l'habituel (3 posts de référence au moins). */
export function postsQuiCartonnent(posts: PostCourt[], now: Date, jours = 7, facteur = 2): PostNote[] {
  if (posts.filter((p) => p.at).length < 4) return [];
  const depuis = now.getTime() - jours * 86400000;
  return noterPosts(posts)
    .filter((p) => p.at && Date.parse(p.at) >= depuis && p.habituel > 0 && p.ratio >= facteur)
    .sort((a, b) => b.ratio - a.ratio);
}

const fr = (n: number) => Math.round(n).toLocaleString("fr-FR");
/** Une ligne lisible pour un post noté. */
export function postLigne(p: PostNote): string {
  const quand = p.at ? String(p.at).slice(0, 10) : "?";
  const texte = String(p.caption ?? p.title ?? "").replace(/\s+/g, " ").trim();
  return `${quand} · ${p.type ? `${String(p.type).toLowerCase()} · ` : ""}${fr(p.score)} ${p.mesure}${p.habituel ? ` (habituel ${fr(p.habituel)}, ×${String(p.ratio).replace(".", ",")})` : ""}${p.url ? ` · ${p.url}` : ""}${texte ? ` · « ${texte.slice(0, 140)} »` : ""}`;
}
