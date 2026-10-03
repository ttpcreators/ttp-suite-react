import { supabase } from "@/lib/supabase";

/*
 * Photos de profil des mails, comme dans Gmail : on essaie dans l'ordre
 *   1. la photo de la créatrice si l'adresse est son alias (fiche Roster) ;
 *   2. le logo TTP pour les adresses de l'agence ;
 *   3. la photo Gravatar de la personne (si elle en a une) ;
 *   4. le logo de la marque, trouvé grâce au nom de domaine (pas pour gmail.com, hotmail…),
 *      puis celui du domaine principal (« fr.loreal.com » → « loreal.com ») ;
 *   5. si un nom de marque est connu (Contacts, Prospection) : le site d'entreprise
 *      d'un AUTRE contact de la même marque, puis le site officiel trouvé sur Wikidata ;
 *   6. sinon, une lettre sur fond de couleur (toujours la même couleur pour une adresse).
 * On ne devine jamais « marque.com » au hasard : ça tombe trop souvent sur une autre société.
 * Les résultats sont gardés en mémoire et sur l'appareil (7 jours) pour ne pas
 * redemander les mêmes images à chaque ouverture.
 */

export const AGENCY_DOMAIN = "ttpcreators.pro";
const AGENCY_LOGO = "/logo.png";

/** Messageries grand public : leur logo n'est pas celui de la personne. */
const WEBMAIL = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.fr", "outlook.com", "outlook.fr", "live.com", "live.fr",
  "msn.com", "yahoo.com", "yahoo.fr", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me",
  "protonmail.com", "pm.me", "gmx.com", "gmx.fr", "orange.fr", "wanadoo.fr", "free.fr", "sfr.fr", "neuf.fr",
  "laposte.net", "bbox.fr", "numericable.fr", "yandex.com", "mail.com", "zoho.com", "tutanota.com", "hey.com",
]);

export type AvatarKind = "photo" | "logo";
export type Avatar = { url: string; kind: AvatarKind } | null;

/** Adresse e-mail propre (minuscules) extraite de « Nom <a@b.c> », sinon "". */
export function emailOf(s: string | null | undefined): string {
  return (String(s ?? "").match(/[^\s<>"',;]+@[^\s<>"',;]+\.[^\s<>"',;]+/)?.[0] ?? "").toLowerCase();
}
export const domainOf = (email: string) => email.split("@")[1] ?? "";
export const isWebmail = (domain: string) => WEBMAIL.has(domain.toLowerCase());
export const isAgencyEmail = (email: string) => domainOf(email) === AGENCY_DOMAIN;

/** Adresse du logo d'une marque (128 px ; 404 si le site n'a pas d'icône). */
export const logoUrl = (domain: string) =>
  `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(`https://${domain}`)}&size=128`;
export const gravatarUrl = (sha256: string) => `https://gravatar.com/avatar/${sha256}?s=96&d=404`;

/** Suffixes à deux niveaux : « marque.co.uk » est déjà le domaine principal. */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gouv", "gov", "ac", "edu", "asso"]);
/** Domaine principal d'un sous-domaine (« mail.marque.fr » → « marque.fr »), sinon "". */
export function parentDomain(domain: string): string {
  const parts = domain.toLowerCase().split(".").filter(Boolean);
  if (parts.length < 3) return "";
  const keep = SECOND_LEVEL.has(parts[parts.length - 2]) && parts[parts.length - 1].length === 2 ? 3 : 2;
  return parts.length > keep ? parts.slice(-keep).join(".") : "";
}

/**
 * Sources à essayer, dans l'ordre (règle pure, testée). `creatorPhoto` = photo de la
 * créatrice dont c'est l'alias ; `hash` = empreinte SHA-256 de l'adresse (Gravatar) ;
 * `brandDomain` = site d'entreprise de la marque appris d'un autre contact.
 */
export function avatarCandidates(
  email: string, opts: { agency?: boolean; creatorPhoto?: string | null; hash?: string | null; brandDomain?: string | null } = {},
): { url: string; kind: AvatarKind; probe: boolean }[] {
  const out: { url: string; kind: AvatarKind; probe: boolean }[] = [];
  if (opts.creatorPhoto) out.push({ url: opts.creatorPhoto, kind: "photo", probe: false });
  if (opts.agency || (email && isAgencyEmail(email))) {
    out.push({ url: AGENCY_LOGO, kind: "photo", probe: false });
    return out;
  }
  const tried = new Set<string>();
  const logo = (d: string) => {
    if (!d || isWebmail(d) || d === AGENCY_DOMAIN || tried.has(d)) return;
    tried.add(d);
    out.push({ url: logoUrl(d), kind: "logo", probe: true });
  };
  if (email) {
    if (opts.hash) out.push({ url: gravatarUrl(opts.hash), kind: "photo", probe: true });
    const d = domainOf(email);
    logo(d);
    if (!isWebmail(d)) logo(parentDomain(d));
  }
  if (opts.brandDomain) logo(opts.brandDomain.toLowerCase());
  return out;
}

// ── Marques : retrouver leur site (pour le logo) ─────────────────────────────
/** Nom de marque comparable : minuscules, sans accents ni ponctuation. */
export function brandKey(brand: string | null | undefined): string {
  return String(brand ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
/** « Marques » qui n'en sont pas : jamais de logo cherché pour elles. */
const GENERIC_BRANDS = new Set([
  "", "freelance", "freelancer", "independant", "independante", "autre", "autres", "agence", "agencerp", "perso",
  "personnel", "particulier", "na", "aucune", "inconnu", "inconnue", "test", "ugc", "influence", "marque", "media",
  "presse", "pme", "contact", "divers",
]);
export const isGenericBrand = (brand: string | null | undefined) => {
  const k = brandKey(brand);
  return k.length < 2 || GENERIC_BRANDS.has(k);
};

/**
 * Site d'entreprise de chaque marque, appris des contacts eux-mêmes : une marque dont
 * un contact écrit avec « @sephora.fr » donne ce domaine à ses contacts en gmail.
 * (Règle pure, testée : le domaine le plus fréquent l'emporte.)
 */
export function buildBrandDomains(rows: readonly { brand?: string | null; email?: string | null }[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (isGenericBrand(r.brand)) continue;
    const d = domainOf(emailOf(r.email));
    if (!d || isWebmail(d) || d === AGENCY_DOMAIN) continue;
    const k = brandKey(r.brand);
    const m = counts.get(k) ?? new Map<string, number>();
    m.set(d, (m.get(d) ?? 0) + 1);
    counts.set(k, m);
  }
  const out = new Map<string, string>();
  for (const [k, m] of counts) out.set(k, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  return out;
}
const learned = new WeakMap<object, Map<string, string>>();
/** Domaine d'entreprise de `brand` d'après la liste de contacts (calculé une fois par liste). */
export function brandDomainFrom(rows: readonly { brand?: string | null; email?: string | null }[], brand: string | null | undefined): string {
  let m = learned.get(rows);
  if (!m) {
    m = buildBrandDomains(rows);
    learned.set(rows, m);
  }
  return m.get(brandKey(brand)) ?? "";
}

/** Description Wikidata d'une entreprise ou d'une marque (pas une personne, une ville…). */
const BUSINESS = /entreprise|soci[ée]t[ée]|marque|cha[iî]ne|magasin|enseigne|multinational|maison de|groupe|fabricant|start-?up|h[ôo]tel|restaurant|cosm[ée]tique|mode|label|m[ée]dia|magazine|agence|company|brand|retailer|manufacturer|business|corporation|conglomerate|fashion|clothing|beauty|hotel/i;
/** Hôte d'une adresse de site (« https://www.sephora.fr/ » → « sephora.fr »). */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

const BRAND_STORE = "ttp:brand-domains:v1";
type BrandStored = Record<string, [string, number]>; // marque → [domaine | "", date]
const brandMemory = new Map<string, string>();
const brandInflight = new Map<string, Promise<string>>();
let wdRunning = 0;
const wdQueue: (() => void)[] = [];
/** Une recherche Wikidata à la fois (les autres attendent leur tour). */
function wdSlot<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const go = () => {
      wdRunning += 1;
      fn().then(resolve, reject).finally(() => {
        wdRunning -= 1;
        wdQueue.shift()?.();
      });
    };
    if (wdRunning < 1) go();
    else wdQueue.push(go);
  });
}
// Wikidata limite les requêtes rapprochées : 1,2 s entre deux appels, et pause de
// 5 minutes s'il répond « trop de requêtes » (rien n'est mémorisé : on réessaiera).
let wdNext = 0;
let wdPausedUntil = 0;
async function wikidata<T>(params: Record<string, string>): Promise<T> {
  if (Date.now() < wdPausedUntil) throw new Error("pause");
  const wait = Math.max(0, wdNext - Date.now());
  wdNext = Math.max(Date.now(), wdNext) + 1200;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  const q = new URLSearchParams({ ...params, format: "json", origin: "*" });
  // Wikimedia demande qu'une appli se présente (sinon : « trop de requêtes »).
  const r = await fetch(`https://www.wikidata.org/w/api.php?${q}`, { headers: { "Api-User-Agent": "TTPSuite/1.0 (https://app.ttpcreators.pro)" } });
  if (r.status === 429) {
    wdPausedUntil = Date.now() + 5 * 60_000;
    throw new Error("429");
  }
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as T;
}

/**
 * Site officiel d'une marque d'après Wikidata (gratuit, sans clé). N'accepte qu'un
 * résultat au nom IDENTIQUE et décrit comme une entreprise / une marque. "" sinon.
 * Gardé sur l'appareil : 30 jours si trouvé, 7 jours sinon.
 */
export function officialBrandDomain(brand: string): Promise<string> {
  const k = brandKey(brand);
  if (isGenericBrand(brand)) return Promise.resolve("");
  if (brandMemory.has(k)) return Promise.resolve(brandMemory.get(k)!);
  try {
    const hit = (JSON.parse(localStorage.getItem(BRAND_STORE) ?? "{}") as BrandStored)[k];
    if (hit && Date.now() - hit[1] < (hit[0] ? 30 : 7) * DAY) {
      brandMemory.set(k, hit[0]);
      return Promise.resolve(hit[0]);
    }
  } catch {
    /* stockage indisponible */
  }
  const pending = brandInflight.get(k);
  if (pending) return pending;
  const p = wdSlot(async () => {
    type Search = { search?: { id: string; label?: string; description?: string; match?: { text?: string } }[] };
    const found = await wikidata<Search>({ action: "wbsearchentities", search: brand.trim().slice(0, 80), language: "fr", uselang: "fr", type: "item", limit: "7" });
    const ids = (found.search ?? [])
      .filter((x) => (brandKey(x.label) === k || brandKey(x.match?.text) === k) && BUSINESS.test(x.description ?? ""))
      .slice(0, 3)
      .map((x) => x.id);
    if (!ids.length) return "";
    type Claims = { entities?: Record<string, { claims?: { P856?: { rank?: string; mainsnak?: { datavalue?: { value?: string } } }[] } }> };
    const ents = await wikidata<Claims>({ action: "wbgetentities", ids: ids.join("|"), props: "claims" });
    for (const id of ids) {
      const sites = ents.entities?.[id]?.claims?.P856 ?? [];
      const best = sites.find((c) => c.rank === "preferred") ?? sites.find((c) => c.rank !== "deprecated");
      const host = hostOf(best?.mainsnak?.datavalue?.value ?? "");
      if (host) return host;
    }
    return "";
  })
    .then((d) => {
      brandMemory.set(k, d);
      try {
        const st = JSON.parse(localStorage.getItem(BRAND_STORE) ?? "{}") as BrandStored;
        st[k] = [d, Date.now()];
        const keys = Object.keys(st);
        if (keys.length > 600) for (const x of keys.slice(0, keys.length - 600)) delete st[x];
        localStorage.setItem(BRAND_STORE, JSON.stringify(st));
      } catch {
        /* stockage indisponible */
      }
      return d;
    })
    // Réseau indisponible : pas mémorisé, on réessaiera.
    .catch(() => "")
    .finally(() => brandInflight.delete(k));
  brandInflight.set(k, p);
  return p;
}

/** Couleur de la lettre : toujours la même pour un même nom / une même adresse. */
const LETTER_COLORS = ["#4f6bed", "#0e8f9b", "#d97706", "#e11d48", "#c026d3", "#0284c7", "#b45309", "#64748b", "#dc2626", "#2563eb"];
export function letterColor(key: string): string {
  let h = 0;
  for (const ch of key.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LETTER_COLORS[h % LETTER_COLORS.length];
}

// ── Résolution (navigateur) ─────────────────────────────────────────────────
const STORE = "ttp:mail-avatars:v1";
const DAY = 86_400_000;
type Stored = Record<string, [string, AvatarKind | "", number]>; // adresse → [url | "", type, date]
const memory = new Map<string, Avatar>();
const inflight = new Map<string, Promise<Avatar>>();

function readStore(): Stored {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}") as Stored;
  } catch {
    return {};
  }
}
function remember(key: string, a: Avatar) {
  memory.set(key, a);
  try {
    const s = readStore();
    s[key] = [a?.url ?? "", a?.kind ?? "", Date.now()];
    const keys = Object.keys(s);
    if (keys.length > 800) for (const k of keys.slice(0, keys.length - 800)) delete s[k];
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* stockage indisponible : la mémoire suffit */
  }
}
function recalled(key: string): Avatar | undefined {
  if (memory.has(key)) return memory.get(key);
  const hit = readStore()[key];
  if (!hit) return undefined;
  const [url, kind, at] = hit;
  // Trouvé : 7 jours. Rien trouvé : on réessaie au bout de 2 jours.
  if (Date.now() - at > (url ? 7 : 2) * DAY) return undefined;
  const a: Avatar = url ? { url, kind: (kind || "photo") as AvatarKind } : null;
  memory.set(key, a);
  return a;
}

// Pas plus de 6 images testées en même temps (une longue liste ne bloque pas le reste).
let running = 0;
const queue: (() => void)[] = [];
function slot<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve) => {
    const go = () => {
      running += 1;
      fn().then(resolve, () => resolve(undefined as T)).finally(() => {
        running -= 1;
        queue.shift()?.();
      });
    };
    if (running < 6) go();
    else queue.push(go);
  });
}
/** Largeur réelle de l'image (0 = introuvable). */
function probeWidth(url: string): Promise<number> {
  return slot(() => new Promise<number>((resolve) => {
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    const t = window.setTimeout(() => resolve(0), 6000);
    img.onload = () => {
      window.clearTimeout(t);
      resolve(img.naturalWidth);
    };
    img.onerror = () => {
      window.clearTimeout(t);
      resolve(0);
    };
    img.src = url;
  }));
}
async function sha256(s: string): Promise<string | null> {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s.trim().toLowerCase()));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** Boîtes communes de l'agence : jamais la photo d'une créatrice. */
export const SHARED_BOXES = /^(talent|partnerships|contact|marc|hello|info|bonjour|team|admin)@ttpcreators\.pro$/i;

// Photos des créatrices : alias (Mails) et adresse pro (fiche) → photo du Roster.
let photosLoad: Promise<Map<string, string>> | null = null;
function creatorPhotos(): Promise<Map<string, string>> {
  photosLoad ??= (async () => {
    const m = new Map<string, string>();
    const [{ data: cs }, { data: st }] = await Promise.all([
      supabase.from("creators").select("name,email_pro,photo_url"),
      supabase.from("creator_mail_settings").select("creator,alias"),
    ]);
    const rows = (cs ?? []) as { name: string; email_pro: string | null; photo_url: string | null }[];
    const byName = new Map(rows.map((c) => [c.name.trim().toLowerCase(), c.photo_url]));
    // Une adresse partagée (talent@, partnerships@… ou notée sur plusieurs fiches)
    // n'est pas celle d'une créatrice : elle garde le logo TTP.
    const uses = new Map<string, number>();
    for (const c of rows) if (c.email_pro) uses.set(emailOf(c.email_pro), (uses.get(emailOf(c.email_pro)) ?? 0) + 1);
    const own = (e: string) => !!e && !SHARED_BOXES.test(e) && (uses.get(e) ?? 0) <= 1;
    for (const c of rows) if (c.email_pro && c.photo_url && own(emailOf(c.email_pro))) m.set(emailOf(c.email_pro), c.photo_url);
    for (const s of (st ?? []) as { creator: string; alias: string | null }[]) {
      const p = byName.get(s.creator.trim().toLowerCase());
      if (s.alias && p && !SHARED_BOXES.test(emailOf(s.alias))) m.set(emailOf(s.alias), p);
    }
    // Rien de lisible (session pas encore prête) : on retentera plus tard.
    if (!m.size) window.setTimeout(() => { photosLoad = null; }, 30_000);
    return m;
  })().catch(() => new Map<string, string>());
  return photosLoad;
}

/**
 * Photo à afficher pour une adresse (null = la lettre). `brand` (nom de la marque du
 * contact) et `brandDomain` (son site appris d'un autre contact) servent de repli.
 */
export function resolveAvatar(email: string, agency = false, hint: { brand?: string | null; brandDomain?: string | null } = {}): Promise<Avatar> {
  const brand = isGenericBrand(hint.brand) ? "" : String(hint.brand ?? "").trim();
  const base = agency && !email ? "@agence" : email;
  const key = brand ? `${base}|${brandKey(brand)}|${hint.brandDomain ?? ""}` : base;
  if (!key) return Promise.resolve(null);
  const known = recalled(key);
  if (known !== undefined) return Promise.resolve(known);
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = (async (): Promise<Avatar> => {
    const photos = email ? await creatorPhotos() : new Map<string, string>();
    const hash = email && !isAgencyEmail(email) && !agency ? await sha256(email) : null;
    const tried = new Set<string>();
    const keep = (a: Avatar, persist: boolean): Avatar => {
      // La photo d'une créatrice peut changer : pas gardée sur l'appareil.
      if (persist) remember(key, a);
      else memory.set(key, a);
      return a;
    };
    const attempt = async (c: { url: string; kind: AvatarKind; probe: boolean }): Promise<Avatar> => {
      tried.add(c.url);
      if (!c.probe) return keep({ url: c.url, kind: c.kind }, c.url === AGENCY_LOGO);
      const w = await probeWidth(c.url);
      // Logo : 48 px minimum. En dessous, c'est flou… ou le globe générique que Google
      // renvoie pour un site inconnu (impossible à distinguer d'une vraie petite icône).
      return w >= (c.kind === "logo" ? 48 : 1) ? keep({ url: c.url, kind: c.kind }, true) : null;
    };
    const cands = avatarCandidates(email, { agency, creatorPhoto: photos.get(email) ?? null, hash, brandDomain: brand ? hint.brandDomain : null });
    for (const c of cands) {
      const a = await attempt(c);
      if (a) return a;
    }
    // Dernier recours : le site officiel de la marque (Wikidata). Jamais pour l'agence.
    const agencyLike = agency || (email && isAgencyEmail(email));
    if (brand && !agencyLike) {
      const d = await officialBrandDomain(brand);
      if (d && !isWebmail(d) && !tried.has(logoUrl(d))) {
        const a = await attempt({ url: logoUrl(d), kind: "logo", probe: true });
        if (a) return a;
      }
    }
    remember(key, null);
    return null;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
