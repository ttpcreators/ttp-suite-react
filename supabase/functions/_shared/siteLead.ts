// ============================================================================
// _shared/siteLead.ts : formulaires publics du site (ttpcreators.pro).
// 1. Une marque demande le roster, stratégie du 20 nov. 2026 (« sur le site, un formulaire
//    recevoir le roster ») : la demande devient un contact « Lead site » du carnet, avec une
//    touche « réponse » datée, et une tâche de tri pour Gianni (question du budget).
// 2. Un créateur veut rejoindre l'agence (formulaire « Rejoindre l'agence » de l'accueil
//    Bureau, 27 nov. 2026) : la candidature devient un profil du scouting créateurs
//    (creator_pool), avec une tâche de tri.
// Règles PURES, testées par siteLead.test.ts. Endpoint public : rien de ce que tape le
// visiteur ne part dans une notification (même règle que report-error).
// Textes coupés sans casser d'emoji (couper, _shared/texteSur.ts) : ils vont en base.
// ============================================================================

import { couper } from "./texteSur.ts";

export const LEAD_TAG = "Lead site";
export const ROSTER_URL = "https://ttpcreators.pro/mediakit/agence/";
export const LEAD_ORIGINS = ["https://ttpcreators.pro", "https://www.ttpcreators.pro", "http://localhost:5173"];
/** Au-delà, on refuse pour l'heure (robot) : la page reste utilisable avec le lien mail. */
export const LEADS_PAR_HEURE = 30;

export type Lead = { email: string; marque: string; nom: string; message: string };

// « * » refusé : dans un filtre ilike, PostgREST le lit comme un joker et rien ne peut l'échapper.
const EMAIL_RE = /^[^@\s<>"',;:*]{1,64}@[^@\s<>"',;:*]{1,190}\.[a-z]{2,24}$/i;
/** Texte d'une ligne, sans caractères de contrôle ni balises. */
const propre = (v: unknown, max: number) =>
  couper(String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim(), max);
/** Message libre : retours à la ligne gardés, sans caractères de contrôle ni balises. */
const texte = (v: unknown) => couper(String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, " ").trim(), 1500);

/** Demande lue et nettoyée, ou la raison du refus. `piege` rempli = robot. */
export function lireLead(body: unknown): { lead: Lead } | { robot: true } | { erreur: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (propre(b.site, 200)) return { robot: true };
  const email = propre(b.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return { erreur: "email" };
  const marque = propre(b.marque, 80);
  if (!marque) return { erreur: "marque" };
  return { lead: { email, marque, nom: propre(b.nom, 80), message: texte(b.message) } };
}

/** Valeur d'un filtre ilike qui ne trouve QUE ce texte : « % » et « _ » perdent leur rôle de joker.
 *  « * » (joker de PostgREST) ne peut pas être échappé : les valeurs qui en contiennent sont refusées avant. */
export function ilikeExact(v: string): string {
  return v.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** La touche du journal de contact pour cette demande. */
export function toucheLead(lead: Lead, now: Date) {
  return {
    id: `site${now.getTime().toString(36)}`,
    date: now.toISOString(),
    canal: "email",
    kind: "reponse",
    note: `Demande du roster via le site${lead.message ? ` : ${couper(lead.message, 300)}` : ""}`,
  };
}

/** La tâche de tri : format fixe, la marque seule vient du visiteur (nettoyée, courte). */
export function tacheLead(lead: Lead): string {
  return `Lead site : ${couper(lead.marque, 60)} demande le roster (tri : question du budget)`;
}

// ── Candidature d'un créateur : POST { type: "createur", nom, email, compte, reseau?, niche?, message?, site? } ──

export const CANDIDATURE_NOTE = "Candidature via le site";
export const CANDIDATURE_TACHE = "Candidature site : ";

export type Reseau = "instagram" | "tiktok";
export type Candidature = { email: string; nom: string; compte: string; reseau: Reseau; niche: string; message: string };

/** Compte Instagram ou TikTok : lettres, chiffres, point et tiret bas, 30 caractères au plus. */
const COMPTE_RE = /^[a-z0-9._]{1,30}$/i;
/** Premiers segments d'un lien qui désignent une publication, pas un compte. */
const PAS_UN_COMPTE = new Set(["p", "reel", "reels", "tv", "explore", "accounts", "direct", "share", "_u", "video", "photo", "tag", "discover", "music"]);

/** Jour à Paris (AAAA-MM-JJ) : une candidature de 23 h 30 à Paris est datée du bon jour. */
export function jourParis(now: Date): string {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** « @compte », « compte » ou lien du profil Instagram / TikTok → le compte et son réseau ; null si ce n'est pas un compte
 *  (lien d'une publication, d'un reel…). Le réseau d'un lien l'emporte sur celui choisi dans le formulaire. */
export function lireCompte(v: unknown, reseau?: unknown): { compte: string; reseau: Reseau } | null {
  const brut = propre(v, 200);
  const lien = /^(?:https?:\/\/)?(?:www\.|m\.)?(instagram\.com|tiktok\.com)\/(.*)$/i.exec(brut);
  if (!lien) {
    const compte = brut.replace(/^@+/, "");
    return COMPTE_RE.test(compte) ? { compte, reseau: reseau === "tiktok" ? "tiktok" : "instagram" } : null;
  }
  const parts = lien[2].split(/[/?#]/).filter(Boolean);
  let premier = (parts[0] ?? "").replace(/^@+/, "");
  if (premier.toLowerCase() === "stories") premier = (parts[1] ?? "").replace(/^@+/, "");
  else if (PAS_UN_COMPTE.has(premier.toLowerCase())) return null;
  return COMPTE_RE.test(premier) ? { compte: premier, reseau: lien[1].toLowerCase() === "tiktok.com" ? "tiktok" : "instagram" } : null;
}

/** Le compte nettoyé d'une ligne du scouting (@compte, lien Instagram ou TikTok), en minuscules, pour comparer. */
export function compteNettoye(handle: unknown): string {
  return lireCompte(handle)?.compte.toLowerCase() ?? "";
}

/** Candidature lue et nettoyée, ou la raison du refus. `site` rempli = robot. */
export function lireCandidature(body: unknown): { cand: Candidature } | { robot: true } | { erreur: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (propre(b.site, 200)) return { robot: true };
  const email = propre(b.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return { erreur: "email" };
  const nom = propre(b.nom, 80);
  if (!nom) return { erreur: "nom" };
  const c = lireCompte(b.compte, b.reseau);
  if (!c) return { erreur: "compte" };
  return { cand: { email, nom, compte: `@${c.compte}`, reseau: c.reseau, niche: propre(b.niche, 40), message: texte(b.message) } };
}

const nomReseau = (c: Candidature) => (c.reseau === "tiktok" ? "TikTok" : "Instagram");

/** Le compte tel que rangé au scouting : @compte (Instagram) ou lien du profil (TikTok, que Vivier ouvre sur TikTok). */
export function handleScouting(c: Candidature): string {
  return c.reseau === "tiktok" ? `https://www.tiktok.com/${c.compte}` : c.compte;
}

/** La note d'un NOUVEAU profil : la source, le jour, le réseau et le message du créateur. */
export function noteCandidature(c: Candidature, now: Date): string {
  return `${CANDIDATURE_NOTE} le ${jourParis(now)} (${nomReseau(c)})${c.message ? ` : ${c.message}` : ""}`;
}

/** La ligne ajoutée à un profil DÉJÀ au scouting : courte, le message est dans la tâche. */
export function ligneCandidature(c: Candidature, now: Date): string {
  return `${CANDIDATURE_NOTE} le ${jourParis(now)} : ${c.nom}, ${c.email} (${nomReseau(c)}), message dans la tâche`;
}

/** La note de l'agence reste entière et en tête ; la ligne n'est ajoutée qu'une fois. */
export function noteFusionnee(ancienne: unknown, ligne: string): string {
  const a = String(ancienne ?? "").trim();
  if (!a) return ligne;
  return a.includes(ligne) ? a : `${a}\n${ligne}`;
}

/** Le profil ajouté au scouting créateurs (creator_pool), sans son rang. */
export function ligneScouting(c: Candidature, now: Date) {
  return { name: c.nom, handle: handleScouting(c), email: c.email, tag: c.niche || null, note: noteCandidature(c, now) };
}

/** La tâche de tri : format fixe, le nom et le compte viennent du visiteur (nettoyés, courts). */
export function tacheCandidature(c: Candidature): string {
  return `${CANDIDATURE_TACHE}${couper(c.nom, 60)} (${c.compte}, ${nomReseau(c)}) veut rejoindre l'agence`;
}
