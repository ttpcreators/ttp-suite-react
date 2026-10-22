/*
 * To-do · points d'avancement (règles pures, testées).
 * Le commentaire d'une tâche (colonne `todos.progress`, avant : blob `itemNotes`) est un
 * texte : un point par ligne. Un point ajouté depuis une fiche commence par sa date et dit
 * qui l'a écrit (« 21/10/2026 · Agence : Brief envoyé ») ; les anciens points, sans date
 * ni auteur, restent lisibles tels quels.
 */

/** Qui a écrit le point : l'agence ou le créateur (null = ancien point). */
export type PointAuthor = "Agence" | "Créateur";
export type ProgressPoint = { date: string | null; text: string; who?: PointAuthor | null };

const STAMP = /^(\d{2}\/\d{2}\/\d{4}) · (.+)$/;
const AUTHOR = /^(Agence|Créateur) : (.+)$/;

/** « 21/10/2026 » (date locale). */
export function frDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Nouveau point daté : « 21/10/2026 · texte », ou « 21/10/2026 · Agence : texte ». */
export function stampPoint(text: string, now: Date = new Date(), who?: PointAuthor): string {
  return `${frDate(now)} · ${who ? `${who} : ` : ""}${text.trim()}`;
}

/** Ajoute un point daté (et signé si `who`) à la suite du commentaire existant. */
export function appendPoint(note: string | null | undefined, text: string, now: Date = new Date(), who?: PointAuthor): string {
  const cur = (note ?? "").trim();
  const line = stampPoint(text, now, who);
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
      if (!m) return { date: null, text: l };
      const a = AUTHOR.exec(m[2]);
      return a ? { date: m[1], text: a[2], who: a[1] as PointAuthor } : { date: m[1], text: m[2] };
    });
}

/** Le dernier point (« où j'en suis »), ou null. */
export function latestPoint(note: string | null | undefined): ProgressPoint | null {
  const all = parsePoints(note);
  return all.length ? all[all.length - 1] : null;
}

/**
 * Le créateur a-t-il un message de l'agence à lire ? Vrai quand le dernier point signé
 * vient de l'agence (une question ou une consigne, pas encore suivie d'un point du créateur).
 */
export function agencyAwaits(note: string | null | undefined): boolean {
  const signed = parsePoints(note).filter((p) => p.who);
  return signed.length > 0 && signed[signed.length - 1].who === "Agence";
}

/** Erreur Supabase « colonne `progress` absente » (SQL 2026-10-22 pas encore lancé). */
export function progressColumnMissing(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false;
  return /progress/i.test(e.message ?? "") && (e.code === "42703" || e.code === "PGRST204" || /column|schema cache|does not exist/i.test(e.message ?? ""));
}
