/**
 * Résumé d'un brief pour le créateur (colonne `briefs.resume`, jsonb) : ce qu'il doit
 * savoir en 30 secondes, en 4 listes. Écrit par Claude (bouton « Résumer avec Claude »
 * → outils lire_brief puis resumer_brief du connecteur) ou à la main par l'agence.
 */
export type BriefResume = {
  faire: string[];
  eviter: string[];
  livrables: string[];
  mentions: string[];
  /** Date ISO de la dernière écriture (sert à voir arriver le résumé de Claude). */
  maj_le?: string;
  par?: "claude" | "agence";
};
export type ResumeKey = "faire" | "eviter" | "livrables" | "mentions";

export const RESUME_BLOCKS: { key: ResumeKey; label: string }[] = [
  { key: "faire", label: "À faire" },
  { key: "eviter", label: "À ne pas faire" },
  { key: "livrables", label: "Livrables et dates" },
  { key: "mentions", label: "Mentions obligatoires" },
];

const MAX_ITEMS = 10;
const MAX_LEN = 280;

/** Une liste propre : textes non vides, puces retirées, pas de tiret long, bornée. */
export function cleanList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) =>
      String(x ?? "")
        .replace(/^\s*(?:[-•*·]|\d+[.)])\s*/, "")
        .replace(/\s*[—–]\s*/g, ", ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_LEN),
    )
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
}

/** Lecture tolérante de la colonne (null, ancien format, champ manquant). */
export function parseResume(raw: unknown): BriefResume | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const r: BriefResume = {
    faire: cleanList(o.faire),
    eviter: cleanList(o.eviter),
    livrables: cleanList(o.livrables),
    mentions: cleanList(o.mentions),
    maj_le: typeof o.maj_le === "string" ? o.maj_le : undefined,
    par: o.par === "claude" ? "claude" : o.par === "agence" ? "agence" : undefined,
  };
  return hasResume(r) ? r : null;
}

export function hasResume(r: BriefResume | null | undefined): r is BriefResume {
  return !!r && RESUME_BLOCKS.some((b) => r[b.key].length > 0);
}

/** Édition à la main : une ligne = un point. */
export const listToText = (xs: string[] | undefined) => (xs ?? []).join("\n");
export const textToList = (s: string) => cleanList(s.split("\n"));

/** Demande envoyée à Claude (connecteur TTP Suite) pour résumer un brief. */
export function briefResumePrompt(b: { id: string; brand: string; creator?: string | null }): string {
  const who = b.creator ? ` pour ${b.creator}` : "";
  return [
    `Résume le brief ${b.brand}${who} pour que le créateur sache tout de suite quoi faire.`,
    `1. Lis le brief avec l'outil lire_brief (brief ${b.id}) : infos, texte du PDF de la marque, script.`,
    "2. Fais 4 listes courtes, en phrases simples et en tutoyant le créateur, dans sa langue (indiquée par lire_brief) :",
    "   • À faire : ce que la marque attend (message, ton, plans, produit à montrer) ;",
    "   • À ne pas faire : interdits, concurrents, sujets ou erreurs à éviter ;",
    "   • Livrables et dates : formats, nombre, durée, date du brouillon, date de publication ;",
    "   • Mentions obligatoires : #, @, code promo, lien, mention de partenariat.",
    "   6 points au plus par liste. N'invente rien : une info absente du brief n'apparaît pas.",
    `3. Dépose le résumé dans l'app avec resumer_brief (brief ${b.id}).`,
    "Puis dis-moi en une phrase le point le plus important.",
  ].join("\n");
}
