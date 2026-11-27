// ============================================================================
// _shared/igRetour.ts : règles PURES du retour d'Instagram (fonction ig-callback).
// ----------------------------------------------------------------------------
// • dureeState(via) : temps accepté entre le départ vers Instagram et le retour.
//   30 min pour un départ par LIEN (le créateur ouvre le lien sur son téléphone, se
//   connecte à Instagram, parfois avec un code de vérification), 10 min depuis l'app.
//   La signature du state ne change pas ; le départ (`via`) voyage dans le state signé,
//   il ne peut pas être changé de l'extérieur. Le lien lui-même reste valable 7 jours.
// • Tâche interne « Aider <prénom> à connecter Instagram » : créée après 2 essais ratés
//   en 24 h, EN PLUS du push aux fondateurs ; une seule ouverte par créateur ; jamais
//   visible par lui (visible_createur false, sans étiquette « Claude ») ; cochée toute
//   seule quand la connexion réussit.
// Testé par igRetour.test.ts.
// ============================================================================

import { STATE_TTL_MS } from "./state.ts";
import { type EssaiIg, essaisRates } from "./igConnexion.ts";
import { deepLinkUrl } from "./pushPayload.ts";

/** Durée acceptée pour un départ par lien. */
export const DUREE_STATE_LIEN_MS = 30 * 60_000;

/** Départ par lien : « lien » (anciens jetons) ou « lien:<date du lien> ». */
export const departParLien = (via?: string | null): boolean => via === "lien" || String(via ?? "").startsWith("lien:");

/** Temps accepté entre le départ vers Instagram et le retour, selon le départ. */
export const dureeState = (via?: string | null): number => (departParLien(via) ? DUREE_STATE_LIEN_MS : STATE_TTL_MS);

/** Le state (signature déjà vérifiée) a-t-il dépassé son temps ? */
export const stateExpire = (p: { iat: number; via?: string | null }, now = Date.now()): boolean => now - p.iat > dureeState(p.via);

/** Message noté dans ig_connexions quand le retour arrive trop tard. */
export const messageExpire = (via?: string | null): string =>
  `state_expired (plus de ${Math.round(dureeState(via) / 60_000)} minutes entre le départ et le retour)`;

// ── Tâche « Aider … à connecter Instagram » ─────────────────────────────────
/** Essais ratés (depuis la dernière réussite) qui déclenchent la tâche. */
export const ECHECS_AVANT_AIDE = 2;
/** Fenêtre où l'on compte ces essais. */
export const FENETRE_AIDE_MS = 24 * 3600_000;
/** « Fait par » de la tâche cochée toute seule. */
export const FAIT_PAR_AIDE = "Automatique (Instagram connecté)";

/** Prénom affiché : premier mot du nom, première lettre en majuscule (« le créateur » si vide). */
export function prenomAide(nom: string | null | undefined): string {
  const w = String(nom ?? "").trim().split(/\s+/)[0] ?? "";
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : "le créateur";
}

/** Titre de la tâche (sert aussi à retrouver la tâche ouverte). */
export const titreAide = (nom: string): string => `Aider ${prenomAide(nom)} à connecter Instagram`;

/** Essais ratés depuis la dernière réussite, sur les dernières 24 h (liste du plus récent au plus ancien). */
export function ratesRecents(essais: readonly EssaiIg[], now = Date.now()): number {
  return essaisRates(essais.filter((e) => now - Date.parse(e.at) <= FENETRE_AIDE_MS));
}

/** La tâche est-elle due ? */
export const fautAide = (essais: readonly EssaiIg[], now = Date.now()): boolean => ratesRecents(essais, now) >= ECHECS_AVANT_AIDE;

/** Jour à Paris (AAAA-MM-JJ), pour l'échéance. */
export const jourParis = (d: Date): string =>
  new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Ce que l'agence lit dans la tâche : où voir le détail, et quoi vérifier ensemble. */
export function texteAide(rates: number): string {
  return [
    `${rates} essais ratés en 24 h. Le détail (raison, message de Meta) est sur sa fiche, carte Instagram.`,
    "À vérifier ensemble :",
    "1. compte Instagram Professionnel ou Créateur ;",
    "2. tant que Meta n'a pas validé l'app : son @ ajouté comme « Testeur Instagram » (Meta › Rôles dans l'application), invitation acceptée dans Instagram › Paramètres › Sites web et apps ;",
    "3. lien neuf (carte Instagram › Copier le lien de connexion), en restant en ligne pendant la connexion.",
    "La tâche se coche toute seule quand la connexion réussit.",
  ].join("\n");
}

/** Ligne à insérer dans todos. Interne : visible_createur false, pour_createur laissé à sa valeur par défaut (false). */
export function ligneAide(o: { nom: string; creatorId: string; rates: number; now: Date }): Record<string, unknown> {
  return {
    text: titreAide(o.nom),
    descr: texteAide(o.rates),
    due: jourParis(o.now),
    creator: o.nom,
    creators: [o.nom],
    tag: "CRÉATEUR",
    priority: "moyenne",
    source: "agency",
    status: "À faire",
    done: false,
    visible_createur: false,
    sort_order: Math.floor(o.now.getTime() / 1000),
    attachments: [{ name: "Voir sa fiche", size: "", path: deepLinkUrl({ open: "view", view: "roster", item: o.creatorId }) }],
  };
}

/** Champs de la tâche cochée toute seule (connexion réussie). */
export function aideFaite(descr: string | null | undefined, now: Date): Record<string, unknown> {
  const jour = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short" }).format(now);
  return {
    done: true,
    status: "Fait",
    done_at: now.toISOString(),
    done_by: FAIT_PAR_AIDE,
    descr: [descr ?? "", `Cochée toute seule le ${jour} : Instagram connecté.`].filter(Boolean).join("\n\n"),
  };
}
