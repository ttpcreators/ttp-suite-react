// ============================================================================
// _shared/agenceDetection.ts : un créateur est-il déjà dans une agence ?
// ----------------------------------------------------------------------------
// Logique PURE (sans réseau), testée par agenceDetection.test.ts. Utilisée par les
// outils `lire_profil_instagram`, `lire_profils_instagram` et `scanner_base_createurs`
// du connecteur Claude (via profilInstagram.ts), qui rangent le résultat dans la Base
// créateurs (ig_profiles : colonnes agence / agence_nom, et data.agency).
//
// Réponse : agence = « oui » (indice net : agence connue, email ou @ d'agence, « représentée
// par X »), « a_verifier » (un mot seulement : management, booking, talent…), ou « non ».
// agence_nom = le nom trouvé (agence connue, @, domaine de l'email, texte après « par »).
//
// La liste des agences connues est courte et volontairement prudente : la compléter ici
// (nom, comptes Instagram sans @, domaines). Les agences concurrentes suivies dans
// l'app (page Sourcing › Concurrents, table ig_rivals) s'y ajoutent toutes seules.
// ============================================================================

import { FREE_MAIL, emailsIn } from "./signals.ts";

export type AgenceStatut = "oui" | "non" | "a_verifier";
export type AgenceConnue = { nom: string; comptes?: string[]; domaines?: string[] };
export type AgenceDetection = { agence: AgenceStatut; agence_nom: string | null; indices: string[] };
export type AgenceEntree = {
  username?: string;
  name?: string;
  bio?: string;
  email?: string;
  website?: string;
  /** Indice déjà relevé par le Sourcing (ig_profiles.data.agency), s'il y en a un. */
  indiceSourcing?: string | null;
};

/** Agences connues. TTP en fait partie : un créateur qui nous cite est chez nous. */
export const AGENCES_CONNUES: AgenceConnue[] = [
  { nom: "TTP Creators", comptes: ["ttpcreators", "ttp.creators"], domaines: ["ttpcreators.pro"] },
  { nom: "Follow Agency", comptes: ["wearefollow", "agencefollow"] },
  { nom: "IMG Models", comptes: ["imgmodels"], domaines: ["imgmodels.com"] },
  { nom: "Wilhelmina", comptes: ["wilhelminamodels"], domaines: ["wilhelmina.com"] },
  { nom: "Next Management", comptes: ["nextmodels"], domaines: ["nextmanagement.com"] },
];

/** Ajoute les agences concurrentes suivies (ig_rivals, sauf le compte de TTP). */
export function agencesAvecSuivies(base: AgenceConnue[], suivies: { username: string; name?: string | null; self?: boolean | null }[]): AgenceConnue[] {
  const out = base.map((a) => ({ ...a, comptes: [...(a.comptes ?? [])] }));
  for (const r of suivies) {
    const u = cleanHandle(r.username);
    if (!u || r.self) continue;
    if (out.some((a) => a.comptes?.includes(u))) continue;
    out.push({ nom: (r.name ?? "").trim() || `@${u}`, comptes: [u] });
  }
  return out;
}

const MOTS_AGENCE = /(agency|agence|agences|mgmt|management|talents?|booking)/i;
/** « représentée par X », « managed by X »… (X = la suite, jusqu'à une ponctuation). */
const FORT = /(repr[ée]sent[ée]e?s?\s+par|represented\s+by|managed\s+by|management\s+by|g[ée]r[ée]e?s?\s+par|sign[ée]e?s?\s+chez|signed\s+(?:with|to)|under\s+management\s+(?:of|with)|talent\s+manager\s*:|management\s*:|mgmt\s*:|agence\s*:|agency\s*:)\s*([^\n|•·,;!?]{0,60})/i;
const FAIBLE = /(?<![\p{L}\p{N}])(management|mgmt|agency|agence|booking|talent\s*manager|talents?|repr[ée]sent[ée]e?)(?![\p{L}\p{N}])/iu;

const deburr = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const cleanHandle = (h: string) => h.trim().replace(/^@/, "").toLowerCase();
const hostOf = (raw: string): string => {
  const t = raw.trim();
  if (!t) return "";
  try {
    return new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};
const memeDomaine = (host: string, d: string) => host === d || host.endsWith(`.${d}`);
const extrait = (text: string, i: number, n: number) => text.slice(Math.max(0, i - 20), i + n + 20).replace(/\s+/g, " ").trim();

/** Comptes @ cités dans un texte (sans @, en minuscules). */
export function comptesCites(text: string): string[] {
  return [...new Set([...text.matchAll(/(?<![\w.])@([a-z0-9._]{2,30})/gi)].map((m) => m[1].replace(/\.+$/, "").toLowerCase()))];
}

/** Nom propre d'une suite de texte après « représentée par » : sans @, sans espace final. */
function nomApres(s: string): string {
  return s.replace(/^[\s:–—-]+/, "").replace(/\s+/g, " ").trim().replace(/^@/, "").slice(0, 50).trim();
}

/** Détecte l'agence d'un créateur d'après sa bio, son email, son site et ses @ cités. */
export function detecterAgence(e: AgenceEntree, agences: AgenceConnue[] = AGENCES_CONNUES): AgenceDetection {
  const bio = `${e.name ?? ""}\n${e.bio ?? ""}`;
  const moi = cleanHandle(e.username ?? "");
  const emails = [...new Set([...(e.email ? [e.email.toLowerCase()] : []), ...emailsIn(e.bio ?? "")])];
  const site = hostOf(e.website ?? "");
  const cites = comptesCites(bio).filter((u) => u !== moi);
  const bioPlate = ` ${deburr(bio).replace(/[^a-z0-9]+/g, " ")} `;
  const indices: string[] = [];

  // 1. Agence connue : @ cité, domaine de l'email ou du site, nom dans la bio.
  for (const a of agences) {
    const compte = (a.comptes ?? []).find((c) => cites.includes(c));
    if (compte) return { agence: "oui", agence_nom: a.nom, indices: [`@${compte} cité dans la bio`] };
    const dom = (a.domaines ?? []).find((d) => emails.some((m) => memeDomaine(m.split("@")[1] ?? "", d)) || (site && memeDomaine(site, d)));
    if (dom) return { agence: "oui", agence_nom: a.nom, indices: [`domaine ${dom}`] };
    const nom = ` ${deburr(a.nom).replace(/[^a-z0-9]+/g, " ").trim()} `;
    if (nom.trim().length >= 5 && bioPlate.includes(nom)) return { agence: "oui", agence_nom: a.nom, indices: [`« ${a.nom} » dans la bio`] };
  }

  // 2. Email sur un domaine d'agence (pas une messagerie gratuite).
  for (const m of emails) {
    const dom = m.split("@")[1] ?? "";
    if (!dom || FREE_MAIL.test(m)) continue;
    if (MOTS_AGENCE.test(dom.replace(/\.[a-z]{2,}$/, ""))) return { agence: "oui", agence_nom: dom, indices: [`email ${m}`] };
  }

  // 3. Un @ d'agence cité dans la bio.
  const compteAgence = cites.find((u) => MOTS_AGENCE.test(u));
  if (compteAgence) return { agence: "oui", agence_nom: `@${compteAgence}`, indices: [`@${compteAgence} cité dans la bio`] };

  // 4. « Représentée par X », « management : X ».
  const f = FORT.exec(bio);
  if (f) {
    const nom = nomApres(f[2] ?? "");
    // « management : moi@gmail.com » = le créateur se gère seul ; « management : » vide = à vérifier.
    const soiMeme = !nom || /@[a-z0-9-]+\./i.test(nom) || /^(dm|mp|email|mail|contact)\b/i.test(nom);
    if (!soiMeme) return { agence: "oui", agence_nom: nom, indices: [`« ${extrait(bio, f.index, f[0].length)} »`] };
    indices.push(`« ${extrait(bio, f.index, f[1].length)} »`);
  }

  // 5. Un mot seulement, un site au nom d'agence, ou un indice du Sourcing : à vérifier.
  // Les @ cités sont déjà vus à l'étape 3 (son propre compte « talents.zoe » ne compte pas).
  const sansComptes = bio.replace(/(?<![\w.])@[a-z0-9._]{2,30}/gi, " ");
  const w = FAIBLE.exec(sansComptes);
  if (w && !indices.length) indices.push(`« ${extrait(sansComptes, w.index, w[0].length)} »`);
  if (site && MOTS_AGENCE.test(site.replace(/\.[a-z]{2,}$/, ""))) indices.push(`site ${site}`);
  if (e.indiceSourcing && e.indiceSourcing.trim()) indices.push(`indice du Sourcing : ${e.indiceSourcing.trim().slice(0, 80)}`);
  if (indices.length) return { agence: "a_verifier", agence_nom: null, indices };
  return { agence: "non", agence_nom: null, indices: [] };
}

/** Texte court pour Claude : « oui (Nom) », « à vérifier (indice) », « non ». */
export function texteAgence(d: AgenceDetection): string {
  if (d.agence === "oui") return `oui${d.agence_nom ? ` (${d.agence_nom})` : ""}`;
  if (d.agence === "a_verifier") return `à vérifier${d.indices.length ? ` (${d.indices.join(" ; ")})` : ""}`;
  return "non";
}
