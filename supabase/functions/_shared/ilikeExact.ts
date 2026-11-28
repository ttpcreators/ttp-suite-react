// ============================================================================
// _shared/ilikeExact.ts : retrouver UNE fiche par une valeur venue de l'extérieur (adresse d'un
// mail reçu, d'un formulaire public, d'un outil du connecteur) avec un filtre ilike.
// ----------------------------------------------------------------------------
// ilike compare sans tenir compte de la casse, mais « % » et « _ » y servent de jokers, et
// PostgREST lit aussi « * » comme « % », même précédé d'un « \ » (il devient alors un « % »
// littéral). Donc « \ », « % » et « _ » sont échappés, et une valeur qui contient « * » est
// refusée (null) : l'appelant ne cherche pas. Après la lecture, `lignesExactes` ne garde que les
// lignes dont la colonne vaut exactement la valeur (casse et espaces autour ignorés) : une
// écriture ou une suppression se fait ensuite par id, jamais par motif.
// Règles PURES, testées par ilikeExact.test.ts.
// ============================================================================

/** Motif ilike qui ne trouve QUE cette valeur (casse ignorée), ou null (vide, ou « * »). */
export function ilikeExact(v: string): string | null {
  const s = String(v ?? "").trim();
  if (!s || s.includes("*")) return null;
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Motif ilike « contient cette valeur » (%valeur%), ou null (vide, ou « * »). */
export function ilikeContient(v: string): string | null {
  const m = ilikeExact(v);
  return m === null ? null : `%${m}%`;
}

/** Les lignes dont la colonne `col` vaut exactement `valeur` (casse et espaces autour ignorés). */
export function lignesExactes<T extends Record<string, unknown>>(lignes: readonly T[] | null | undefined, col: string, valeur: string): T[] {
  const v = String(valeur ?? "").trim().toLowerCase();
  if (!v) return [];
  return (lignes ?? []).filter((l) => String(l?.[col] ?? "").trim().toLowerCase() === v);
}
