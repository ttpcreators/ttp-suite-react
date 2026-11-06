// ============================================================================
// _shared/planningDoublon.ts : avant d'ajouter un rendez-vous au Planning (et donc au
// Google Agenda de partnerships@), repérer celui qui existe déjà (doublon) ou celui qui
// tombe en même temps (chevauchement). Logique pure, testée (planningDoublon.test.ts).
// Utilisé par les outils creer_evenement et creer_meet du connecteur (ttp-mcp).
// ============================================================================

export type PlanEvent = { id: string; date: string; time?: string | null; title?: string | null; who?: string | null; description?: string | null };
export type Candidat = { date: string; time?: string | null; title: string; who?: string | null; emails?: string[] };

// Mots qui ne disent rien du sujet d'un rendez-vous.
const VIDES = new Set([
  "call", "appel", "rendez", "vous", "rdv", "meet", "google", "visio", "reunion", "point", "avec", "pour", "dans", "chez",
  "entre", "suite", "sujet", "premier", "premiere", "rapide", "telephone", "teams", "zoom", "collab", "collaboration",
  "marc", "gianni", "agence", "creators", "talent", "partnerships",
]);

const sansAccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Mots qui portent le sujet (marque, personne, projet). */
export function motsCles(s: string | null | undefined): Set<string> {
  return new Set(sansAccent(String(s ?? "")).split(/[^a-z0-9]+/).filter((m) => m.length >= 3 && !VIDES.has(m)));
}

const minutes = (t: string | null | undefined) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Doublon : même jour, heure proche (une heure d'écart au plus, ou l'un des deux sans
 * heure) ET quelque chose en commun (un mot du sujet, le créateur, ou l'adresse d'un invité
 * dans l'évènement). Chevauchement : même jour, moins d'une heure d'écart, rien en commun.
 */
export function doublonPlanning(existants: PlanEvent[], c: Candidat): { doublon: PlanEvent | null; chevauche: PlanEvent | null } {
  const motsC = motsCles(c.title);
  const tc = minutes(c.time);
  const mails = (c.emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);
  let chevauche: PlanEvent | null = null;
  for (const e of existants) {
    if (e.date !== c.date) continue;
    const te = minutes(e.time);
    const proche = tc == null || te == null ? true : Math.abs(tc - te) <= 60;
    if (!proche) continue;
    const motsE = motsCles(`${e.title ?? ""} ${e.who ?? ""}`);
    const commun = [...motsC].some((m) => motsE.has(m))
      || (!!c.who && !!e.who && sansAccent(c.who) === sansAccent(e.who))
      || mails.some((m) => `${e.title ?? ""} ${e.description ?? ""}`.toLowerCase().includes(m));
    if (commun) return { doublon: e, chevauche: null };
    if (tc != null && te != null && !chevauche) chevauche = e;
  }
  return { doublon: null, chevauche };
}
