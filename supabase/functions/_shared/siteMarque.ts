// ============================================================================
// _shared/siteMarque.ts : lire le site d'une marque pour trouver son adresse de contact
// (outil lire_site_marque du connecteur Claude, ttp-mcp/autonomie.ts).
// ----------------------------------------------------------------------------
// Audit du 24 novembre 2026 (point M9). Décision de Gianni : aucun outil payant en plus,
// FullEnrich (500 crédits par mois) pour les contacts précis, et l'adresse générale de la
// marque sinon. Cette adresse est presque toujours écrite sur le site : page d'accueil,
// page contact, mentions légales. La lire ne coûte aucun crédit.
// Garde-fous : seuls des sites publics sont lus (pas d'adresse IP, pas de nom interne, pas
// de port), 6 pages au plus sur le même site, et les grands réseaux ne sont jamais lus.
// Règles PURES, testées par siteMarque.test.ts. La lecture réseau est dans autonomie.ts.
// ============================================================================

import { FREE_MAIL } from "./signals.ts";

/** Pages lues par site, page d'accueil comprise. */
export const MAX_PAGES = 6;
/** Taille lue par page (octets). Assez pour atteindre le pied de page d'une boutique, où sont les adresses. */
export const MAX_OCTETS = 1_500_000;

const INTERNES = /\.(local|localhost|internal|intranet|lan|home|corp|test|example|invalid|onion)$/;
/** Réseaux et plateformes : l'adresse de la marque n'y est pas, et ils refusent la lecture. */
const PLATEFORMES = /(^|\.)(instagram|facebook|fb|tiktok|linkedin|youtube|youtu|twitter|x|pinterest|snapchat|google|linktr|wa|whatsapp|t|telegram)\.(com|fr|be|me|ee|co)$/;

/** « Nova.fr/contact », « https://www.nova.fr » → « https://www.nova.fr » ; "" si ce n'est pas un site public lisible. */
export function adresseSite(v: unknown): string {
  let t = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!t || /\s/.test(t)) return "";
  if (!/^https?:\/\//.test(t)) t = t.includes("://") ? "" : `https://${t.replace(/^.*@/, "")}`;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return "";
  }
  const h = u.hostname;
  if (u.username || u.password || u.port) return "";
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) || !/\.[a-z]{2,}$/.test(h)) return "";
  if (INTERNES.test(h) || PLATEFORMES.test(h)) return "";
  return `https://${h}`;
}

/** Domaine sans « www. » : « https://www.nova.fr » → « nova.fr ». */
export function domaineDuSite(site: string): string {
  try {
    return new URL(site).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Ce qu'un lien promet, du plus utile au moins utile ; -1 = sans intérêt. */
const RANGS: RegExp[] = [
  /contact|nous-?contacter|contactez/,
  /presse|press|partenariat|partnership|collab|influence|ambassad/,
  /mentions-?legales|legal|imprint|impressum/,
  /a-?propos|about|qui-?sommes/,
  /\bcgv\b|conditions|terms|\bfaq\b/,
];
function rangDuLien(texte: string): number {
  return RANGS.findIndex((re) => re.test(texte));
}
/** Adresses habituelles quand la page d'accueil ne donne pas assez de liens. */
const PAR_DEFAUT = ["/contact", "/pages/contact", "/mentions-legales"];
/** Boutiques Shopify : ces deux pages portent presque toujours l'adresse de la société. */
const SHOPIFY = ["/policies/contact-information", "/policies/legal-notice"];

/**
 * Les pages à lire après la page d'accueil : les liens du même site qui parlent de contact,
 * de presse ou de partenariats, de mentions légales, puis d'à-propos et de conditions (les
 * plus utiles d'abord), complétés par les adresses habituelles.
 */
export function pagesALire(site: string, html: string): string[] {
  const base = adresseSite(site);
  if (!base) return [];
  const hote = domaineDuSite(base);
  const page = String(html ?? "");
  const vues = new Set<string>();
  const trouves: { url: string; rang: number; ordre: number }[] = [];
  const garder = (u: URL, rang: number) => {
    if (domaineDuSite(u.origin) !== hote || u.port || !/^https?:$/.test(u.protocol)) return;
    const cle = u.pathname.replace(/\/+$/, "").toLowerCase();
    if (!cle || vues.has(cle) || /\.(pdf|jpe?g|png|webp|svg|zip|mp4)$/.test(cle)) return;
    vues.add(cle);
    trouves.push({ url: `https://${u.hostname}${u.pathname}`, rang, ordre: trouves.length });
  };
  for (const m of page.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    if (trouves.length >= 40) break;
    const href = m[1].trim();
    if (/^(mailto|tel|javascript|data):/i.test(href)) continue;
    const rang = rangDuLien(sansAccent(`${href} ${m[2].replace(/<[^>]+>/g, " ")}`));
    if (rang < 0) continue;
    try {
      garder(new URL(href, `${base}/`), rang);
    } catch {
      /* lien illisible : on passe */
    }
  }
  if (/cdn\.shopify\.com|\/cdn\/shop\//.test(page)) for (const p of SHOPIFY) garder(new URL(p, `${base}/`), 0.5);
  for (const p of PAR_DEFAUT) garder(new URL(p, `${base}/`), 2.5);
  return trouves.sort((a, b) => a.rang - b.rang || a.ordre - b.ordre).slice(0, MAX_PAGES - 1).map((x) => x.url);
}

function sansAccent(v: string): string {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Texte d'une page où les adresses cachées simplement redeviennent lisibles (entités, mailto, « [at] »). */
export function texteLisible(html: string): string {
  let t = String(html ?? "");
  t = t.replace(/&#(\d{2,4});/g, (_m, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]{2,4});/gi, (_m, n) => String.fromCharCode(parseInt(n, 16)));
  t = t.replace(/&commat;/gi, "@").replace(/&period;/gi, ".").replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ");
  // Adresses masquées par Cloudflare : « data-cfemail="…" » ou « /cdn-cgi/l/email-protection#… ».
  t = t.replace(/(?:data-cfemail=["']|email-protection#)([0-9a-f]{6,400})/gi, (_m, hex) => ` ${adresseCloudflare(hex)} `);
  t = t.replace(/mailto:([^"'?\s>]{1,200})/gi, (_m, a) => {
    try {
      return ` ${decodeURIComponent(a)} `;
    } catch {
      return ` ${a} `;
    }
  });
  // « contact [at] nova (dot) fr » : le signe remis, puis les espaces autour retirés (3 au plus,
  // pour que la lecture reste rapide même sur une page pleine d'espaces).
  t = t.replace(/[[(] {0,2}(?:at|arobase) {0,2}[\])]/gi, "\u0001").replace(/[[(] {0,2}(?:dot|point) {0,2}[\])]/gi, "\u0002");
  return t.replace(/ {0,3}\u0001 {0,3}/g, "@").replace(/ {0,3}\u0002 {0,3}/g, ".");
}

/** Décode une adresse masquée par Cloudflare : le premier octet est la clé des suivants. */
export function adresseCloudflare(hex: string): string {
  const h = String(hex ?? "");
  if (!/^([0-9a-f]{2}){3,200}$/i.test(h)) return "";
  const cle = parseInt(h.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < h.length; i += 2) out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16) ^ cle);
  return /^[\x21-\x7e]+$/.test(out) ? out : "";
}

const AVANT = /[a-z0-9._%+-]/i;
const APRES = /[a-z0-9.-]/i;
const ADRESSE = /^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/**
 * Les adresses e-mail d'un texte, dans l'ordre où elles apparaissent, sans doublon. On part
 * de chaque « @ » et on lit autour, lettre par lettre : le temps reste proportionnel à la
 * taille de la page, même pour 400 Ko de code sans espace (une recherche par motif sur tout
 * le texte y prendrait des minutes).
 */
export function adressesDans(texte: string): string[] {
  const t = String(texte ?? "");
  const vues = new Set<string>();
  for (let i = t.indexOf("@"); i !== -1; i = t.indexOf("@", i + 1)) {
    let debut = i;
    while (debut > 0 && i - debut < 64 && AVANT.test(t[debut - 1])) debut--;
    let fin = i + 1;
    while (fin < t.length && fin - i <= 255 && APRES.test(t[fin])) fin++;
    const email = t.slice(debut, fin).toLowerCase().replace(/^[.%+-]+/, "").replace(/[.-]+$/, "");
    if (!ADRESSE.test(email)) continue;
    // Noms de fichiers (« logo@2x.png ») et adresses d'exemple ou techniques.
    if (/\.(png|jpe?g|gif|webp|svg|css|js|avif|ico)$/.test(email) || /(example|sentry|wixpress|domain|email)\./.test(email)) continue;
    vues.add(email);
    if (vues.size >= 200) break;
  }
  return [...vues];
}

/** Adresses qui ne servent à rien pour un partenariat (robots, juridique, technique, recrutement). */
const INUTILE = /^(no-?reply|ne-?pas-?repondre|donotreply|mailer-daemon|postmaster|abuse|webmaster|hostmaster|dpo|rgpd|gdpr|privacy|legal|juridique|security|jobs?|recrutement|careers?|rh|hr|compta|comptabilite|facturation|billing|invoice)\b/;
const TECHNIQUE = /(sentry|wixpress|shopify|squarespace|wordpress|cloudflare|googleapis|gstatic|schema|w3|jquery|example|exemple|domain|domaine|email|votre|your)\./;
const PARTENARIAT = /(influen|partner|partenariat|collab|ambassad|presse|press|\bpr\b|\brp\b|marketing|communication|comm?s?\b|social|brand|media)/;
const GENERAL = /^(contact|hello|bonjour|info|infos|hi|hey|salut|team|equipe|coucou|welcome|sales|commercial|b2b|pro|wholesale)\b/;
const CLIENT = /(sav|support|service-?client|client|customer|commande|order|retour|return|livraison|shipping|help|aide)/;

export type EmailSite = { email: string; genre: "partenariats" | "general" | "nominative" | "service client"; duSite: boolean; page: string };

/** Genre d'une adresse d'après ce qui est écrit avant le @ ; null si elle est inutile. */
export function genreEmail(email: string): EmailSite["genre"] | null {
  const local = email.split("@")[0] ?? "";
  const domaine = email.split("@")[1] ?? "";
  if (INUTILE.test(local) || TECHNIQUE.test(domaine) || /^[0-9a-f]{16,}$/.test(local)) return null;
  // Adresses d'exemple laissées dans le code d'un site (« test@test.com », « nom@exemple.fr »).
  if (FACTICE_LOCAL.test(local) || FACTICE_DOMAINE.test(domaine)) return null;
  if (PARTENARIAT.test(local)) return "partenariats";
  if (CLIENT.test(local)) return "service client";
  if (GENERAL.test(local)) return "general";
  return "nominative";
}

const FACTICE_LOCAL = /^(test|tests|exemple|example|email|e-mail|mail|name|nom|prenom|firstname|lastname|user|username|you|your|votre|john\.?doe|jane\.?doe|xxx+)$/;
const FACTICE_DOMAINE = /^(test|tests|example|exemple|domain|domaine|yourdomain|votredomaine|monsite|mysite|site|company|societe|email|xxx+)\.[a-z]{2,}$/;

const ORDRE: Record<EmailSite["genre"], number> = { partenariats: 0, general: 1, nominative: 2, "service client": 3 };

/**
 * Les adresses trouvées sur les pages d'un site, les plus utiles d'abord : partenariats et
 * presse, puis l'adresse générale, puis les adresses de personnes, puis le service client.
 * À genre égal, une adresse au nom du site passe avant une messagerie grand public.
 */
export function emailsDuSite(pages: readonly { url: string; html: string }[], site: string): EmailSite[] {
  const hote = domaineDuSite(adresseSite(site) || site);
  const vus = new Map<string, EmailSite>();
  for (const p of pages) {
    for (const email of adressesDans(texteLisible(p.html))) {
      if (vus.has(email) || email.length > 120) continue;
      const genre = genreEmail(email);
      if (!genre) continue;
      const dom = email.split("@")[1] ?? "";
      vus.set(email, { email, genre, duSite: !!hote && (dom === hote || dom.endsWith(`.${hote}`) || hote.endsWith(`.${dom}`)), page: p.url });
    }
  }
  const poids = (e: EmailSite) => ORDRE[e.genre] * 10 + (e.duSite ? 0 : FREE_MAIL.test(e.email) ? 2 : 1);
  return [...vus.values()].sort((a, b) => poids(a) - poids(b)).slice(0, 12);
}

/** Compte Instagram et page LinkedIn de la marque, s'ils sont liés depuis le site. */
export function reseauxDuSite(pages: readonly { html: string }[]): { instagram: string; linkedin: string } {
  let instagram = "";
  let linkedin = "";
  for (const p of pages) {
    const h = String(p.html ?? "");
    if (!instagram) {
      for (const m of h.matchAll(/instagram\.com\/([a-z0-9._]{2,30})\/?(?=["'?#\s<])/gi)) {
        if (!/^(p|reel|reels|stories|explore|tv|accounts|share|sharer)$/i.test(m[1])) {
          instagram = `@${m[1].toLowerCase()}`;
          break;
        }
      }
    }
    if (!linkedin) {
      const m = /linkedin\.com\/company\/([^"'/?#\s<]+)/i.exec(h);
      if (m) linkedin = `https://www.linkedin.com/company/${m[1]}`;
    }
  }
  return { instagram, linkedin };
}

/** Une adresse sur une ligne, avec ce qu'elle est et où elle a été lue. */
export function ligneEmailSite(e: EmailSite): string {
  const quoi = e.genre === "partenariats" ? "partenariats ou presse" : e.genre === "general" ? "adresse générale" : e.genre === "nominative" ? "adresse d'une personne" : "service client";
  const chemin = cheminDe(e.page);
  return `- ${e.email} · ${quoi}${e.duSite ? "" : " · pas au nom du site"} · lue sur ${chemin && chemin !== "/" ? chemin : "la page d'accueil"}`;
}

function cheminDe(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}
