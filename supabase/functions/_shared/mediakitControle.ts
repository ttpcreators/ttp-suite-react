// ============================================================================
// _shared/mediakitControle.ts : les chiffres d'un media kit sont-ils VRAIS ?
// ----------------------------------------------------------------------------
// Demande de Marc (22 novembre 2026), après le cas d'un nouveau créateur dont le media kit
// annonçait 210 K abonnés Instagram pour 5,9 K réels, joint à 16 mails de prospection.
// Compare chaque chiffre du kit (abonnés, engagement, vues moyennes par réseau) au chiffre
// réel le plus récent de l'app :
//   - abonnés : relevé automatique (creators.ig / tt / yt, par ig-sync, tt-sync, yt-sync)
//     ou dernière mesure du calculateur (blob engagementHistory), la plus récente des deux ;
//   - engagement : dernière mesure du calculateur (même base que le kit : sur les vues) ;
//   - vues moyennes : relevé automatique (Instagram connecté, TikTok, YouTube).
// Verdict : « ok », « à corriger » (écart au delà du seuil, avec le détail) ou « à vérifier »
// (chiffre réel absent ou trop vieux : jamais « faux » sans preuve).
// Partagé par l'app (page Media kit, fiche roster) et le connecteur (garde-fou des mails
// de prospection d'Alfred, fiche_createur). Logique pure, testée par mediakitControle.test.ts.
// ============================================================================

import { appliquerChiffres, nombre } from "./mediakitChiffres.ts";

/**
 * Seuils d'écart (relatif au chiffre réel) au delà desquels le kit est « à corriger ».
 * - Abonnés 25 % : les relevés sont quotidiens et un compte installé gagne rarement plus de
 *   10 à 15 % en deux mois ; 25 % laisse la place aux arrondis du kit (« 12,3 K »), au kit
 *   refait une fois par mois et à un pic de croissance, tout en attrapant net un kit gonflé
 *   (210 K pour 5,9 K = 35 fois plus) ou le chiffre d'un autre compte.
 * - Engagement 50 % ET 1 point : d'un mois à l'autre la mesure bouge beaucoup (3,98 %, puis
 *   19,76 %, puis 5,66 % pour un même compte) ; seul un écart double et d'au moins un point
 *   est une vraie erreur.
 * - Vues moyennes 50 % : elles varient d'une vidéo à l'autre plus que les abonnés.
 */
export const SEUILS = { abonnes: 0.25, engagement: 0.5, vues: 0.5 } as const;
/** Écart minimal en points pour l'engagement (4 % contre 3 % n'est pas une erreur). */
export const ECART_MIN_POINTS = 1;
/** Au delà de 62 jours (deux mesures mensuelles manquées), un chiffre réel est trop vieux. */
export const FRAICHEUR_JOURS = 62;

export type Plateforme = "instagram" | "tiktok" | "youtube";
export const PLATEFORMES: Plateforme[] = ["instagram", "tiktok", "youtube"];
export const NOM_PLATEFORME: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", snapchat: "Snapchat", x: "X", facebook: "Facebook" };
export type Chiffre = "abonnes" | "engagement" | "vues";
const NOM_CHIFFRE: Record<Chiffre, string> = { abonnes: "abonnés", engagement: "engagement", vues: "vues moyennes" };

type Json = Record<string, unknown>;
/** Une mesure du calculateur d'engagement (blob `engagementHistory`). */
export type Mesure = { creator?: string; platform?: string; followers?: unknown; er?: unknown; date?: string };
/** Ce qu'il faut de la fiche `creators` (select « * » ou ces colonnes). */
export type CreateurKit = { name: string; mediakit?: unknown; ig?: unknown; tt?: unknown; yt?: unknown };

export type Etat = "ok" | "a_corriger" | "a_verifier";
export type Ligne = {
  plateforme: string;
  chiffre: Chiffre;
  /** Chiffre du kit (engagement en %). */
  kit: number;
  /** Chiffre réel le plus récent, ou null s'il n'y en a pas. */
  reel: number | null;
  /** Jour du chiffre réel (AAAA-MM-JJ), ou null. */
  date: string | null;
  /** D'où vient le chiffre réel (« relevé automatique », « mesure du calculateur »). */
  source: string;
  etat: Etat;
  /** Écart relatif au réel (0,25 = 25 %), ou null. */
  ecart: number | null;
  /** « Instagram : kit 210 K, réel 5,9 K » ; « TikTok : aucun chiffre réel ». */
  texte: string;
};
export type Controle = {
  /** « sans_kit » : aucun chiffre dans le kit (ou pas de kit). */
  etat: Etat | "sans_kit";
  lignes: Ligne[];
  aCorriger: Ligne[];
  aVerifier: Ligne[];
};

// ── Lecture des chiffres ─────────────────────────────────────────────────────

const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const positif = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : nombre(v);
  return n != null && Number.isFinite(n) && n > 0 ? n : null;
};
/** « 5,84 % », « 5.84 », 5.84 → 5.84 ; null si illisible. */
export function taux(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace("%", "").replace(",", ".").replace(/\s/g, ""));
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
}
/** « 22/11/2026 » ou ISO → « 2026-11-22 » ; null si illisible. */
export function jourIso(v: unknown): string | null {
  const s = String(v ?? "").trim();
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (fr) return `${fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) && Number.isFinite(Date.parse(s.slice(0, 10))) ? s.slice(0, 10) : null;
}
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
/** « 2026-11-22 » → « 22 nov. ». */
export const jourCourt = (iso: string) => `${Number(iso.slice(8, 10))} ${MOIS[Number(iso.slice(5, 7)) - 1] ?? ""}`.trim();
const ageJours = (iso: string, maintenant: Date) => (maintenant.getTime() - Date.parse(`${iso}T12:00:00Z`)) / 86_400_000;

/** « 210 K », « 5,9 K », « 1,2 M », « 950 » (comme le reste de l'app). */
export function compact(n: number): string {
  if (n >= 1e6) return `${(Math.round(n / 1e5) / 10).toString().replace(".", ",")} M`;
  if (n >= 1e3) return `${(Math.round(n / 100) / 10).toString().replace(".", ",")} K`;
  return String(Math.round(n));
}
const fmt = (c: Chiffre, n: number) => (c === "engagement" ? `${n.toFixed(2).replace(".", ",")} %` : compact(n));

type Reel = { valeur: number; date: string | null; source: string };

/** Le plus récent de deux chiffres réels (à date égale ou inconnue, le relevé automatique). */
const plusRecent = (a: Reel | null, b: Reel | null): Reel | null => {
  if (!a) return b;
  if (!b) return a;
  return (b.date ?? "") > (a.date ?? "") ? b : a;
};

/** Les chiffres réels les plus récents, par plateforme. */
export function chiffresReels(c: CreateurKit, mesures: Mesure[]): Record<string, Partial<Record<Chiffre, Reel>>> {
  const out: Record<string, Partial<Record<Chiffre, Reel>>> = {};
  const nom = c.name.trim().toLowerCase();
  // Dernière mesure du calculateur, par plateforme.
  const derniere = new Map<string, { m: Mesure; date: string | null }>();
  for (const m of mesures) {
    if ((m.creator ?? "").trim().toLowerCase() !== nom) continue;
    const pf = String(m.platform ?? "").trim().toLowerCase();
    if (!pf) continue;
    const date = jourIso(m.date);
    const cur = derniere.get(pf);
    if (!cur || (date ?? "") > (cur.date ?? "")) derniere.set(pf, { m, date });
  }
  for (const [pf, { m, date }] of derniere) {
    const o = (out[pf] ??= {});
    const f = positif(m.followers);
    if (f) o.abonnes = { valeur: f, date, source: "mesure du calculateur" };
    const er = taux(m.er);
    if (er) o.engagement = { valeur: er, date, source: "mesure du calculateur" };
  }
  // Relevés automatiques (date du dernier relevé RÉUSSI : `ok`).
  const auto = (pf: Plateforme, blob: Json | null, champ: string, vues: unknown, vuesDate: unknown) => {
    if (!blob) return;
    const o = (out[pf] ??= {});
    const date = jourIso(blob.ok);
    const f = blob.hiddenSubs ? null : positif(blob[champ]);
    if (f && date) o.abonnes = plusRecent(o.abonnes ?? null, { valeur: f, date, source: "relevé automatique" }) ?? undefined;
    const v = positif(vues);
    const vd = jourIso(vuesDate);
    if (v && vd) o.vues = { valeur: v, date: vd, source: "relevé automatique" };
  };
  const ig = obj(c.ig);
  const ins = obj(ig?.insights);
  auto("instagram", ig, "followers", ins?.reelViews, ins?.at);
  const tt = obj(c.tt);
  auto("tiktok", tt, "followers", tt?.avgViews, tt?.ok);
  const yt = obj(c.yt);
  auto("youtube", yt, "subscribers", yt?.avgViews, yt?.ok);
  return out;
}

/** Chiffres du kit, par plateforme (blocs `mediakit.platforms`). */
export function chiffresDuKit(mediakit: unknown): { plateforme: string; chiffre: Chiffre; valeur: number }[] {
  const pfs = obj(mediakit)?.platforms;
  if (!Array.isArray(pfs)) return [];
  const out: { plateforme: string; chiffre: Chiffre; valeur: number }[] = [];
  const vus = new Set<string>();
  for (const p of pfs) {
    const b = obj(p);
    const key = String(b?.key ?? "").trim().toLowerCase();
    if (!b || !key || vus.has(key)) continue;
    vus.add(key);
    const f = positif(b.followers);
    if (f) out.push({ plateforme: key, chiffre: "abonnes", valeur: f });
    const er = taux(b.er);
    if (er) out.push({ plateforme: key, chiffre: "engagement", valeur: er });
    const v = positif(b.avgViews);
    if (v) out.push({ plateforme: key, chiffre: "vues", valeur: v });
  }
  return out;
}

// ── Le verdict ───────────────────────────────────────────────────────────────

/** Compare chaque chiffre du kit au chiffre réel le plus récent. */
export function controlerKit(c: CreateurKit, mesures: Mesure[], maintenant: Date = new Date()): Controle {
  const reels = chiffresReels(c, mesures);
  const lignes: Ligne[] = chiffresDuKit(c.mediakit).map(({ plateforme, chiffre, valeur }) => {
    const label = `${NOM_PLATEFORME[plateforme] ?? plateforme}${chiffre === "abonnes" ? "" : ` (${NOM_CHIFFRE[chiffre]})`}`;
    const r = reels[plateforme]?.[chiffre];
    const base = { plateforme, chiffre, kit: valeur, source: r?.source ?? "" };
    if (!r) return { ...base, reel: null, date: null, etat: "a_verifier" as const, ecart: null, texte: `${label} : kit ${fmt(chiffre, valeur)}, aucun chiffre réel dans l'app` };
    const ecart = Math.abs(valeur - r.valeur) / r.valeur;
    if (!r.date || ageJours(r.date, maintenant) > FRAICHEUR_JOURS) {
      return { ...base, reel: r.valeur, date: r.date, etat: "a_verifier" as const, ecart, texte: `${label} : kit ${fmt(chiffre, valeur)}, dernier chiffre réel ${fmt(chiffre, r.valeur)}${r.date ? ` du ${jourCourt(r.date)}` : ""} (trop vieux)` };
    }
    const faux = ecart > SEUILS[chiffre] && (chiffre !== "engagement" || Math.abs(valeur - r.valeur) >= ECART_MIN_POINTS);
    return {
      ...base, reel: r.valeur, date: r.date, ecart,
      etat: faux ? ("a_corriger" as const) : ("ok" as const),
      texte: `${label} : kit ${fmt(chiffre, valeur)}, réel ${fmt(chiffre, r.valeur)}`,
    };
  });
  const aCorriger = lignes.filter((l) => l.etat === "a_corriger");
  const aVerifier = lignes.filter((l) => l.etat === "a_verifier");
  return { etat: !lignes.length ? "sans_kit" : aCorriger.length ? "a_corriger" : aVerifier.length ? "a_verifier" : "ok", lignes, aCorriger, aVerifier };
}

/** « Instagram : kit 210 K, réel 5,9 K · TikTok : … » (les chiffres à corriger). */
export const resumeACorriger = (c: Controle) => c.aCorriger.map((l) => l.texte).join(" · ");

/**
 * Les corrections à passer à maj_chiffres_mediakit / appliquerChiffres : les chiffres réels
 * des lignes « à corriger », regroupés par plateforme.
 */
export function corrections(c: Controle): { plateforme: string; abonnes?: number; engagement?: number; vues_moyennes?: number }[] {
  const par = new Map<string, { plateforme: string; abonnes?: number; engagement?: number; vues_moyennes?: number }>();
  for (const l of c.aCorriger) {
    if (l.reel == null || !(PLATEFORMES as string[]).includes(l.plateforme)) continue;
    const o = par.get(l.plateforme) ?? { plateforme: l.plateforme };
    if (l.chiffre === "abonnes") o.abonnes = Math.round(l.reel);
    else if (l.chiffre === "engagement") o.engagement = Math.round(l.reel * 100) / 100;
    else o.vues_moyennes = Math.round(l.reel);
    par.set(l.plateforme, o);
  }
  return [...par.values()];
}

/** Applique au kit les chiffres réels des lignes « à corriger » (rien d'autre ne bouge). */
export function appliquerCorrections(mediakit: unknown, controle: Controle): { mediakit: Json; changements: string[] } | { error: string } {
  let mk: unknown = mediakit;
  const changements: string[] = [];
  for (const c of corrections(controle)) {
    const r = appliquerChiffres(mk, c);
    if ("error" in r) return { error: r.error };
    mk = r.mediakit;
    changements.push(...r.changements.map((x) => `${NOM_PLATEFORME[c.plateforme] ?? c.plateforme} ${x}`));
  }
  return { mediakit: (obj(mk) ?? {}) as Json, changements };
}

/** Un kit minimal fait des chiffres d'abonnés LUS dans un PDF hors de l'app (pour le comparer). */
export function kitDeclare(abonnes: Partial<Record<string, unknown>>): Json {
  return {
    platforms: Object.entries(abonnes)
      .filter(([k, v]) => !!NOM_PLATEFORME[k] && positif(v) != null)
      .map(([key, v]) => ({ key, followers: String(positif(v)) })),
  };
}

/** Texte pour Alfred (fiche_createur et refus des mails). */
export function texteControle(nom: string, c: Controle): string {
  if (c.etat === "sans_kit") return `Media kit de ${nom} : aucun chiffre dans le kit de l'app (page Media kit).`;
  if (c.etat === "ok") return `Media kit de ${nom} : chiffres conformes aux chiffres réels.`;
  const out: string[] = [];
  if (c.aCorriger.length) out.push(`Media kit de ${nom} À CORRIGER (écart de plus de ${SEUILS.abonnes * 100} % sur les abonnés, ${SEUILS.engagement * 100} % sur l'engagement ou les vues) :\n${c.aCorriger.map((l) => `• ${l.texte}`).join("\n")}`);
  if (c.aVerifier.length) out.push(`${c.aCorriger.length ? "À vérifier aussi" : `Media kit de ${nom} : chiffres à vérifier`} (pas de chiffre réel récent, rien n'est faux pour autant) :\n${c.aVerifier.map((l) => `• ${l.texte}`).join("\n")}`);
  return out.join("\n");
}

/** L'appel à faire pour corriger (après le « oui » de Marc). */
export function appelsCorrection(nom: string, c: Controle): string[] {
  return corrections(c).map((x) => {
    const args = [`createur: "${nom}"`, `plateforme: "${x.plateforme}"`];
    if (x.abonnes != null) args.push(`abonnes: "${x.abonnes}"`);
    if (x.engagement != null) args.push(`engagement: "${String(x.engagement).replace(".", ",")}"`);
    if (x.vues_moyennes != null) args.push(`vues_moyennes: "${x.vues_moyennes}"`);
    return `maj_chiffres_mediakit(${args.join(", ")})`;
  });
}

// ── Garde-fou des mails de prospection (connecteur) ─────────────────────────

/** Un fichier qui ressemble à un media kit (nom, chemin ou adresse). */
export const ressembleKit = (s: string) => /media[\s_-]*kit|mediakits?\//i.test(s) || /(^|[\s_\-/])kit([\s_\-.]|$)/i.test(s);

/** slugify() du site (même règle que src/lib/mediakitSlug.ts). */
export function slugSite(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[^\x00-\x7f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Les adresses de media kit en ligne citées (ttpcreators.pro/mediakit/<slug>) → slugs. */
export function slugsCites(texte: string): string[] {
  const out = new Set<string>();
  for (const m of texte.matchAll(/ttpcreators\.pro\/mediakit\/([a-z0-9-]+)/gi)) out.add(m[1].toLowerCase());
  return [...out];
}

export type PieceKit = { nom: string; site: boolean; slug: string | null };
/**
 * Les pièces jointes qui sont des media kits. `site` : le PDF en ligne du site
 * (ttpcreators.pro/mediakit/…), refait à partir du kit de l'app, donc vérifiable ;
 * sinon un PDF hors de l'app (page Documents, mail reçu, dépôt d'Alfred) dont l'app ne
 * connaît pas les chiffres.
 */
export function piecesKit(sources: unknown): PieceKit[] {
  const out: PieceKit[] = [];
  for (const s of Array.isArray(sources) ? sources : []) {
    const o = obj(s);
    if (!o) continue;
    const url = String(o.url ?? "").trim();
    if (url) {
      const m = /^https:\/\/(?:www\.)?ttpcreators\.pro\/mediakit\/([a-z0-9-]+)\//i.exec(url);
      if (m) out.push({ nom: url, site: true, slug: m[1].toLowerCase() });
      else if (ressembleKit(url)) out.push({ nom: url, site: false, slug: null });
      continue;
    }
    const nom = String(o.document ?? o.nom ?? "").trim();
    if (nom && ressembleKit(nom)) out.push({ nom, site: false, slug: null });
  }
  return out;
}

export type FicheRoster = CreateurKit & {
  id?: string;
  email?: unknown; email_pro?: unknown; handle?: unknown; instagram?: unknown; tiktok?: unknown; youtube?: unknown; status?: unknown;
};
export type IndicesMail = {
  /** Paramètre `createur` de l'outil. */
  createur?: string;
  /** Alias d'envoi (`envoyer_en_tant_que`) et la liste alias → créateur. */
  alias?: string;
  aliases?: { creator?: string | null; alias?: string | null }[];
  /** Destinataires visibles (À) : un créateur à qui l'on écrit n'est pas « proposé ». */
  a?: string[];
  /** Copies (Cc, Cci) : le créateur qui suit sa prospection. */
  copies?: string[];
  /** Objet et texte du mail (les @ cités, les liens de media kit). */
  texte?: string;
  /** Slugs des media kits joints (PDF du site). */
  slugs?: string[];
};

const plie = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const mail = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/^.*<([^>]+)>.*$/, "$1");
const pseudo = (s: unknown) => plie(s).replace(/^.*(instagram\.com|tiktok\.com|youtube\.com)\/@?/, "").replace(/^@+/, "").replace(/[/?#].*$/, "");

/** Les créateurs du roster concernés par un mail (proposés aux marques). */
export function createursDuMail(roster: FicheRoster[], ind: IndicesMail): FicheRoster[] {
  const trouves = new Map<string, FicheRoster>();
  const ajoute = (c: FicheRoster | undefined) => c && trouves.set(c.name, c);
  const nom = plie(ind.createur);
  if (nom) ajoute(roster.find((c) => plie(c.name) === nom) ?? roster.find((c) => plie(c.name).includes(nom) || (nom.length >= 4 && nom.includes(plie(c.name)))));
  const alias = mail(ind.alias);
  if (alias) {
    const qui = (ind.aliases ?? []).find((x) => mail(x.alias) === alias)?.creator;
    if (qui) ajoute(roster.find((c) => plie(c.name) === plie(qui)));
  }
  const copies = new Set((ind.copies ?? []).map(mail).filter(Boolean));
  for (const c of roster) if ([c.email, c.email_pro].some((e) => mail(e) && copies.has(mail(e)))) ajoute(c);
  const texte = plie(ind.texte);
  if (texte) {
    for (const c of roster) {
      const pseudos = [c.handle, c.instagram, c.tiktok, c.youtube].map(pseudo).filter((p) => p.length >= 3);
      if (pseudos.some((p) => new RegExp(`(^|[^a-z0-9._])@${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9_]|\\.[a-z0-9])`).test(texte))) ajoute(c);
    }
  }
  const slugs = new Set([...(ind.slugs ?? []), ...slugsCites(String(ind.texte ?? ""))].map((s) => s.toLowerCase()));
  if (slugs.size) {
    for (const c of roster) {
      const mk = obj(c.mediakit);
      const s = slugSite(String(mk?.slug ?? "")) || slugSite(c.name.trim().split(/\s+/)[0]);
      // Doublons du site (« -2 ») : le slug de base suffit à reconnaître le créateur.
      if ([...slugs].some((x) => x === s || x.replace(/-\d+$/, "") === s)) ajoute(c);
    }
  }
  // On écrit AU créateur (son adresse en À) : ce n'est pas une proposition à une marque.
  const a = new Set((ind.a ?? []).map(mail).filter(Boolean));
  return [...trouves.values()].filter((c) => ![c.email, c.email_pro].some((e) => mail(e) && a.has(mail(e))));
}

/**
 * Message de refus d'un mail de prospection (null : le mail peut partir).
 * `declares` : chiffres d'abonnés lus dans un PDF de kit hors de l'app, par créateur.
 */
export function refusProspection(
  createurs: { fiche: CreateurKit; controle: Controle; kitHorsApp: boolean; declares: Controle | null }[],
): string | null {
  const parts: string[] = [];
  for (const { fiche, controle, kitHorsApp, declares } of createurs) {
    const nom = fiche.name;
    if (kitHorsApp) {
      if (!declares) {
        parts.push(`${nom} : le media kit joint ne vient pas de la page Media kit de l'app, ses chiffres ne peuvent pas être vérifiés. Donne les abonnés écrits dans ce PDF avec \`chiffres_kit\` (ils seront comparés aux vrais), ou joins le PDF à jour du site (url ttpcreators.pro/mediakit/…).`);
        continue;
      }
      if (declares.etat === "a_corriger") {
        parts.push(`${nom} : le PDF joint annonce des chiffres faux. ${resumeACorriger(declares)}. Corrige le PDF (ou fais son kit dans l'app, page Media kit, et joins le PDF du site) avant de le joindre.`);
        continue;
      }
    }
    if (controle.etat === "a_corriger") {
      const appels = appelsCorrection(nom, controle);
      parts.push(`${nom} : media kit à corriger. ${resumeACorriger(controle)}.${appels.length ? ` Après le « oui » de Marc : ${appels.join(" ; ")}.` : ""} Ou bouton « Mettre à jour » sur la page Media kit de l'app.`);
    }
  }
  return parts.length ? `Rien n'est préparé ni envoyé : un media kit faux ne part pas en prospection.\n${parts.map((p) => `• ${p}`).join("\n")}` : null;
}
