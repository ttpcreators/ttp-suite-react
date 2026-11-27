import { foldName } from "../../supabase/functions/_shared/exclusivites.ts";

/**
 * Retrouver les lignes d'un créateur dans une table où son nom est écrit à la main
 * (« LÉNA MOREL », « Léna Morel », « Lena Morel »), sans tenir compte des
 * majuscules ni des accents (audit données 2026-11-22). Logique pure, testée.
 *
 * 1. `namePattern` : motif ILIKE large (chaque lettre qui peut porter un accent devient
 *    `_`, un seul caractère quelconque), pour que la base renvoie toutes les graphies ;
 * 2. `sameName` : filtre exact côté app (nom replié), qui écarte les faux positifs.
 */
export function namePattern(name: string | null | undefined): string {
  return String(name ?? "")
    .normalize("NFC")
    .trim()
    .replace(/[\\%_]/g, (m) => "\\" + m)
    .replace(/[aceinouyAECINOUY]|[^\x00-\x7f]/g, "_");
}

export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = foldName(a);
  return x !== "" && x === foldName(b);
}
