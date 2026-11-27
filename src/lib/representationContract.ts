import { CONTRACT_CSS, contractHead, contractTitle, docHead, docToday, pdfFileTitle } from "./pdfDoc";
import { sigImgHtml } from "./agencySignature";
import { RC_META, buildRepresentation, CONDITIONS_TITLE, type RcOptions } from "../../supabase/functions/_shared/representation.ts";

// Le contrat lui même (réglages, articles, texte) vit dans _shared/representation.ts : le
// connecteur (preparer_contrat, lire_contrat) relit ainsi exactement le même texte que l'app.
export * from "../../supabase/functions/_shared/representation.ts";
const esc = (s: unknown) => String(s ?? "").replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[ch] ?? ch);
function htmlBody(text: string): string {
  return esc(text)
    .split("\n")
    .map((l) => (l.startsWith("• ") ? `<li>${l.slice(2)}</li>` : l.trim() === "" ? "" : `<p>${l}</p>`))
    .join("")
    .replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`);
}

/** « CONTRAT DE REPRÉSENTATION » → « Contrat de représentation » (titre en capitales → phrase). */
function sentence(s: string): string {
  const low = s.trim().toLowerCase();
  return low.charAt(0).toUpperCase() + low.slice(1);
}

/** « Article 7 bis » → 7.1 (pour remettre les articles dans l'ordre) ; sans numéro → -1. */
function articleRank(n: string): number {
  const m = /(\d+)\s*(bis|ter|quater)?/i.exec(n || "");
  if (!m) return -1;
  const extra: Record<string, number> = { bis: 0.1, ter: 0.2, quater: 0.3 };
  return Number(m[1]) + (extra[(m[2] || "").toLowerCase()] ?? 0);
}

/**
 * Signatures : « Fait à … » puis un bloc par partie, côte à côte, avec un cadre pour
 * signer. Le texte vient tel quel de RC_META.signatures ; seules les lignes de
 * soulignés sont remplacées par le cadre. Format inattendu → texte brut, sans perte.
 */
function signaturesHTML(text: string): string {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const parties = paras.filter((p) => /^Pour\s/.test(p));
  if (parties.length !== 2) return `<div class="ct-signtext">${esc(text)}</div>`;
  const place = paras.filter((p) => !/^Pour\s/.test(p) && !/^_{3,}/.test(p) && !/\(signature/i.test(p));
  const note = paras.find((p) => /\(signature/i.test(p))?.replace(/^_{3,}\s*/, "").trim() ?? "";
  const col = (p: string, withNote: boolean) => {
    const [who, ...rest] = p.split("\n");
    // Cadre de l'agence : signature posée d'office (Paramètres → Signature).
    const sig = /TTP|agence/i.test(who) ? sigImgHtml() : "";
    return `<div><div class="who">${esc(who)}</div>${rest.length ? `<div class="det">${esc(rest.join("\n"))}</div>` : ""}<div class="box">${sig}</div>${withNote && note ? `<div class="cap">${esc(note)}</div>` : ""}</div>`;
  };
  return `<div class="ct-sign">${place.map((p) => `<p class="place">${esc(p)}</p>`).join("")}<div class="cols">${col(parties[0], false)}${col(parties[1], true)}</div></div>`;
}

/** Contrat HTML imprimable (PDF) : mise en page « contrat » commune (CONTRACT_CSS, pdfDoc.ts). `signe` : jamais « CONTRAT TEST ». */
export function representationHTML(config: Record<string, string>, opts: RcOptions = {}): string {
  const c = buildRepresentation(config, opts);
  // Articles remis dans l'ordre des numéros (« 7 bis » après le 7), et ceux qui partagent
  // un numéro (« Fin et résiliation », « … faute grave », « … clause pénale ») regroupés
  // sous un seul titre, la précision devenant un sous-titre. Le texte ne change pas.
  const indexed = c.articles.map((a, idx) => ({ ...a, idx, rank: articleRank(a.number) }));
  const head = indexed.filter((a) => a.rank < 0);
  const numbered = indexed.filter((a) => a.rank >= 0).sort((a, b) => a.rank - b.rank || a.idx - b.idx);
  type Group = { number: string; title: string; parts: { sub: string; body: string }[] };
  const groups: Group[] = [];
  for (const a of [...head, ...numbered]) {
    const [base, ...more] = a.title.split(/\s+—\s+/);
    const last = groups[groups.length - 1];
    if (last && a.number && last.number === a.number) last.parts.push({ sub: more.join(" — ") || (base !== last.title ? base : ""), body: a.body });
    else groups.push({ number: a.number, title: base, parts: [{ sub: more.join(" — "), body: a.body }] });
  }
  const articles = groups
    .map((g) => {
      const first = g.parts[0]?.body.trim() ?? "";
      // « Entre les soussignés » : le texte commence déjà par « ENTRE LES SOUSSIGNÉS : ».
      const repeats = !g.number && first.toLowerCase().startsWith(g.title.toLowerCase());
      const h = repeats ? "" : `<h2>${g.number ? `${esc(g.number)}. ` : ""}${esc(g.title)}</h2>`;
      // Conditions particulières : un encadré en fin de contrat.
      if (g.title === CONDITIONS_TITLE) return `<section class="ct-art" style="border:1px solid #1a1a1a;border-radius:2mm;padding:4mm 5mm;margin-top:6mm;break-inside:avoid">${h}${g.parts.map((p) => htmlBody(p.body)).join("")}</section>`;
      return `<section class="ct-art">${h}${g.parts.map((p) => `${p.sub ? `<h3>${esc(sentence(p.sub))}</h3>` : ""}${htmlBody(p.body)}`).join("")}</section>`;
    })
    .join("");
  // « CONTRAT DE REPRÉSENTATION — TALENT MANAGEMENT — EXCLUSIF » → titre + précisions.
  const [headTitle, ...more] = c.title.split(/\s+—\s+/);
  const details = [...more.map(sentence), c.subtitle].filter(Boolean).join(" · ");
  const fileTitle = pdfFileTitle("Contrat de représentation", config.variante === "nonexclusif" ? "non exclusif" : "exclusif", config.talentNom);
  return `${docHead(fileTitle, CONTRACT_CSS)}<body><div class="wrap ct">
${contractHead(RC_META.brandTitle, RC_META.brandSubtitle, ["<b>Contrat de représentation</b>", esc(docToday()), "Confidentiel"])}
${contractTitle(sentence(headTitle || c.title), details)}
<section class="ct-art" style="margin-top:9mm"><h2>Préambule</h2>${htmlBody(c.preambule)}</section>
${articles}
${signaturesHTML(c.signatures)}
<div class="ct-legal">${esc(RC_META.footer)}</div>
</div></body></html>`;
}
