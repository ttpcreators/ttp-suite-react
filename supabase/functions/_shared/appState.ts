// ============================================================================
// _shared/appState.ts
// ----------------------------------------------------------------------------
// Lecture du blob agence côté serveur : ligne commune `module = '__app_state__'`
// + ligne ARGENT `module = '__finance_state__'` (lignes des factures, comptes
// bancaires, émetteur, versements, commissions), lisible des seuls fondateurs
// (SQL 2026-10-25-finance-fondateurs.sql). Les clés de la ligne finance recouvrent
// celles de la ligne commune. Avant le SQL, la ligne finance n'existe pas : même
// résultat qu'avant. Même règle que src/lib/appState.ts côté app.
// ============================================================================

type Row = { a?: unknown } | undefined;
type Res = { data: unknown[] | null; error: { message: string } | null };
// deno-lint-ignore no-explicit-any
type Sb = { from: (table: string) => any };

/** Contenu JSON d'une ligne du blob ({} si vide ou illisible). */
export function parseBlobRow(row: Row): Record<string, unknown> {
  const raw = row?.a;
  try {
    const o = typeof raw === "string" ? (raw ? JSON.parse(raw) : {}) : (raw ?? {});
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Ligne commune + ligne finance (la seconde l'emporte). */
export function mergeBlobRows(app: Row, finance: Row): Record<string, unknown> {
  return { ...parseBlobRow(app), ...parseBlobRow(finance) };
}

const readRow = (sb: Sb, module: string): Promise<Res> =>
  sb.from("module_rows").select("a").eq("module", module).order("created_at", { ascending: false }).limit(1);

/**
 * Blob agence complet. FAIL-CLOSED : une lecture ratée lève une erreur (renvoyer {}
 * ferait réécrire une clé entière à partir de rien).
 */
export async function readAppState(sb: Sb): Promise<Record<string, unknown>> {
  const [app, fin] = await Promise.all([readRow(sb, "__app_state__"), readRow(sb, "__finance_state__")]);
  if (app.error) throw new Error(`lecture du blob impossible (${app.error.message})`);
  if (fin.error) throw new Error(`lecture du blob impossible (${fin.error.message})`);
  return mergeBlobRows(app.data?.[0] as Row, fin.data?.[0] as Row);
}
