// ============================================================================
// _shared/contactAjout.ts : ajouter un contact au carnet depuis le connecteur Claude
// (outils ajouter_contact et ajouter_contacts de ttp-mcp/tools.ts).
// ----------------------------------------------------------------------------
// Audit du 24 novembre 2026 (point M10) : l'outil ne gardait ni le LinkedIn ni la ville,
// acceptait une adresse illisible, et ne voyait un doublon que sur l'e-mail ou le @ exact.
// Résultat : 56 marques avec plusieurs fiches, et le risque d'écrire deux fois à la même
// marque. Ici : lecture et nettoyage d'une fiche, puis comparaison avec le carnet.
//   - même e-mail, même LinkedIn, ou même @ sans autre adresse : la fiche existe déjà ;
//   - même marque ou même domaine de société : on ajoute (une autre personne de la marque
//     est utile), mais on le dit, pour n'écrire qu'à une personne à la fois.
// Règles PURES, testées par contactAjout.test.ts.
// ============================================================================

import { normaliserTag } from "./contactTags.ts";
import { couper } from "./texteSur.ts";

/** Fiches par appel de l'outil ajouter_contacts. */
export const MAX_LOT_CONTACTS = 50;

// Coupé sans casser d'emoji, sans caractère nul (couper, _shared/texteSur.ts) : sinon la base refuse la fiche.
const txt = (v: unknown, max: number) => (typeof v === "string" ? couper(v.replace(/\s+/g, " ").trim(), max) : "");
const fold = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const EMAIL = /^[^@\s<>,;"']+@[^@\s<>,;"']+\.[a-z]{2,}$/;

/** Messageries grand public : l'adresse ne dit rien de la société. */
const PUBLICS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.fr", "outlook.com", "outlook.fr", "live.com", "live.fr",
  "yahoo.com", "yahoo.fr", "icloud.com", "me.com", "orange.fr", "free.fr", "sfr.fr", "laposte.net", "wanadoo.fr", "proton.me", "protonmail.com",
]);
/** Adresses Instagram qui ne sont pas un compte. */
const PAS_UN_COMPTE = new Set(["p", "reel", "reels", "stories", "explore", "tv", "accounts", "direct"]);

export type NouveauContact = {
  brand: string;
  person: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  email: string | null;
  instagram: string | null;
  phone: string | null;
  linkedin: string | null;
  city: string | null;
  tag: string;
  tone: string;
};
export type ContactExistant = { id: string; brand?: string | null; person?: string | null; email?: string | null; instagram?: string | null; linkedin?: string | null };

/** « https://www.instagram.com/Nova.Paris/?hl=fr », « @Nova.Paris » ou « nova.paris » → « @nova.paris » ; "" si illisible. */
export function compteInstagram(v: unknown): string {
  let t = txt(v, 200);
  const m = /instagram\.com\/([^/?#\s]+)/i.exec(t);
  if (m) t = m[1];
  t = t.replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(t) && !PAS_UN_COMPTE.has(t) ? `@${t}` : "";
}

/** Lien LinkedIn propre (profil ou page société, sans paramètres) ; "" si ce n'en est pas un. */
export function lienLinkedin(v: unknown): string {
  const m = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(in|company|pub)\/([^/?#\s]+)/i.exec(txt(v, 300));
  return m ? `https://www.linkedin.com/${m[1].toLowerCase()}/${m[2]}` : "";
}

/** Domaine de la société d'une adresse ; "" pour une messagerie grand public. */
export function domaineSociete(email: string | null | undefined): string {
  const d = String(email ?? "").trim().toLowerCase().split("@")[1] ?? "";
  return d && !PUBLICS.has(d) ? d : "";
}

/** Clé d'une marque : « K18 Hair », « k18hair » et « K18-Hair » sont la même. */
export function cleMarque(brand: string | null | undefined): string {
  return fold(String(brand ?? "")).replace(/[^a-z0-9]+/g, "");
}

/** Une fiche demandée par Claude, nettoyée ; ou la raison du refus. `remarques` = ce qui a été laissé vide. */
export function lireContact(a: unknown): { c: NouveauContact; remarques: string[] } | { erreur: string } {
  const o = (a && typeof a === "object" && !Array.isArray(a) ? a : {}) as Record<string, unknown>;
  const brand = txt(o.marque, 120);
  if (!brand) return { erreur: "il manque la marque" };
  const email = txt(o.email, 200).toLowerCase();
  if (email && !EMAIL.test(email)) return { erreur: `adresse e-mail illisible (${email})` };
  const remarques: string[] = [];
  const igBrut = txt(o.instagram, 200);
  const instagram = compteInstagram(igBrut);
  if (igBrut && !instagram) remarques.push(`compte Instagram illisible, laissé vide (${igBrut})`);
  const liBrut = txt(o.linkedin, 300);
  const linkedin = lienLinkedin(liBrut);
  if (liBrut && !linkedin) remarques.push("lien LinkedIn illisible, laissé vide");
  const first = txt(o.prenom, 60);
  const last = txt(o.nom, 60);
  const person = txt(o.personne, 120) || `${first} ${last}`.trim();
  return {
    c: {
      brand,
      person: person || null,
      first_name: first || null,
      last_name: last || null,
      role: txt(o.role, 80) || null,
      email: email || null,
      instagram: instagram || null,
      phone: txt(o.telephone, 40) || null,
      linkedin: linkedin || null,
      city: txt(o.ville, 80) || null,
      tag: normaliserTag(txt(o.categorie, 60), "Marque"),
      tone: "cyan",
    },
    remarques,
  };
}

/**
 * La fiche existe-t-elle déjà ? `identique` = la même fiche (rien à ajouter) ; `memeMarque` =
 * d'autres fiches de la même marque ou de la même société (on ajoute, mais on le dit).
 */
export function chercherDoublon(c: Pick<NouveauContact, "brand" | "email" | "instagram" | "linkedin" | "phone">, existants: readonly ContactExistant[]): { identique: ContactExistant | null; memeMarque: ContactExistant[] } {
  const email = (c.email ?? "").toLowerCase();
  const ig = c.instagram ?? "";
  const li = fold(c.linkedin ?? "");
  const cle = cleMarque(c.brand);
  const dom = domaineSociete(email);
  let identique: ContactExistant | null = null;
  const memeMarque: ContactExistant[] = [];
  for (const e of existants) {
    const eEmail = String(e.email ?? "").trim().toLowerCase();
    const memeEmail = !!email && eEmail === email;
    const memeLinkedin = !!li && fold(lienLinkedin(e.linkedin)) === li;
    // Même @ : la même fiche, sauf si les deux ont une adresse différente (deux personnes de la marque).
    const memeCompte = !!ig && compteInstagram(e.instagram) === ig && !(email && eEmail && eEmail !== email);
    if (memeEmail || memeLinkedin || memeCompte) {
      identique ??= e;
      continue;
    }
    if ((cle && cleMarque(e.brand) === cle) || (dom && domaineSociete(eEmail) === dom) || (ig && compteInstagram(e.instagram) === ig)) memeMarque.push(e);
  }
  // Marque déjà au carnet et rien de neuf pour la joindre : c'est la même fiche.
  if (!identique && memeMarque.length && !email && !li && !ig && !c.phone) identique = memeMarque[0];
  return { identique, memeMarque: identique ? [] : memeMarque };
}

export type Tri = {
  /** Fiches à créer, avec ce qu'il faut en dire. */
  aCreer: { c: NouveauContact; remarques: string[]; memeMarque: ContactExistant[] }[];
  /** Déjà au carnet (ou deux fois dans le même lot). */
  dejaLa: { marque: string; existant: ContactExistant }[];
  /** Fiches illisibles, avec la raison. */
  refuses: { marque: string; raison: string }[];
};

/** Trie un lot de fiches contre le carnet, et contre le lot lui-même. */
export function trierContacts(bruts: readonly unknown[], existants: readonly ContactExistant[]): Tri {
  const connus: ContactExistant[] = [...existants];
  const tri: Tri = { aCreer: [], dejaLa: [], refuses: [] };
  bruts.forEach((brut, i) => {
    const lu = lireContact(brut);
    const marque = txt((brut as Record<string, unknown> | null)?.marque, 120) || `fiche ${i + 1}`;
    if ("erreur" in lu) {
      tri.refuses.push({ marque, raison: lu.erreur });
      return;
    }
    const d = chercherDoublon(lu.c, connus);
    if (d.identique) {
      tri.dejaLa.push({ marque, existant: d.identique });
      return;
    }
    tri.aCreer.push({ c: lu.c, remarques: lu.remarques, memeMarque: d.memeMarque });
    connus.push({ id: "", brand: lu.c.brand, person: lu.c.person, email: lu.c.email, instagram: lu.c.instagram, linkedin: lu.c.linkedin });
  });
  return tri;
}

/** Une fiche existante en quelques mots, pour la citer dans une réponse. */
export function citerContact(e: ContactExistant): string {
  const qui = [txt(e.person, 80), txt(e.email, 120)].filter(Boolean).join(" · ") || txt(e.brand, 80) || "fiche sans nom";
  return e.id ? `${qui} [contact ${e.id}]` : `${qui} (dans ce lot)`;
}

/** L'alerte « cette marque a déjà des fiches », vide s'il n'y en a pas. */
export function alerteMemeMarque(memeMarque: readonly ContactExistant[]): string {
  if (!memeMarque.length) return "";
  const cites = memeMarque.slice(0, 4).map(citerContact).join(" ; ");
  return `⚠ Cette marque a déjà ${memeMarque.length} fiche(s) : ${cites}${memeMarque.length > 4 ? " ; …" : ""}. Écrire à une seule personne de la marque à la fois.`;
}
