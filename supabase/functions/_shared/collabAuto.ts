// ============================================================================
// _shared/collabAuto.ts : les étapes qui avancent toutes seules (logique PURE).
// ----------------------------------------------------------------------------
// Demande de Marc (23 novembre 2026) : les collabs ne doivent plus dériver de la réalité
// parce que tout est coché à la main. Trois faits font avancer les choses tout seuls :
//   • une facture de la collab passe « payée »   → étape 9 « Paiement marque reçu » ;
//   • un versement au créateur solde sa facture  → étape 10 « Créateur payé » ;
//   • une collab est créée ou marquée gagnée     → le prospect ouvert de la marque passe
//     « Signé » (relié à la collab).
// Jamais en arrière, jamais sur une collab perdue ou archivée, jamais sur une devinette :
// au moindre doute, rien. Partagé par l'app (src/lib/collabAuto.ts, collabAutoDb.ts) et par
// le connecteur Claude (_shared/collabAutoDb.ts). Testé par src/lib/collabAuto.test.ts.
// ============================================================================

import { foldName } from "./exclusivites.ts";

/** Étape « Paiement marque reçu ». */
export const ETAPE_PAIEMENT_MARQUE = 9;
/** Étape « Créateur payé » (même valeur que PAYOUT_STEP de src/lib/collabs.ts). */
export const ETAPE_CREATEUR_PAYE = 10;
/** Écart d'arrondi toléré sur un versement (même valeur que PAYOUT_TOLERANCE_EUR). */
export const TOLERANCE_EUR = 0.5;

/** Collabs qu'on ne fait jamais avancer toutes seules. */
const FIGEES = new Set(["perdue", "archivee"]);

export type CollabAuto = { id: string; brand: string | null; creator: string | null; step: number | null; status: string | null; cachet?: string | null; created_at?: string | null };

/**
 * Étape où la collab doit déjà être pour avancer toute seule (relecture de Marc) : une facture
 * payée ne vaut « Paiement marque reçu » qu'après la publication (étape 6 ; un acompte payé à
 * l'étape 2 ne fait rien), et un versement ne vaut « Créateur payé » qu'une fois la marque
 * payée (étape 9). En dessous : rien, le contrôle de données le signalera.
 */
export const PLANCHER: Record<number, number> = { [ETAPE_PAIEMENT_MARQUE]: 6, [ETAPE_CREATEUR_PAYE]: ETAPE_PAIEMENT_MARQUE };

/**
 * Étape à écrire pour que la collab atteigne `cible`, sinon null : collab absente, perdue ou
 * archivée, pas encore à l'étape plancher (PLANCHER), ou déjà à cette étape ou plus loin (on
 * ne recule jamais).
 */
export function etapeAAtteindre(c: Pick<CollabAuto, "step" | "status"> | null | undefined, cible: number): number | null {
  if (!c || FIGEES.has(String(c.status ?? ""))) return null;
  if (!(cible >= 1 && cible <= 11)) return null;
  const step = Number(c.step) || 0;
  if (step < (PLANCHER[cible] ?? 0)) return null;
  return step < cible ? cible : null;
}

// ── Facture payée → sa collab ───────────────────────────────────────────────
// Copie fidèle de guessCollabId("invoices") (src/lib/collabLinks.ts), le rapprochement
// déjà utilisé par la fiche collab et la page Compta : la marque est citée dans le libellé
// de la facture (« Nike × Léna ») et la facture concerne le créateur de la collab.

const fold = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const prenom = (s: unknown) => {
  const w = String(s ?? "").trim().split(/\s+/)[0] ?? "";
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : "";
};

function citeLaMarque(texte: unknown, marque: unknown): boolean {
  const b = fold(marque);
  if (b.length < 2) return false;
  const t = ` ${fold(texte).replace(/[^a-z0-9]+/g, " ")} `;
  return t.includes(` ${b.replace(/[^a-z0-9]+/g, " ").trim()} `);
}

function concerneLeCreateur(nom: unknown, createur: string | null): boolean {
  if (!createur) return true;
  const moi = fold(createur);
  const p = fold(prenom(createur));
  return String(nom ?? "").split(",").some((n) => fold(n) === moi || (!!p && fold(n) === p));
}

/**
 * Collab d'une facture : son lien enregistré (`collab_id`), sinon LA collab de même marque et
 * même créateur quand il n'y en a qu'une (toutes collabs confondues, même terminées) ; plusieurs
 * candidates ou aucune : null, on ne devine pas.
 */
export function collabDeFacture(
  f: { collab_id?: unknown; party?: unknown; creator?: unknown },
  collabs: readonly Pick<CollabAuto, "id" | "brand" | "creator">[],
): string | null {
  const own = String(f.collab_id ?? "").trim();
  if (own) return own;
  const hits = collabs.filter((c) => c.brand && citeLaMarque(f.party, c.brand) && concerneLeCreateur(f.creator, c.creator));
  return hits.length === 1 ? hits[0].id : null;
}

// ── Versement au créateur → collabs soldées ─────────────────────────────────

/** Part du créateur sur une facture payée par la marque (ligne de la page Reversements). */
export type LigneDue = { id: string; collabId: string | null; paidOn: string; du: number };

const cents = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 || 0 : 0);

/**
 * Collabs que ce versement solde, selon la règle de la page Reversements (les virements
 * couvrent les factures les plus anciennes d'abord) : celles dont la facture passe « Reversé »
 * grâce à lui. Doute = aucune : le versement laisse une facture à moitié payée, ou dépasse
 * tout ce qui restait dû. `dejaVerse` = total déjà versé au créateur AVANT ce versement.
 */
export function collabsSoldees(lignes: readonly LigneDue[], dejaVerse: number, montant: number): string[] {
  const m = cents(montant);
  if (!(m > TOLERANCE_EUR)) return [];
  const triees = [...lignes].sort((x, y) => x.paidOn.localeCompare(y.paidOn) || x.id.localeCompare(y.id));
  let avant = cents(Math.max(0, dejaVerse));
  let reste = m;
  const soldees: LigneDue[] = [];
  for (const l of triees) {
    const du = cents(l.du);
    const couvert = cents(Math.max(0, Math.min(du, avant)));
    avant = cents(avant - couvert);
    const ouvert = cents(du - couvert);
    if (ouvert <= TOLERANCE_EUR) continue;
    const pris = cents(Math.min(ouvert, reste));
    reste = cents(reste - pris);
    if (ouvert - pris <= TOLERANCE_EUR) soldees.push(l);
    else if (pris > TOLERANCE_EUR) return []; // facture à moitié payée : on ne sait pas laquelle était visée
  }
  if (reste > TOLERANCE_EUR) return []; // plus que tout ce qui restait dû : autre chose
  return [...new Set(soldees.map((l) => l.collabId).filter((x): x is string => !!x))];
}

// ── Collab signée → prospect de la marque ───────────────────────────────────

export type ProspectAuto = { id: string; brand: string | null; stage: string | null; creator?: string | null; collab_id?: string | null; created_at?: string | null };

/** Même marque, sans tenir compte de la casse, des accents, des espaces ni de la ponctuation
 *  (même règle que sameBrand de src/lib/brandRecord.ts). */
export function memeMarque(a: unknown, b: unknown): boolean {
  const x = foldName(String(a ?? "")).replace(/[' ]/g, "");
  const y = foldName(String(b ?? "")).replace(/[' ]/g, "");
  return !!x && x === y;
}

/** Prospect encore ouvert : ni signé, ni perdu. */
export function prospectOuvert(stage: unknown): boolean {
  const s = foldName(String(stage ?? ""));
  return !s.startsWith("sign") && !s.startsWith("perdu");
}

/** Cachet « gifting » (produits offerts, 0 €) : pas un deal signé. Même règle que dealKind
 *  (src/lib/dealKind.ts) : un montant au-dessus de 0 l'emporte. */
const GIFT = /\b(gift(ing|ed)?|offert|offerte|offerts|cadeau|produits?|en [ée]change|sans r[ée]mun[ée]ration|non r[ée]mun[ée]r[ée]|b[ée]n[ée]vole|free)\b/i;
export function cachetGifting(cachet: unknown): boolean {
  const t = String(cachet ?? "").trim();
  if (!t || /[1-9]/.test(t)) return false;
  return GIFT.test(t) || /\d/.test(t);
}

/**
 * Passage en « gagnée » qui vaut signature : explicite, avant l'étape 11. Une collab gagnée à
 * l'étape 11 (bilan, renouvellement) ne signe aucun prospect.
 */
export function gagneeHorsBilan(avant: unknown, apres: unknown, step: unknown): boolean {
  return apres === "gagnee" && avant !== "gagnee" && (Number(step) || 0) < 11;
}

/**
 * Prospect à passer « Signé » pour cette collab : le prospect ouvert de la même marque, créé
 * AVANT la collab (sans date connue d'un côté : doute), pas relié à une autre collab, et dont
 * le créateur est vide ou celui de la collab (jamais un prospect proposé pour un autre
 * créateur). Plusieurs : celui du même créateur s'il est seul ; sinon null (doute). Collab de
 * gifting : null.
 */
export function prospectASigner(
  prospects: readonly ProspectAuto[],
  collab: Pick<CollabAuto, "id" | "brand" | "creator" | "cachet" | "created_at">,
): ProspectAuto | null {
  if (!String(collab.brand ?? "").trim() || cachetGifting(collab.cachet)) return null;
  const cree = Date.parse(String(collab.created_at ?? ""));
  if (!Number.isFinite(cree)) return null;
  const moi = foldName(collab.creator);
  const bonCreateur = (p: ProspectAuto) => !foldName(p.creator) || foldName(p.creator) === moi;
  const avant = (p: ProspectAuto) => {
    const t = Date.parse(String(p.created_at ?? ""));
    return Number.isFinite(t) && t <= cree;
  };
  const candidats = prospects.filter((p) =>
    memeMarque(p.brand, collab.brand) && prospectOuvert(p.stage) && (!p.collab_id || p.collab_id === collab.id) && bonCreateur(p) && avant(p));
  if (candidats.length <= 1) return candidats[0] ?? null;
  const memeCreateur = moi ? candidats.filter((p) => foldName(p.creator) === moi) : [];
  return memeCreateur.length === 1 ? memeCreateur[0] : null;
}

// ── Textes du connecteur ────────────────────────────────────────────────────

const LIBELLES: Record<number, string> = { [ETAPE_PAIEMENT_MARQUE]: "Paiement marque reçu", [ETAPE_CREATEUR_PAYE]: "Créateur payé" };

/** Ligne ajoutée à la réponse d'un outil : « Collab Nike × Léna passée à l'étape 9 « Paiement marque reçu ». ». */
export function ligneAvance(a: { brand: string; creator: string | null; step: number }): string {
  const qui = String(a.creator ?? "").trim().split(/\s+/)[0] ?? "";
  const nom = [a.brand.trim(), qui ? qui.charAt(0).toUpperCase() + qui.slice(1).toLowerCase() : ""].filter(Boolean).join(" × ") || "sans nom";
  return `Collab ${nom} passée toute seule à l'étape ${a.step}${LIBELLES[a.step] ? ` « ${LIBELLES[a.step]} »` : ""}.`;
}

/** Ligne ajoutée à la réponse d'un outil quand un prospect passe « Signé ». */
export function ligneProspectSigne(brand: string): string {
  return `Prospect ${brand.trim() || "de la marque"} passé tout seul en « Signé », relié à la collab.`;
}
