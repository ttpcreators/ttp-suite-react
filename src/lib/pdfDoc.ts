/**
 * Identité des DOCUMENTS PDF de l'agence : brief, bilan de campagne, facture, contrats.
 * Une seule feuille de style pour que tout ce qui sort de l'app se ressemble, et
 * ressemble aux media kits du site (direction « Éditorial », 2026-10-07).
 *
 * Parti pris, pensé pour l'impression A4 :
 *  - Instrument Serif pour les titres et les chiffres, Instrument Sans pour le texte
 *    (les polices des media kits, servies par l'app : public/fonts/) ;
 *  - un titre en deux temps, la fin en italique bordeaux (« Nike *× Candice* ») ;
 *  - libellés en petites capitales espacées, valeurs reliées par des pointillés ;
 *  - filets fins, aucun aplat de couleur, beaucoup de blanc.
 *
 * ⚠️ Réservé au PDF (via `printHtml`, qui attend le chargement des polices). NE PAS
 * l'utiliser pour un corps d'EMAIL : Gmail/Outlook ignorent `<style>`, `@font-face`
 * et `@page` (l'email a besoin de tableaux et de styles en ligne).
 */

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

/**
 * URL ABSOLUE d'un fichier de `public/`. Absolue et non relative : les documents sont
 * rendus dans un iframe `srcdoc` (base `about:srcdoc`), où une URL relative est ambiguë.
 */
export function appAssetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  try {
    return new URL(`${base}${path}`, window.location.href).href;
  } catch {
    return `${base}${path}`;
  }
}

/** URL absolue du monogramme TTP (`public/logo.png`), pour l'en-tête des documents. */
export function ttpLogoUrl(): string {
  return appAssetUrl("logo.png");
}

/** Monogramme TTP en image (coins arrondis). */
export function ttpLogoImg(sizePx = 34): string {
  return `<img src="${esc(ttpLogoUrl())}" alt="TTP Creators" width="${sizePx}" height="${sizePx}" style="width:${sizePx}px;height:${sizePx}px;border-radius:${Math.round(sizePx / 5)}px;display:block;flex:none">`;
}

/** Date du jour au format français (« 7 octobre 2026 »). */
export function docToday(): string {
  try {
    return new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return new Date().toLocaleDateString("fr-FR");
  }
}

function fontFaces(): string {
  const f = (file: string) => esc(appAssetUrl(`fonts/${file}`));
  return (
    `@font-face{font-family:"Instrument Serif";font-style:normal;font-weight:400;font-display:block;src:url("${f("instrument-serif-normal.woff2")}") format("woff2")}` +
    `@font-face{font-family:"Instrument Serif";font-style:italic;font-weight:400;font-display:block;src:url("${f("instrument-serif-italic.woff2")}") format("woff2")}` +
    `@font-face{font-family:"Instrument Sans";font-style:normal;font-weight:400 700;font-display:block;src:url("${f("instrument-sans-normal.woff2")}") format("woff2")}`
  );
}

/**
 * Feuille de style COMMUNE à tous les documents. Les documents particuliers (facture,
 * contrats) ajoutent leurs règles propres après celle-ci, avec les mêmes jetons.
 */
const BASE_CSS = `
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
:root{
  --ink:#121212; --grey:#6e6e6b; --faint:#a3a39e; --soft:#e4e4e0; --accent:#4a0a0e;
  --serif:"Instrument Serif","Iowan Old Style",Georgia,"Times New Roman",serif;
  --sans:"Instrument Sans","Helvetica Neue",Helvetica,Arial,sans-serif;
}
html,body{margin:0;background:#fff}
body{font-family:var(--sans);color:var(--ink);font-size:9.6pt;line-height:1.6;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.wrap{max-width:182mm;margin:0 auto;padding:14mm 12mm}
i,em{font-style:italic}
.tnum{font-variant-numeric:tabular-nums}

/* En-tête : monogramme + « TTP Creators » à gauche, type de document / référence à droite. */
.mast{display:flex;align-items:center;justify-content:space-between;gap:8mm;
  padding-bottom:4mm;border-bottom:.5pt solid var(--soft)}
.mast .id{display:flex;align-items:center;gap:2.8mm}
.mast .wm{font-family:var(--serif);font-size:15pt;line-height:1;letter-spacing:-.01em;white-space:nowrap}
.mast .wm i{color:var(--accent)}
.mast .tl{margin-top:1mm;font-size:6.8pt;letter-spacing:.18em;text-transform:uppercase;color:var(--grey)}
.mast .r{text-align:right;font-size:6.8pt;letter-spacing:.18em;text-transform:uppercase;color:var(--grey);line-height:1.8}
.mast .r b{color:var(--ink);font-weight:600}

/* Bloc titre : petit libellé, grand titre serif dont la fin est en italique bordeaux. */
.kicker{font-size:7pt;letter-spacing:.24em;text-transform:uppercase;color:var(--grey);margin:13mm 0 3.5mm}
h1{font-family:var(--serif);font-weight:400;font-size:36pt;line-height:.98;letter-spacing:-.02em;margin:0;text-wrap:balance}
h1 i{color:var(--accent)}
.sub{margin:3.5mm 0 0;font-family:var(--serif);font-size:13pt;line-height:1.3;color:var(--grey)}

/* Informations : libellé · pointillés · valeur (comme les lignes des media kits). */
.meta{margin:9mm 0 0;padding:0}
.meta .row{display:flex;align-items:baseline;gap:3mm;padding:1.9mm 0;break-inside:avoid}
.meta dt{margin:0;font-size:8.6pt;color:var(--grey);white-space:nowrap}
.meta .lead{flex:1;min-width:6mm;border-bottom:.7pt dotted var(--faint);transform:translateY(-.9mm)}
.meta dd{margin:0;font-family:var(--serif);font-size:12.5pt;line-height:1.25;text-align:right;max-width:62%}

/* Sections : filet fin, petit libellé espacé, puis le contenu. */
.sec{margin-top:9mm;padding-top:4.5mm;border-top:.5pt solid var(--soft)}
.sec>h2{margin:0 0 3.5mm;font-size:7pt;font-weight:600;letter-spacing:.24em;text-transform:uppercase;color:var(--grey);break-after:avoid}
.pre{white-space:pre-wrap;font-size:9.8pt;line-height:1.72}
.lede{font-family:var(--serif);font-size:13pt;line-height:1.42;white-space:pre-wrap}
.muted{color:var(--grey)}

/* Chiffres clés : grands chiffres serif, séparés par des filets verticaux. */
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:5mm 0}
.kpi{padding:0 4mm;border-left:.5pt solid var(--soft);break-inside:avoid}
.kpi:nth-child(4n+1){border-left:0;padding-left:0}
.kpi .n{display:block;font-family:var(--serif);font-size:24pt;line-height:1;color:var(--accent);
  font-variant-numeric:tabular-nums;white-space:nowrap}
.kpi .c{display:block;margin-top:1.8mm;font-size:7.6pt;line-height:1.35;color:var(--grey)}

/* Liste à tirets */
ul.ticks{margin:0;padding:0;list-style:none}
ul.ticks li{position:relative;padding-left:6mm;margin:0 0 2.2mm;break-inside:avoid}
ul.ticks li::before{content:"—";position:absolute;left:0;color:var(--accent)}

/* Bandeau chiffré du bilan : budget → CA, retour sur investissement. */
.money{display:flex;align-items:flex-end;gap:7mm;flex-wrap:wrap;margin-top:9mm;padding:5mm 0;
  border-top:.5pt solid var(--soft);border-bottom:.5pt solid var(--soft)}
.money .k{display:block;font-size:7pt;letter-spacing:.22em;text-transform:uppercase;color:var(--grey);margin-bottom:1.6mm}
.money b{display:block;font-family:var(--serif);font-weight:400;font-size:24pt;line-height:1;white-space:nowrap}
.money .arrow{font-family:var(--serif);font-size:20pt;line-height:1;color:var(--faint);padding-bottom:.6mm}
.money .roi{margin-left:auto;text-align:right}
.money .roi b{color:var(--accent)}

/* Annexe de captures */
.shots{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}
.shots figure{margin:0;border:.5pt solid var(--soft);border-radius:1.5mm;overflow:hidden;
  height:56mm;display:grid;place-items:center;background:#fafaf8;break-inside:avoid}
.shots img{width:100%;height:100%;object-fit:contain;display:block}

/* Pied de document */
.foot{margin-top:12mm;padding-top:3.5mm;border-top:.5pt solid var(--soft);display:flex;justify-content:space-between;
  gap:6mm;font-size:6.8pt;letter-spacing:.16em;text-transform:uppercase;color:var(--faint)}

/* Numéro de page en marge (navigateurs qui le gèrent, dont Chrome). */
@page{size:A4;margin:14mm 14mm 16mm;
  @bottom-right{content:counter(page) " / " counter(pages);font-family:"Instrument Sans",Helvetica,Arial,sans-serif;
    font-size:7pt;letter-spacing:.12em;color:#a3a39e}}
@media print{.wrap{max-width:none;padding:0}}
`;

/** `<head>` complet : titre (= nom de fichier proposé), polices, style commun + style propre. */
export function docHead(title: string, extraCss = ""): string {
  return (
    `<!doctype html><html lang="fr"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${esc(title)}</title><style>${fontFaces()}${BASE_CSS}${extraCss}</style></head>`
  );
}

/** En-tête commun. `right` = lignes de droite, DÉJÀ échappées (type de document, référence, date…). */
export function docMast(right: string[], tagline = "Talent management · Lyon et Genève", name = "TTP Creators"): string {
  // « TTP AGENCY » → « TTP <i>Agency</i> » : premier mot droit, la suite en italique.
  const [first, ...rest] = name.trim().split(/\s+/);
  const tail = rest.join(" ");
  const wm = esc(first) + (tail ? ` <i>${esc(tail === tail.toUpperCase() ? tail.charAt(0) + tail.slice(1).toLowerCase() : tail)}</i>` : "");
  return (
    `<header class="mast"><span class="id">${ttpLogoImg(30)}<span><span class="wm">${wm}</span>` +
    `<span class="tl" style="display:block">${esc(tagline)}</span></span></span>` +
    `<span class="r">${right.filter(Boolean).join("<br>")}</span></header>`
  );
}

/** Pied commun. */
export function docFoot(left = "TTP Creators · Trust The Process", right = "partnerships@ttpcreators.pro"): string {
  return `<footer class="foot"><span>${esc(left)}</span><span>${esc(right)}</span></footer>`;
}

/**
 * Titre en deux temps : `main` droit, `tail` en italique bordeaux.
 * Les deux sont échappés ici.
 */
export function docTitle(main: string, tail?: string): string {
  return esc(main) + (tail ? ` <i>${esc(tail)}</i>` : "");
}

/** Titre dont le DERNIER mot passe en italique bordeaux (« Cession de droits *UGC* »). */
export function docTitleLastWord(title: string): string {
  const words = title.trim().split(/\s+/);
  if (words.length < 2) return esc(title);
  return docTitle(words.slice(0, -1).join(" "), words[words.length - 1]);
}

/**
 * Règles propres aux CONTRATS (Marque × Créateur, UGC, représentation), à ajouter après
 * le style commun : parties, articles numérotés, signatures, mentions légales.
 */
export const CONTRACT_CSS = `
.parties{margin-top:6mm;font-size:9.2pt;line-height:1.6;color:var(--grey);max-width:150mm}
.parties .p1{color:var(--ink);font-family:var(--serif);font-size:13pt;line-height:1.3;margin-bottom:1.5mm}
.arts{margin-top:9mm;padding-top:4.5mm;border-top:.5pt solid var(--soft)}
.art{margin:0 0 5.5mm;break-inside:avoid}
.art h3,.art h2{display:flex;gap:3mm;align-items:baseline;margin:0 0 1.6mm;font-size:9.8pt;font-weight:600;
  letter-spacing:0;text-transform:none;color:var(--ink);break-after:avoid}
.art .n{font-family:var(--serif);font-style:italic;font-weight:400;font-size:13pt;color:var(--accent);
  font-variant-numeric:tabular-nums;min-width:7mm}
.art p{margin:0 0 1.8mm;color:#2c2c2a;line-height:1.66}
.art ul{margin:1.5mm 0 2mm;padding-left:5mm}
.art li{margin:.8mm 0;color:#2c2c2a}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:14mm;margin-top:12mm;break-inside:avoid}
.sign .who{font-size:7pt;font-weight:600;letter-spacing:.24em;text-transform:uppercase;color:var(--grey)}
.sign .name{margin-top:1.2mm;font-family:var(--serif);font-size:13pt}
.sign .line{height:17mm;border-bottom:.6pt solid var(--ink)}
.sign .cap{margin-top:1.8mm;font-size:7.6pt;color:var(--faint)}
.signtext{margin-top:12mm;padding-top:4.5mm;border-top:.5pt solid var(--soft);white-space:pre-line;line-height:1.75;break-inside:avoid}
.legal{margin-top:10mm;padding-top:3.5mm;border-top:.5pt solid var(--soft);font-size:7.6pt;line-height:1.6;color:var(--faint)}
`;

/** Enveloppe complète d'un document simple (brief, bilan). `title` = nom de fichier proposé. */
export function pdfShell(o: {
  title: string;
  eyebrow: string;
  heading: string;
  sub?: string;
  ref?: string;
  body: string;
}): string {
  return (
    docHead(o.title) +
    `<body><div class="wrap">` +
    docMast([o.ref ? `<b>Réf. ${esc(o.ref)}</b>` : "", esc(docToday())]) +
    `<p class="kicker">${esc(o.eyebrow)}</p>` +
    `<h1>${o.heading}</h1>` +
    (o.sub ? `<p class="sub">${esc(o.sub)}</p>` : "") +
    o.body +
    docFoot() +
    `</div></body></html>`
  );
}

/** Titre « Marque × Créateur » : la partie créateur en italique bordeaux. */
export function pdfHeading(left: string, right?: string): string {
  return docTitle(left, right ? `× ${right}` : undefined);
}

/** Informations en lignes à pointillés (les valeurs vides sont ignorées). */
export function pdfMeta(rows: [string, string | null | undefined][]): string {
  const keep = rows.filter(([, v]) => v && String(v).trim() && String(v).trim() !== "—");
  if (!keep.length) return "";
  return (
    `<dl class="meta">` +
    keep.map(([l, v]) => `<div class="row"><dt>${esc(l)}</dt><span class="lead"></span><dd>${esc(v)}</dd></div>`).join("") +
    `</dl>`
  );
}

export function pdfSection(label: string, inner: string): string {
  return `<section class="sec"><h2>${esc(label)}</h2>${inner}</section>`;
}

export function pdfKpis(items: { l: string; v: string }[]): string {
  const keep = items.filter((k) => k.v && k.v.trim() && k.v.trim() !== "—");
  if (!keep.length) return "";
  return `<div class="kpis">${keep
    .map((k) => `<div class="kpi"><span class="n">${esc(k.v)}</span><span class="c">${esc(k.l)}</span></div>`)
    .join("")}</div>`;
}

export function pdfTicks(items: string[]): string {
  const keep = items.filter(Boolean);
  if (!keep.length) return "";
  return `<ul class="ticks">${keep.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>`;
}

export function pdfShots(urls: string[]): string {
  if (!urls.length) return "";
  return `<div class="shots">${urls.map((u) => `<figure><img src="${esc(u)}" alt=""></figure>`).join("")}</div>`;
}
