/**
 * Identité des DOCUMENTS PDF de l'agence (brief, debrief) — une seule feuille de style
 * pour que tout ce qui sort de l'app se ressemble.
 *
 * Parti pris « épuré », pensé pour l'impression A4 :
 *  - hiérarchie typographique forte (filets fins plutôt que cadres et aplats) ;
 *  - bordeaux de marque en TOUCHES uniquement (filet de section, chiffres, eyebrow) ;
 *  - libellés en monospace à fort interlettrage vs corps en sans — ce contraste est ce
 *    qui fait « composé » plutôt que « sorti d'un traitement de texte » ;
 *  - beaucoup de blanc : marges généreuses, pas de fond gris.
 *
 * ⚠️ Ces helpers sont réservés au PDF (via `printHtml`). NE PAS les utiliser pour un
 * corps d'EMAIL : les clients mail (Gmail/Outlook) ignorent `<style>`, la grille et
 * `@page` — l'email a besoin de tableaux et de styles en ligne.
 */

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

const CSS = `
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
:root{
  --wine:#3d0000; --ink:#141414; --muted:#6f6a68; --faint:#a8a2a0; --line:#e8e4e2;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
}
html,body{margin:0;background:#fff}
body{font-family:var(--sans);color:var(--ink);font-size:10.5pt;line-height:1.6;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:186mm;margin:0 auto;padding:14mm 12mm}
/* En-tête : marque à gauche, référence/date à droite, filet dessous. */
.mast{display:flex;align-items:baseline;justify-content:space-between;gap:8mm;
  padding-bottom:3.5mm;border-bottom:.6pt solid var(--line)}
.mast .brand,.mast .ref{font-family:var(--mono);font-size:7.5pt;letter-spacing:.18em;
  text-transform:uppercase;color:var(--faint)}
.mast .brand{color:var(--ink)}
/* Bloc titre */
.eyebrow{font-family:var(--mono);font-size:7.5pt;letter-spacing:.22em;text-transform:uppercase;
  color:var(--wine);margin:11mm 0 2.5mm}
h1{font-size:25pt;line-height:1.08;letter-spacing:-.02em;font-weight:700;margin:0;text-wrap:balance}
h1 .x{color:var(--faint);font-weight:400}
.sub{margin:2.5mm 0 0;font-size:9.5pt;color:var(--muted)}
/* Métadonnées : lignes à filets, jamais de cadres. */
.meta{margin:9mm 0 0;padding:0}
.meta .row{display:flex;align-items:baseline;justify-content:space-between;gap:8mm;
  padding:2.6mm 0;border-bottom:.6pt solid var(--line);break-inside:avoid}
.meta dt{font-family:var(--mono);font-size:7.5pt;letter-spacing:.14em;text-transform:uppercase;
  color:var(--faint);margin:0}
.meta dd{margin:0;font-size:10.5pt;font-weight:500;text-align:right}
/* Sections : petit filet bordeaux + libellé mono. */
.sec{margin-top:10mm;break-inside:avoid}
.sec>h2{font-family:var(--mono);font-size:7.5pt;letter-spacing:.2em;text-transform:uppercase;
  color:var(--wine);margin:0 0 3mm;font-weight:600}
.sec>h2::before{content:"";display:block;width:9mm;height:1.2pt;background:var(--wine);margin-bottom:3mm}
.pre{white-space:pre-wrap;font-size:10.5pt;line-height:1.75}
.muted{color:var(--muted)}
/* Chiffres clés */
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:6mm 5mm}
.kpi{break-inside:avoid}
.kpi .n{display:block;font-size:19pt;font-weight:700;letter-spacing:-.02em;color:var(--wine);
  font-variant-numeric:tabular-nums;line-height:1.1}
.kpi .c{display:block;margin-top:1.5mm;font-family:var(--mono);font-size:7pt;letter-spacing:.14em;
  text-transform:uppercase;color:var(--faint)}
/* Liste à tirets bordeaux */
ul.ticks{margin:0;padding:0;list-style:none}
ul.ticks li{position:relative;padding-left:6mm;margin:0 0 2.2mm;break-inside:avoid}
ul.ticks li::before{content:"—";position:absolute;left:0;color:var(--wine)}
/* Bandeau chiffré (budget → CA) */
.money{display:flex;align-items:baseline;gap:4mm;flex-wrap:wrap;font-size:11pt}
.money b{font-weight:700}
.money .arrow{color:var(--faint)}
.money .roi{margin-left:auto;font-family:var(--mono);font-size:8pt;letter-spacing:.14em;
  text-transform:uppercase;color:var(--wine);border:.8pt solid var(--wine);border-radius:999px;padding:1.2mm 3mm}
/* Annexe captures */
.shots{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}
.shots figure{margin:0;border:.6pt solid var(--line);border-radius:2mm;overflow:hidden;
  height:52mm;display:grid;place-items:center;break-inside:avoid}
.shots img{width:100%;height:100%;object-fit:contain;display:block}
footer{margin-top:13mm;padding-top:3.5mm;border-top:.6pt solid var(--line);
  font-family:var(--mono);font-size:7pt;letter-spacing:.14em;text-transform:uppercase;color:var(--faint)}
@page{size:A4;margin:15mm 14mm}
@media print{.wrap{max-width:none;padding:0}}
`;

/** Enveloppe complète du document. `title` = nom de fichier proposé à l'enregistrement. */
export function pdfShell(o: {
  title: string;
  eyebrow: string;
  heading: string;
  sub?: string;
  ref?: string;
  body: string;
}): string {
  const today = new Date().toLocaleDateString("fr-FR");
  return (
    `<!doctype html><html lang="fr"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${esc(o.title)}</title><style>${CSS}</style></head><body><div class="wrap">` +
    `<header class="mast"><span class="brand">TTP Creators</span>` +
    `<span class="ref">${o.ref ? esc(o.ref) + " · " : ""}${esc(today)}</span></header>` +
    `<p class="eyebrow">${esc(o.eyebrow)}</p>` +
    `<h1>${o.heading}</h1>` +
    (o.sub ? `<p class="sub">${esc(o.sub)}</p>` : "") +
    o.body +
    `<footer>TTP Creators · Trust the Process · partnerships@ttpcreators.pro</footer>` +
    `</div></body></html>`
  );
}

/** Titre « Marque × Créateur » avec le × atténué (déjà échappé). */
export function pdfHeading(left: string, right?: string): string {
  return esc(left) + (right ? ` <span class="x">×</span> ${esc(right)}` : "");
}

/** Métadonnées en lignes à filets (les valeurs vides sont ignorées). */
export function pdfMeta(rows: [string, string | null | undefined][]): string {
  const keep = rows.filter(([, v]) => v && String(v).trim() && String(v).trim() !== "—");
  if (!keep.length) return "";
  return (
    `<dl class="meta">` +
    keep.map(([l, v]) => `<div class="row"><dt>${esc(l)}</dt><dd>${esc(v)}</dd></div>`).join("") +
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
