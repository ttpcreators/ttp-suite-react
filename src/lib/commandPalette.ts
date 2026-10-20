import { namesCreator } from "@/lib/aujourdhui";
import { normSearch } from "./pageAliases";
import { titleCase } from "./utils";

/*
 * Palette ⌘K : logique PURE (classement des entrées, libellés), testable sous Node.
 * Le composant (components/CommandPalette.tsx) ne fait qu'afficher et exécuter.
 */

/** Ouvre la palette depuis n'importe où (champ de recherche du menu, raccourcis…). */
export const PALETTE_EVENT = "ttp-palette";
export function openCommandPalette(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PALETTE_EVENT));
}

/**
 * Score d'une entrée pour la requête (0 = ne correspond pas). Ordre de préférence :
 * le libellé commence par la requête, puis un mot du libellé, puis le libellé la
 * contient, puis un mot-clé ; une requête de plusieurs mots doit retrouver chaque mot.
 */
export function scoreMatch(query: string, label: string, keywords: readonly string[] = []): number {
  const q = normSearch(query).trim();
  if (!q) return 1;
  const l = normSearch(label);
  if (l.startsWith(q)) return 100;
  if (l.split(/[\s×·'’\-/]+/).some((w) => w.startsWith(q))) return 80;
  if (l.includes(q)) return 60;
  const kws = keywords.map(normSearch);
  if (kws.some((k) => k.startsWith(q))) return 50;
  if (kws.some((k) => k.includes(q))) return 40;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const hay = [l, ...kws].join(" ");
    if (tokens.every((t) => hay.includes(t))) return 30;
  }
  return 0;
}

/** Garde les entrées qui correspondent, les meilleures d'abord (ordre d'origine à égalité). */
export function rankEntries<T extends { label: string; keywords?: readonly string[] }>(entries: readonly T[], query: string, limit = Infinity): T[] {
  return entries
    .map((e, i) => ({ e, i, s: scoreMatch(query, e.label, e.keywords) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.e);
}

/** « LÉNA PASQUALE » → « Léna » (libellés courts de la palette). */
export function firstName(name: string | null | undefined): string {
  return titleCase(name).trim().split(/\s+/)[0] ?? "";
}

/** « Relancer JNPR × Léna » */
export function relanceActionLabel(iv: { party: string | null; creator: string | null }): string {
  const who = firstName(iv.creator);
  const party = (iv.party ?? "").trim();
  if (party && who && namesCreator(party, iv.creator)) return `Relancer ${party}`;
  return `Relancer ${party && who ? `${party} × ${who}` : party || who || "la facture"}`;
}

/** Index suivant / précédent dans une liste à plat, en boucle. */
export function stepIndex(i: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((i + delta) % count) + count) % count;
}
