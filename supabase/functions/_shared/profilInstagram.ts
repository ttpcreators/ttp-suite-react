// ============================================================================
// _shared/profilInstagram.ts : un profil Instagram lu par Business Discovery, résumé
// pour Claude et rangé dans la Base créateurs (ig_profiles).
// ----------------------------------------------------------------------------
// Logique PURE (sans réseau), testée par profilInstagram.test.ts. La lecture chez Meta
// et l'écriture en base sont dans profilInstagramDb.ts (outils lire_profil_instagram,
// lire_profils_instagram, scanner_base_createurs du connecteur Claude).
// Business Discovery ne voit que les comptes PROFESSIONNELS (créateur ou entreprise) :
// un compte personnel, privé ou introuvable répond la même erreur (« compte_perso »).
// ============================================================================

import { detecterAgence, texteAgence, type AgenceConnue, type AgenceDetection } from "./agenceDetection.ts";
import { emailsIn } from "./signals.ts";

type Json = Record<string, unknown>;

/** Ce que Business Discovery renvoie (même forme que IgProfile de instagram.ts). */
export type ProfilMeta = {
  username: string; name: string; bio: string; website: string; picture: string;
  followers: number; following: number; posts: number;
  media: { at: string; likes: number | null; comments: number }[];
};

export type ProfilResume = {
  username: string;
  nom: string;
  abonnes: number;
  abonnements: number;
  posts: number;
  bio: string;
  site: string;
  email: string;
  /** Engagement moyen sur les derniers posts (en %, formule commune), null si non mesurable. */
  engagement: number | null;
  postsMesures: number;
  dernierPost: string | null;
  parSemaine: number | null;
  photo: string;
  agence: AgenceDetection;
};

export const MAX_LOT = 100;
const USER = /^[a-z0-9._]{1,30}$/;

/** « @Zoe.Test », « instagram.com/zoe.test/ » → « zoe.test » ("" si illisible). */
export function compteDe(v: string): string {
  const u = v.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").toLowerCase();
  return USER.test(u) ? u : "";
}

/** Liste de @ : nettoyée, sans doublon, 100 au plus ; les illisibles à part. */
export function preparerComptes(list: unknown[], max = MAX_LOT): { comptes: string[]; illisibles: string[]; enTrop: number } {
  const comptes: string[] = [];
  const illisibles: string[] = [];
  for (const v of list) {
    const raw = typeof v === "string" ? v : "";
    const u = compteDe(raw);
    if (!u) {
      if (raw.trim()) illisibles.push(raw.trim().slice(0, 60));
      continue;
    }
    if (!comptes.includes(u)) comptes.push(u);
  }
  return { comptes: comptes.slice(0, max), illisibles, enTrop: Math.max(0, comptes.length - max) };
}

/** Profil Meta → résumé (email de la bio par regex, agence détectée). er et rythme : calculés par l'appelant. */
export function resumerProfil(p: ProfilMeta, mesures: { engagement: number | null; parSemaine: number | null }, agences?: AgenceConnue[], indiceSourcing?: string | null): ProfilResume {
  const email = emailsIn(p.bio)[0] ?? "";
  const dates = p.media.map((m) => m.at).filter((d) => d && !Number.isNaN(Date.parse(d))).sort();
  return {
    username: p.username.toLowerCase(), nom: p.name, abonnes: p.followers, abonnements: p.following, posts: p.posts,
    bio: p.bio, site: p.website, email,
    engagement: mesures.engagement, postsMesures: p.media.filter((m) => m.likes != null).length,
    dernierPost: dates.length ? dates[dates.length - 1] : null, parSemaine: mesures.parSemaine, photo: p.picture,
    agence: detecterAgence({ username: p.username, name: p.name, bio: p.bio, email, website: p.website, indiceSourcing }, agences),
  };
}

/**
 * Nouvelles données de ig_profiles.data : le profil lu remplace les chiffres, la bio, le site et
 * l'email ; ce que seul le Sourcing calcule (marques citées, « marque ou créateur ») est gardé.
 * La version `v` du Sourcing est gardée seulement si elle y était (sinon il relira le profil).
 */
export function donneesBase(prev: Json | null | undefined, r: ProfilResume, luLe: string): Json {
  const p = prev ?? {};
  const out: Json = {
    ...p,
    name: r.nom, followers: r.abonnes, following: r.abonnements, posts: r.posts,
    bio: r.bio.slice(0, 300), website: r.site,
    email: r.email || (typeof p.email === "string" ? p.email : ""),
    emailFrom: r.email ? "bio" : (p.emailFrom ?? ""),
    er: r.engagement, perWeek: r.parSemaine, lastPost: r.dernierPost,
    picture: r.photo || p.picture || "",
    // data.agency : ce que filtre « sans agence » de la Base. Un « oui » donne le nom ;
    // sinon l'indice du Sourcing (s'il y en avait un) reste.
    agency: r.agence.agence === "oui" ? r.agence.agence_nom || "oui" : (p.agency ?? null),
    agence: r.agence.agence, agence_nom: r.agence.agence_nom, profilLu: luLe,
  };
  delete out.pending;
  return out;
}

const compactFr = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M` : n >= 1e4 ? `${(n / 1e3).toLocaleString("fr-FR", { maximumFractionDigits: n < 1e5 ? 1 : 0 })} K` : n.toLocaleString("fr-FR");
const jourFr = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", year: "numeric" });

/** Texte d'un profil lu, pour Claude. */
export function texteProfil(r: ProfilResume, now = Date.now()): string {
  const jours = r.dernierPost ? Math.max(0, Math.round((now - Date.parse(r.dernierPost)) / 864e5)) : null;
  const tete = [
    `@${r.username}${r.nom ? ` (${r.nom})` : ""}`,
    `${compactFr(r.abonnes)} abonnés`,
    `${r.posts.toLocaleString("fr-FR")} posts`,
    r.engagement != null ? `engagement ${r.engagement.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} % (sur ${Math.min(12, r.postsMesures)} posts)` : "engagement non mesurable (likes masqués ou aucun post)",
    r.dernierPost ? `dernier post le ${jourFr(r.dernierPost)} (il y a ${jours} j)` : "aucun post visible",
  ];
  return [
    `- ${tete.join(" · ")}`,
    `  Email : ${r.email || "aucun dans la bio"} · Site : ${r.site || "aucun"} · Agence : ${texteAgence(r.agence)}`,
    r.bio ? `  Bio : ${r.bio.replace(/\s+/g, " ").slice(0, 300)}` : "  Bio : vide",
  ].join("\n");
}

/** Pourquoi un @ n'a pas pu être lu, en mots simples. */
export function raisonEchec(why: string): string {
  switch (why) {
    case "compte_perso": return "introuvable, privé ou compte personnel (Business Discovery ne voit que les comptes professionnels publics)";
    case "nom_invalide": return "@ illisible";
    case "meta_limite": return "limite de Meta atteinte, à relancer plus tard";
    case "quota_proche": return "pause : quota Meta à 80 %, à relancer dans une heure";
    case "meta_jeton": return "jeton Meta expiré (META_TOKEN à régénérer par Marc)";
    case "meta_autorisation": return "autorisation Meta manquante";
    case "meta_validation": return "fonction non validée par Meta";
    case "meta_non_configure": return "Meta pas configuré (META_TOKEN, META_IG_ID)";
    case "reseau": return "Meta n'a pas répondu";
    case "temps": return "pas lu faute de temps, à relancer";
    case "retire": return "retiré de la Base à sa demande (RGPD) : lu, rien enregistré";
    default: return `erreur Meta (${why})`;
  }
}
