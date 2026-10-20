/*
 * To-do « ajout rapide » : lecture légère d'une phrase tapée dans la barre du bas
 * (règles pures, testées). Ex. « Relancer Nutripure demain @Léna !haute » :
 *   @Prénom ou @Prénom Nom  → créateur (s'il existe, sans tenir compte des accents)
 *   !haute / !moyenne / !basse → priorité
 *   aujourd'hui, demain, lundi … dimanche → échéance (prochaine occurrence)
 * Les mots reconnus sont retirés du titre ; un mot non reconnu reste tel quel.
 */

export type QuickAddPriority = "haute" | "moyenne" | "basse";
export type QuickAddResult = {
  title: string;
  /** Nom du créateur tel qu'enregistré (creators.name), ou null. */
  creator: string | null;
  priority: QuickAddPriority | null;
  /** Échéance "YYYY-MM-DD" (date locale), ou null. */
  due: string | null;
};

const PRIORITIES: readonly QuickAddPriority[] = ["haute", "moyenne", "basse"];
// Indices de Date.getDay() : 0 = dimanche.
const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/** Minuscules, sans accents, apostrophe droite : « Aujourd’hui » → « aujourd'hui ». */
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .trim();
/** Ponctuation collée en fin de mot (« demain, » → « demain »). */
const bare = (s: string) => s.replace(/[.,;:!?)]+$/, "");

/** Date LOCALE en "YYYY-MM-DD" (jamais d'UTC : pas de décalage le soir). */
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function plusDays(now: Date, n: number): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

/** Mot d'échéance → date, sinon null. Un jour de semaine = sa PROCHAINE occurrence (1 à 7 jours). */
function dueOf(word: string, now: Date): string | null {
  const w = norm(bare(word));
  if (w === "aujourd'hui" || w === "aujourdhui") return plusDays(now, 0);
  if (w === "demain") return plusDays(now, 1);
  const wd = WEEKDAYS.indexOf(w);
  if (wd < 0) return null;
  const ahead = (wd - now.getDay() + 7) % 7 || 7;
  return plusDays(now, ahead);
}

/**
 * Créateur désigné par « @… » à partir du mot `i` : nom complet (jusqu'à 3 mots),
 * puis prénom seul. Renvoie le nom et le nombre de mots consommés, ou null si
 * personne (ou plusieurs créateurs avec ce prénom : on ne devine pas).
 */
function creatorAt(words: string[], i: number, creators: readonly { name: string }[]): { name: string; used: number } | null {
  const first = words[i].slice(1);
  if (!bare(first)) return null;
  const names = creators.map((c) => ({ name: c.name, n: norm(c.name).replace(/\s+/g, " ") }));
  for (let used = Math.min(3, words.length - i); used >= 1; used--) {
    const cand = norm(bare([first, ...words.slice(i + 1, i + used)].join(" ")));
    const hits = names.filter((c) => c.n === cand);
    if (hits.length === 1) return { name: hits[0].name, used };
  }
  const cand = norm(bare(first));
  const hits = names.filter((c) => c.n.split(" ")[0] === cand);
  return hits.length === 1 ? { name: hits[0].name, used: 1 } : null;
}

export function parseQuickAdd(input: string, creators: readonly { name: string }[], now: Date = new Date()): QuickAddResult {
  const words = input.split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  let creator: string | null = null;
  let priority: QuickAddPriority | null = null;
  let due: string | null = null;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.startsWith("!") && !priority) {
      const p = norm(bare(w.slice(1))) as QuickAddPriority;
      if (PRIORITIES.includes(p)) {
        priority = p;
        continue;
      }
    }
    if (w.startsWith("@") && !creator) {
      const hit = creatorAt(words, i, creators);
      if (hit) {
        creator = hit.name;
        i += hit.used - 1;
        continue;
      }
    }
    if (!due) {
      const d = dueOf(w, now);
      if (d) {
        due = d;
        continue;
      }
    }
    kept.push(w);
  }
  return { title: kept.join(" "), creator, priority, due };
}
