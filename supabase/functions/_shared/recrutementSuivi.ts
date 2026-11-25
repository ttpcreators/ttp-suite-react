// ============================================================================
// _shared/recrutementSuivi.ts : le suivi du recrutement des créateurs (Scouting).
// ----------------------------------------------------------------------------
// Audit du 24 novembre 2026, points M13 et M22. Avant, rien ne disait quel créateur du
// Scouting avait déjà reçu un DM ou un mail, ni quand le relancer. Maintenant, chaque fiche
// du Scouting garde, dans son suivi (clé `poolTracking` du blob agence, entrée `recrut`) :
//   - la date du premier contact et le canal (DM ou mail) ;
//   - le nombre de relances faites et la date de la prochaine (J+5 puis J+12) ;
//   - « fini » après la deuxième relance sans réponse.
// Le statut affiché dans l'app (En observation, À contacter, En discussion…) ne change pas
// de place : il reste dans `status`. Rien n'est envoyé ici : le DM ou le mail part après le
// « oui » de Gianni, puis Claude note le contact (outil noter_contact_createur).
// Règles PURES, testées par recrutementSuivi.test.ts.
// ============================================================================

export type Canal = "dm" | "email";

export type SuiviRecrut = {
  /** Jour du premier contact (AAAA-MM-JJ, Paris). */
  premier: string;
  canal: Canal;
  /** Relances déjà faites (0, 1 ou 2). */
  relances: number;
  /** Jour de la prochaine relance, null = plus de relance prévue. */
  prochaine: string | null;
  /** Dernier contact (premier mail ou relance), AAAA-MM-JJ. */
  dernier: string;
  fini?: boolean;
};

/** Jours entre deux messages : relance 1 cinq jours après le premier, relance 2 sept jours après. */
export const ECARTS_RELANCE = [5, 7] as const;
export const MAX_RELANCES = ECARTS_RELANCE.length;

export function plusJours(jour: string, n: number): string {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Relit un suivi enregistré, null s'il est absent ou abîmé. */
export function lireSuivi(v: unknown): SuiviRecrut | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  const jour = (x: unknown) => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  const premier = jour(s.premier);
  if (!premier) return null;
  const relances = typeof s.relances === "number" && Number.isFinite(s.relances) ? Math.max(0, Math.min(MAX_RELANCES, Math.floor(s.relances))) : 0;
  return {
    premier,
    canal: s.canal === "email" ? "email" : "dm",
    relances,
    prochaine: jour(s.prochaine),
    dernier: jour(s.dernier) ?? premier,
    fini: s.fini === true,
  };
}

/** Le suivi après un message envoyé ce jour-là (premier contact ou relance). */
export function noterMessage(avant: SuiviRecrut | null, canal: Canal, jour: string): SuiviRecrut {
  if (!avant || avant.fini) {
    return { premier: jour, canal, relances: 0, prochaine: plusJours(jour, ECARTS_RELANCE[0]), dernier: jour };
  }
  const relances = Math.min(MAX_RELANCES, avant.relances + 1);
  const fini = relances >= MAX_RELANCES;
  return { ...avant, canal, relances, dernier: jour, prochaine: fini ? null : plusJours(jour, ECARTS_RELANCE[relances]), fini };
}

export type EtatRecrut = "a_contacter" | "a_relancer" | "attente" | "a_repondu" | "fini" | "hors_suivi";

/**
 * Où en est une fiche. `status` = statut de l'app ; `reponseLe` = jour de la dernière réponse
 * du créateur (DM ou mail), ou null.
 */
export function etatRecrut(status: string, suivi: SuiviRecrut | null, reponseLe: string | null, aujourdhui: string): EtatRecrut {
  if (status === "discussion" || status === "signe" || status === "ecarte") return "hors_suivi";
  if (!suivi) return status === "contacter" ? "a_contacter" : "hors_suivi";
  if (reponseLe && reponseLe >= suivi.premier) return "a_repondu";
  if (suivi.fini) return "fini";
  if (suivi.prochaine && suivi.prochaine <= aujourdhui) return "a_relancer";
  return "attente";
}

export const LIBELLES: Record<EtatRecrut, string> = {
  a_contacter: "À contacter (jamais écrit)",
  a_relancer: "À relancer aujourd'hui",
  attente: "En attente de réponse",
  a_repondu: "A répondu : passer en « En discussion » et lui répondre",
  fini: "Deux relances sans réponse : écarter ou garder en observation",
  hors_suivi: "Hors suivi",
};

/** « 1er contact 20 nov. (DM) · 1 relance · prochaine 2 déc. » */
export function texteSuivi(s: SuiviRecrut | null): string {
  if (!s) return "jamais contacté";
  const j = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" });
  return [
    `1er contact ${j(s.premier)} (${s.canal === "dm" ? "DM" : "mail"})`,
    s.relances ? `${s.relances} relance${s.relances > 1 ? "s" : ""}` : "",
    s.prochaine ? `prochaine ${j(s.prochaine)}` : s.fini ? "relances finies" : "",
  ].filter(Boolean).join(" · ");
}
