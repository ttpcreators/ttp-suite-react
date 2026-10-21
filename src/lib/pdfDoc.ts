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

/** Date du jour (« 7 octobre 2026 », ou « 7 October 2026 » pour un document en anglais). */
export function docToday(locale = "fr-FR"): string {
  try {
    return new Date().toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return new Date().toLocaleDateString(locale);
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

/**
 * Nom de fichier proposé à l'enregistrement PDF (= `<title>` du document).
 * Assemble les morceaux non vides (« Facture TTP-2026-004 », « Nike x Sarah ») avec
 * un tiret simple et retire ce qu'un nom de fichier n'accepte pas (/ : * ? " < > | …).
 */
export function pdfFileTitle(...parts: (string | null | undefined)[]): string {
  return parts
    .map((p) =>
      String(p ?? "")
        .replace(/[\u2013\u2014]/g, "-")
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join(" - ")
    .slice(0, 120)
    .trim();
}

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

/**
 * CONTRATS (Marque × Créateur, UGC, représentation) : mise en page de vrai document
 * juridique, plus sobre que les autres documents (demande de Marc, 2026-10-07 : « mal
 * alignés, trop de pages, ça fait trop IA »). Encre seule, titre centré, articles
 * « Article 1. Titre » alignés à gauche, texte justifié et coupé proprement, conditions
 * en grille sur deux colonnes, signatures côte à côte, paraphes et « Page n sur N » en
 * bas de chaque page. Les articles peuvent passer d'une page à l'autre (plus de fins de
 * page vides) ; seuls le titre d'un article et le bloc de signatures restent groupés.
 * Classes préfixées `ct-` : rien ne déborde sur la facture, le brief ou le bilan.
 */
export const CONTRACT_CSS = `
@page{margin:16mm 17mm 18mm;
  @bottom-left{content:"Paraphes\\00a0:\\00a0\\00a0\\00a0_______________\\00a0\\00a0\\00a0_______________";font-family:"Instrument Sans",Helvetica,Arial,sans-serif;
    font-size:7.4pt;letter-spacing:0;color:#8a8a85}
  @bottom-right{content:"Page " counter(page) " sur " counter(pages);font-family:"Instrument Sans",Helvetica,Arial,sans-serif;
    font-size:7.4pt;letter-spacing:0;color:#8a8a85}}
.ct{font-size:9.3pt;line-height:1.5;color:#1d1d1b}
.ct-head{display:flex;align-items:center;justify-content:space-between;gap:8mm;padding-bottom:3.2mm;border-bottom:.6pt solid var(--ink)}
.ct-head .id{display:flex;align-items:center;gap:2.6mm}
.ct-head .wm{display:block;font-family:var(--serif);font-size:14pt;line-height:1;color:var(--ink)}
.ct-head .tl{display:block;margin-top:.9mm;font-size:7.6pt;color:var(--grey)}
.ct-head .r{text-align:right;font-size:7.8pt;line-height:1.55;color:var(--grey)}
.ct-head .r b{color:var(--ink);font-weight:600}
.ct-title{margin:11mm 0 0;text-align:center}
.ct-title h1{font-family:var(--serif);font-weight:400;font-size:24pt;line-height:1.08;letter-spacing:-.005em;margin:0;text-wrap:balance}
.ct-title p{margin:2.2mm 0 0;font-size:9pt;color:var(--grey)}
.ct-intro{margin:9mm 0 0;text-align:justify;hyphens:auto;-webkit-hyphens:auto}
.ct-art{margin-top:5mm}
.ct-art>h2{margin:0 0 1.5mm;font-family:var(--sans);font-size:9.6pt;font-weight:600;line-height:1.35;letter-spacing:0;
  text-transform:none;color:var(--ink);break-after:avoid;page-break-after:avoid}
.ct-art>h3{margin:2.6mm 0 1mm;font-size:9.3pt;font-weight:600;color:var(--ink);break-after:avoid;page-break-after:avoid}
.ct-art p{margin:0 0 1.5mm;text-align:justify;hyphens:auto;-webkit-hyphens:auto;orphans:3;widows:3}
.ct-art ul{margin:.6mm 0 1.8mm;padding:0;list-style:none}
.ct-art li{position:relative;margin:0 0 .9mm;padding-left:5mm;text-align:justify;hyphens:auto;-webkit-hyphens:auto}
.ct-art li::before{content:"–";position:absolute;left:1.2mm;color:var(--grey)}
.ct-terms{display:grid;grid-template-columns:1fr 1fr;column-gap:9mm;margin:2mm 0 0;padding:0;border-bottom:.5pt solid var(--soft)}
.ct-terms>div{display:grid;grid-template-columns:30mm 1fr;gap:3mm;padding:1.6mm 0;border-top:.5pt solid var(--soft);break-inside:avoid}
.ct-terms dt{margin:0;font-size:8.4pt;color:var(--grey)}
.ct-terms dd{margin:0;font-size:9pt;color:var(--ink)}
.ct-sign{margin-top:9mm;break-inside:avoid;page-break-inside:avoid}
.ct-sign .place{margin:0 0 5mm}
.ct-sign .cols{display:grid;grid-template-columns:1fr 1fr;gap:12mm}
.ct-sign .who{font-weight:600;color:var(--ink)}
.ct-sign .det{margin-top:.6mm;min-height:9.6mm;font-size:8.8pt;line-height:1.45;color:var(--grey);white-space:pre-line}
.ct-sign .box{position:relative;margin-top:3mm;height:25mm;border:.5pt solid #cfcfca;border-radius:1mm}
.ct-sign .box img.sig{position:absolute;inset:1.5mm 3mm;width:calc(100% - 6mm);height:calc(100% - 3mm);object-fit:contain;object-position:left center}
.ct-sign .cap{margin-top:1.6mm;font-size:7.8pt;line-height:1.4;color:var(--grey)}
.ct-signtext{margin-top:9mm;white-space:pre-line;break-inside:avoid}
.ct-legal{margin-top:8mm;padding-top:3mm;border-top:.5pt solid var(--soft);font-size:7.6pt;line-height:1.5;color:var(--faint)}
`;

/** En-tête de contrat : monogramme + nom à gauche, nature du document à droite (lignes déjà échappées). */
export function contractHead(name: string, tagline: string, right: string[]): string {
  const nice = name
    .trim()
    .split(/\s+/)
    .map((w, k) => (k > 0 && w === w.toUpperCase() ? w.charAt(0) + w.slice(1).toLowerCase() : w))
    .join(" ");
  return (
    `<header class="ct-head"><span class="id">${ttpLogoImg(26)}<span><span class="wm">${esc(nice)}</span>` +
    `<span class="tl">${esc(tagline)}</span></span></span>` +
    `<span class="r">${right.filter(Boolean).join("<br>")}</span></header>`
  );
}

/** Titre de contrat centré, avec une ligne de précisions en dessous. */
export function contractTitle(title: string, sub?: string): string {
  return `<div class="ct-title"><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ""}</div>`;
}

/** Enveloppe complète d'un document simple (brief, bilan). `title` = nom de fichier proposé. */
export function pdfShell(o: {
  title: string;
  eyebrow: string;
  heading: string;
  sub?: string;
  ref?: string;
  body: string;
  /** Document en anglais (espace d'un créateur anglophone) : date et mention du bandeau. */
  lang?: "fr" | "en";
}): string {
  return (
    docHead(o.title) +
    `<body><div class="wrap">` +
    (o.lang === "en"
      ? docMast([o.ref ? `<b>Ref. ${esc(o.ref)}</b>` : "", esc(docToday("en-GB"))], "Talent management · Lyon and Geneva")
      : docMast([o.ref ? `<b>Réf. ${esc(o.ref)}</b>` : "", esc(docToday())])) +
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
