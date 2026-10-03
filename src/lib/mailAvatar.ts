import { supabase } from "@/lib/supabase";

/*
 * Photos de profil des mails, comme dans Gmail : on essaie dans l'ordre
 *   1. la photo de la créatrice si l'adresse est son alias (fiche Roster) ;
 *   2. le logo TTP pour les adresses de l'agence ;
 *   3. la photo Gravatar de la personne (si elle en a une) ;
 *   4. le logo de la marque, trouvé grâce au nom de domaine (pas pour gmail.com, hotmail…) ;
 *   5. sinon, une lettre sur fond de couleur (toujours la même couleur pour une adresse).
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

/**
 * Sources à essayer, dans l'ordre (règle pure, testée). `creatorPhoto` = photo de la
 * créatrice dont c'est l'alias ; `hash` = empreinte SHA-256 de l'adresse (Gravatar).
 */
export function avatarCandidates(
  email: string, opts: { agency?: boolean; creatorPhoto?: string | null; hash?: string | null } = {},
): { url: string; kind: AvatarKind; probe: boolean }[] {
  const out: { url: string; kind: AvatarKind; probe: boolean }[] = [];
  if (opts.creatorPhoto) out.push({ url: opts.creatorPhoto, kind: "photo", probe: false });
  if (opts.agency || (email && isAgencyEmail(email))) {
    out.push({ url: AGENCY_LOGO, kind: "photo", probe: false });
    return out;
  }
  if (!email) return out;
  if (opts.hash) out.push({ url: gravatarUrl(opts.hash), kind: "photo", probe: true });
  const d = domainOf(email);
  if (d && !isWebmail(d)) out.push({ url: logoUrl(d), kind: "logo", probe: true });
  return out;
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
/** L'image existe-t-elle, assez grande pour ne pas être floue ? */
function probe(url: string, minSize: number): Promise<boolean> {
  return slot(() => new Promise<boolean>((resolve) => {
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    const t = window.setTimeout(() => resolve(false), 6000);
    img.onload = () => {
      window.clearTimeout(t);
      resolve(img.naturalWidth >= minSize);
    };
    img.onerror = () => {
      window.clearTimeout(t);
      resolve(false);
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
    for (const c of rows) if (c.email_pro && c.photo_url) m.set(emailOf(c.email_pro), c.photo_url);
    for (const s of (st ?? []) as { creator: string; alias: string | null }[]) {
      const p = byName.get(s.creator.trim().toLowerCase());
      if (s.alias && p) m.set(emailOf(s.alias), p);
    }
    // Rien de lisible (session pas encore prête) : on retentera plus tard.
    if (!m.size) window.setTimeout(() => { photosLoad = null; }, 30_000);
    return m;
  })().catch(() => new Map<string, string>());
  return photosLoad;
}

/** Photo à afficher pour une adresse (null = la lettre). */
export function resolveAvatar(email: string, agency = false): Promise<Avatar> {
  const key = agency && !email ? "@agence" : email;
  if (!key) return Promise.resolve(null);
  const known = recalled(key);
  if (known !== undefined) return Promise.resolve(known);
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = (async (): Promise<Avatar> => {
    const photos = email ? await creatorPhotos() : new Map<string, string>();
    const hash = email && !isAgencyEmail(email) && !agency ? await sha256(email) : null;
    for (const c of avatarCandidates(email, { agency, creatorPhoto: photos.get(email) ?? null, hash })) {
      if (!c.probe || (await probe(c.url, c.kind === "logo" ? 48 : 1))) {
        const a: Avatar = { url: c.url, kind: c.kind };
        // La photo d'une créatrice peut changer : pas gardée sur l'appareil.
        if (c.probe || c.url === AGENCY_LOGO) remember(key, a);
        else memory.set(key, a);
        return a;
      }
    }
    remember(key, null);
    return null;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
