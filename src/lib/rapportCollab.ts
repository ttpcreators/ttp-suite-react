/**
 * Rapport de fin de collab pour la marque (demande de Marc, 24 novembre 2026) : Alfred écrit les
 * données dans un fichier `.rapport.json`, ce module en fait le document, avec l'identité commune
 * des PDF de l'app (`pdfDoc.ts` : celle des bilans et des media kits). Rien d'inventé : un chiffre
 * absent n'apparaît pas, une rubrique vide disparaît.
 *
 * Embarqué dans `agents/alfred/contrats.mjs` (npm run alfred:contrats) pour qu'Alfred fabrique sur
 * l'iMac exactement le document que l'app ferait.
 */
import { esc, pdfFileTitle, pdfHeading, pdfKpis, pdfMeta, pdfSection, pdfShell, pdfTicks } from "./pdfDoc";

export type RapportPost = {
  reseau?: string;
  format?: string;
  date?: string;
  lien?: string;
  vues?: number | null;
  couverture?: number | null;
  likes?: number | null;
  commentaires?: number | null;
  partages?: number | null;
  enregistrements?: number | null;
};

export type RapportCollab = {
  marque: string;
  createur: string;
  /** « Publié le 12 novembre 2026, chiffres relevés le 19 novembre » */
  periode?: string;
  livrables?: string;
  /** Les chiffres clés, quatre au plus : « 182 000 » / « Vues, 2,1 fois sa moyenne ». */
  chiffres?: { valeur: string; libelle: string }[];
  posts?: RapportPost[];
  /** Captures : adresse https (vignette TikTok) ou fichier de l'iMac (capture de l'araignée, photo envoyée), converti par telegram.mjs. */
  captures?: { url: string; legende?: string }[];
  points_forts?: string[];
  enseignements?: string[];
  /** La proposition pour la suite (format en plus, série, deuxième créateur). */
  suite?: string;
};

const nb = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v).toLocaleString("fr-FR").replace(/ /g, " ") : "");
const httpsOk = (u: unknown) => typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u);
/** Une image : en ligne (https), ou un fichier de l'iMac déjà vérifié par telegram.mjs (file://). */
const imageOk = (u: unknown) => httpsOk(u) || (typeof u === "string" && /^file:\/\/\/[^"'<>]+\.(jpe?g|png|webp)$/i.test(u));
const liste = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : []);

const COLONNES: [keyof RapportPost, string][] = [
  ["vues", "Vues"],
  ["couverture", "Couverture"],
  ["likes", "Likes"],
  ["commentaires", "Commentaires"],
  ["partages", "Partages"],
  ["enregistrements", "Enreg."],
];

/** Le tableau post par post : seulement les colonnes qui ont au moins un chiffre. */
function tableauPosts(posts: RapportPost[]): string {
  const cols = COLONNES.filter(([k]) => posts.some((p) => nb(p[k])));
  const st = "border-bottom:.5pt solid var(--soft);padding:1.8mm 1.5mm;";
  const head = `<tr><th style="${st}text-align:left;font-weight:500;color:var(--grey)">Publication</th>${cols.map(([, l]) => `<th style="${st}text-align:right;font-weight:500;color:var(--grey)">${esc(l)}</th>`).join("")}</tr>`;
  const rows = posts
    .map((p) => {
      const titre = [p.reseau, p.format, p.date].map((x) => String(x ?? "").trim()).filter(Boolean).join(" · ") || "Publication";
      const cellule = httpsOk(p.lien) ? `<a href="${esc(p.lien)}" style="color:var(--ink)">${esc(titre)}</a>` : esc(titre);
      return `<tr><td style="${st}">${cellule}</td>${cols.map(([k]) => `<td style="${st}text-align:right;font-variant-numeric:tabular-nums">${esc(nb(p[k]) || "")}</td>`).join("")}</tr>`;
    })
    .join("");
  return `<table style="width:100%;border-collapse:collapse;font-size:8.8pt">${head}${rows}</table>`;
}

/** Les contenus : trois images au plus (cadres de même hauteur que les captures des bilans ; la légende sert de texte alternatif). */
function captures(items: { url: string; legende?: string }[]): string {
  return (
    `<div class="shots">` +
    items
      .map((c) => `<figure><img src="${esc(c.url)}" alt="${esc(c.legende ?? "")}"></figure>`)
      .join("") +
    `</div>`
  );
}

/** Données d'Alfred → HTML du rapport, ou la raison du refus. */
export function renderRapportCollab(input: unknown): { html: string; titre: string } | { erreur: string } {
  const d = (input && typeof input === "object" ? input : {}) as Partial<RapportCollab>;
  const marque = String(d.marque ?? "").trim();
  const createur = String(d.createur ?? "").trim();
  if (!marque || !createur) return { erreur: "il manque la marque ou le créateur" };
  const chiffres = (Array.isArray(d.chiffres) ? d.chiffres : [])
    .map((c) => ({ v: String(c?.valeur ?? "").trim(), l: String(c?.libelle ?? "").trim() }))
    .filter((c) => c.v && c.l)
    .slice(0, 4);
  const posts = (Array.isArray(d.posts) ? d.posts : []).filter((p) => p && typeof p === "object").slice(0, 12);
  const caps = (Array.isArray(d.captures) ? d.captures : []).filter((c) => imageOk(c?.url)).slice(0, 3);
  if (!chiffres.length && !posts.length) return { erreur: "aucun chiffre : le rapport attend les stats de la collab (stats_collab)" };
  const titre = pdfFileTitle("Rapport", `${marque} x ${createur}`);
  const body =
    pdfMeta([
      ["Créateur", createur],
      ["Livrables", String(d.livrables ?? "").trim()],
    ]) +
    (chiffres.length ? pdfSection("Les chiffres clés", pdfKpis(chiffres)) : "") +
    (posts.length ? pdfSection("Post par post", tableauPosts(posts)) : "") +
    (caps.length ? pdfSection("Les contenus", captures(caps)) : "") +
    (liste(d.points_forts).length ? pdfSection("Ce qui a marché", pdfTicks(liste(d.points_forts))) : "") +
    (liste(d.enseignements).length ? pdfSection("Ce que nous en retenons", pdfTicks(liste(d.enseignements))) : "") +
    (String(d.suite ?? "").trim() ? pdfSection("Pour la suite", `<p class="lede">${esc(String(d.suite).trim())}</p>`) : "");
  const html = pdfShell({
    title: titre,
    eyebrow: "Rapport de collaboration",
    heading: pdfHeading(marque, createur),
    sub: String(d.periode ?? "").trim() || undefined,
    body,
  });
  return { html, titre };
}
