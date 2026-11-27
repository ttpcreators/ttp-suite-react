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
// ============================================================================

export const LEAD_TAG = "Lead site";
export const ROSTER_URL = "https://ttpcreators.pro/mediakit/agence/";
export const LEAD_ORIGINS = ["https://ttpcreators.pro", "https://www.ttpcreators.pro", "http://localhost:5173"];
/** Au-delà, on refuse pour l'heure (robot) : la page reste utilisable avec le lien mail. */
export const LEADS_PAR_HEURE = 30;

export type Lead = { email: string; marque: string; nom: string; message: string };

const EMAIL_RE = /^[^@\s<>"',;:]{1,64}@[^@\s<>"',;:]{1,190}\.[a-z]{2,24}$/i;
/** Texte d'une ligne, sans caractères de contrôle ni balises. */
const propre = (v: unknown, max: number) =>
  String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
/** Message libre : retours à la ligne gardés, sans caractères de contrôle ni balises. */
const texte = (v: unknown) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, " ").trim().slice(0, 1500);

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

/** Valeur d'un filtre ilike qui ne trouve QUE ce texte : « % » et « _ » perdent leur rôle de joker. */
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
    note: `Demande du roster via le site${lead.message ? ` : ${lead.message.slice(0, 300)}` : ""}`,
  };
}

/** La tâche de tri : format fixe, la marque seule vient du visiteur (nettoyée, courte). */
export function tacheLead(lead: Lead): string {
  return `Lead site : ${lead.marque.slice(0, 60)} demande le roster (tri : question du budget)`;
}

// ── Candidature d'un créateur : POST { type: "createur", nom, email, compte, niche?, message?, site? } ──

export const CANDIDATURE_NOTE = "Candidature via le site";
export const CANDIDATURE_TACHE = "Candidature site : ";

export type Candidature = { email: string; nom: string; compte: string; niche: string; message: string };

/** Compte Instagram ou TikTok : lettres, chiffres, point et tiret bas, 30 caractères au plus. */
const COMPTE_RE = /^[a-z0-9._]{1,30}$/i;

/** Candidature lue et nettoyée, ou la raison du refus. `site` rempli = robot. */
export function lireCandidature(body: unknown): { cand: Candidature } | { robot: true } | { erreur: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (propre(b.site, 200)) return { robot: true };
  const email = propre(b.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return { erreur: "email" };
  const nom = propre(b.nom, 80);
  if (!nom) return { erreur: "nom" };
  // « @compte », « compte » ou le lien du profil Instagram / TikTok
  const compte = propre(b.compte, 200)
    .replace(/^(https?:\/\/)?(www\.|m\.)?(instagram\.com|tiktok\.com)\//i, "")
    .replace(/^@+/, "")
    .replace(/[/?#].*$/, "");
  if (!COMPTE_RE.test(compte)) return { erreur: "compte" };
  return { cand: { email, nom, compte: `@${compte}`, niche: propre(b.niche, 40), message: texte(b.message) } };
}

/** La note du profil de scouting : la source, la date et le message du créateur. */
export function noteCandidature(c: Candidature, now: Date): string {
  return `${CANDIDATURE_NOTE} le ${now.toISOString().slice(0, 10)}${c.message ? ` : ${c.message}` : ""}`.slice(0, 2000);
}

/** Le profil ajouté au scouting créateurs (creator_pool), sans son rang. */
export function ligneScouting(c: Candidature, now: Date) {
  return { name: c.nom, handle: c.compte, email: c.email, tag: c.niche || null, note: noteCandidature(c, now) };
}

/** La tâche de tri : format fixe, le nom et le compte viennent du visiteur (nettoyés, courts). */
export function tacheCandidature(c: Candidature): string {
  return `${CANDIDATURE_TACHE}${c.nom.slice(0, 60)} (${c.compte}) veut rejoindre l'agence`;
}
