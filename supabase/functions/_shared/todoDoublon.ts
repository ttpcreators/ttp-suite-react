/**
 * Pas de tâche en double dans la to-do (demande de Marc, 2026-11-13 : Alfred en symbiose avec la
 * to-do). Avant d'ajouter une tâche, `creer_tache` cherche une tâche ouverte qui dit la même chose
 * pour le même créateur, y compris celles créées par les automatismes (gmail-poll, exclusivités).
 * Logique pure, testée.
 */

export type TacheOuverte = { id: string; text: string; creator?: string | null; creators?: string[] | null; due?: string | null };

const VIDES = new Set([
  "le", "la", "les", "l", "un", "une", "des", "de", "du", "d", "a", "à", "au", "aux", "et", "pour", "avec", "sur", "en", "par",
  "son", "sa", "ses", "ce", "cette", "qui", "que", "pas", "plus", "chez", "x",
]);

/** Les mots qui portent le sens d'un titre, sans accents ni majuscules. */
export function motsCles(titre: string): string[] {
  return String(titre ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9€]+/)
    .filter((m) => m.length > 1 && !VIDES.has(m));
}

const createursDe = (t: { creator?: string | null; creators?: string[] | null }) =>
  [...(t.creators ?? []), ...(t.creator ? [t.creator] : [])].map((c) => c.trim().toLowerCase()).filter(Boolean);

/**
 * La tâche ouverte qui fait doublon avec ce titre, ou null. Même créateur (ou aucun des deux), et
 * au moins 70 % des mots clés du plus court des deux titres en commun.
 */
export function tacheEnDouble(titre: string, createurs: string[], ouvertes: TacheOuverte[]): TacheOuverte | null {
  const a = new Set(motsCles(titre));
  if (!a.size) return null;
  const qui = createurs.map((c) => c.trim().toLowerCase()).filter(Boolean);
  let meilleure: { t: TacheOuverte; score: number } | null = null;
  for (const t of ouvertes) {
    const siens = createursDe(t);
    const memeQui = qui.length && siens.length ? qui.some((c) => siens.includes(c)) : !qui.length && !siens.length;
    if (!memeQui) continue;
    const b = new Set(motsCles(t.text));
    if (!b.size) continue;
    const communs = [...a].filter((m) => b.has(m)).length;
    const score = communs / Math.min(a.size, b.size);
    if (score >= 0.7 && (!meilleure || score > meilleure.score)) meilleure = { t, score };
  }
  return meilleure?.t ?? null;
}
