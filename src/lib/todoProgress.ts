/*
 * To-do · points d'avancement (règles pures, testées).
 * Le commentaire d'une tâche (blob `itemNotes`) est un texte : un point par ligne.
 * Un point ajouté depuis la fiche commence par sa date (« 21/10/2026 · Brief envoyé ») ;
 * les anciens points, sans date, restent lisibles tels quels.
 */

export type ProgressPoint = { date: string | null; text: string };

const STAMP = /^(\d{2}\/\d{2}\/\d{4}) · (.+)$/;

/** « 21/10/2026 » (date locale). */
export function frDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Nouveau point daté : « 21/10/2026 · texte ». */
export function stampPoint(text: string, now: Date = new Date()): string {
  return `${frDate(now)} · ${text.trim()}`;
}

/** Ajoute un point daté à la suite du commentaire existant. */
export function appendPoint(note: string | null | undefined, text: string, now: Date = new Date()): string {
  const cur = (note ?? "").trim();
  const line = stampPoint(text, now);
  return cur ? `${cur}\n${line}` : line;
}

/** Les points, du plus ancien au plus récent (lignes vides ignorées). */
export function parsePoints(note: string | null | undefined): ProgressPoint[] {
  return (note ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = STAMP.exec(l);
      return m ? { date: m[1], text: m[2] } : { date: null, text: l };
    });
}

/** Le dernier point (« où j'en suis »), ou null. */
export function latestPoint(note: string | null | undefined): ProgressPoint | null {
  const all = parsePoints(note);
  return all.length ? all[all.length - 1] : null;
}
