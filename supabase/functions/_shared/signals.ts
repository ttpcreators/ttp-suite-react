// ============================================================================
// _shared/signals.ts : ce qu'on lit dans un texte de créatrice (légende de post,
// description de vidéo, bio) : partenariat payé / offert / code promo, emails,
// indice « déjà en agence ». Partagé par ig-sourcing (Instagram) et yt-sourcing
// (YouTube).
// ============================================================================

/** Mots qui signalent un partenariat payé dans une légende. */
export const PAID = /#(ad|ads|pub|publicite|publicité|sponsor|sponsorise|sponsorisé|sponsored|partenariat|partenariatremunere|partenariatrémunéré|partnership|collab|collaboration|gifted|ambassador|ambassadrice)(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}])publicit[ée](?![\p{L}\p{N}])|collaboration commerciale|partenariat commercial|code promo|avec le code|code\s*:|-\s?\d{1,2}\s?%|en partenariat|partenariat r[ée]mun[ée]r[ée]|paid partnership|sponsoris[ée] par|offert par/iu;
// Cadeau ou code promo : « (produit offert) », « 10 % de réduction », « avec MARGOT10 ».
export const GIFT = /produits?\s+offerts?|\(offert\)|cadeau de|envoy[ée]s? par|\d{1,2}\s?%\s?(de\s)?(r[ée]duction|remise|off)|lien affili|affiliate/iu;
export const PROMO_CODE = /\b(code|avec|with)\s+[A-Z][A-Z0-9]{3,}\b/u; // majuscules : un code, pas un mot
/** Le post montre une relation commerciale avec une marque (payé, offert, code promo). */
export const isPaid = (caption: string) => PAID.test(caption) || GIFT.test(caption) || PROMO_CODE.test(caption);

export const FREE_MAIL = /@(gmail|googlemail|hotmail|outlook|live|icloud|me|yahoo|orange|free|sfr|laposte|wanadoo|proton|protonmail|gmx)\./i;
export const AGENCY = /(management|mgmt|managed by|g[ée]r[ée]e? par|repr[ée]sent[ée]e? par|represented by|\bagence\b|\bagency\b|\bagent\s*:|booking|talent manager|@[a-z0-9._]*(agency|agence|mgmt|management|talents?)\b)/i;
/** Indice « déjà en agence » (le passage trouvé), ou null. */
export function agencyHint(text: string, email: string): string | null {
  const m = AGENCY.exec(text);
  if (m) return text.slice(Math.max(0, m.index - 25), m.index + m[0].length + 25).replace(/\s+/g, " ").trim();
  const domain = email.split("@")[1] ?? "";
  if (email && !FREE_MAIL.test(email) && /(agency|agence|mgmt|management|talent|booking)/i.test(domain)) return email;
  return null;
}
/** Emails d'un texte, les plus « pro » d'abord (collab, contact, booking…). */
export function emailsIn(text: string): string[] {
  const all = [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) => m[0].toLowerCase())
    .filter((e) => !/\.(png|jpe?g|gif|webp|svg|css|js)$/.test(e) && !/(example|sentry|wixpress|domain|email)\./.test(e));
  const uniq = [...new Set(all)];
  return uniq.sort((a, b) => Number(/(collab|contact|booking|partenariat|business|hello|pr)/.test(b)) - Number(/(collab|contact|booking|partenariat|business|hello|pr)/.test(a)));
}
