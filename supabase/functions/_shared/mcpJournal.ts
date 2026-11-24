// ============================================================================
// _shared/mcpJournal.ts : la ligne écrite dans `mcp_log` à chaque appel d'un outil du
// connecteur Claude (ttp-mcp/tools.ts, callTool).
// ----------------------------------------------------------------------------
// Audit du 24 novembre 2026 (point M1) : le journal gardait la demande et « réussi ou non »,
// pas la raison de l'échec. Résultat : 15 brouillons de mail ratés sur 89 en 3 jours, retentés
// jusqu'à 5 fois de suite, sans qu'on puisse dire pourquoi. La raison est maintenant gardée
// dans la colonne `error` (SQL 2026-11-24-mcp-log-erreur).
// Règles PURES, testées par mcpJournal.test.ts.
// ============================================================================

/** Longueur gardée de la demande (arguments de l'outil). */
export const MAX_RESUME = 300;
/** Longueur gardée de la raison d'un échec. */
export const MAX_ERREUR = 400;

export type LigneJournal = {
  user_id: string;
  grant_id: string;
  tool: string;
  summary: string;
  ok: boolean;
  error?: string;
};

/** Raison d'un appel raté, sur une ligne et bornée. null si l'appel a réussi ou n'a rien dit. */
export function erreurJournal(res: { text?: unknown; isError?: boolean }): string | null {
  if (!res.isError) return null;
  const texte = String(res.text ?? "").replace(/\s+/g, " ").trim();
  return texte ? texte.slice(0, MAX_ERREUR) : null;
}

/** La ligne du journal : la colonne `error` n'est posée que pour un appel raté. */
export function ligneJournal(p: { userId: string; grantId: string; tool: string; args: unknown; res: { text?: unknown; isError?: boolean } }): LigneJournal {
  let summary = "";
  try {
    summary = JSON.stringify(p.args ?? {}).slice(0, MAX_RESUME);
  } catch {
    summary = "";
  }
  const ligne: LigneJournal = { user_id: p.userId, grant_id: p.grantId, tool: p.tool, summary, ok: !p.res.isError };
  const erreur = erreurJournal(p.res);
  if (erreur) ligne.error = erreur;
  return ligne;
}

/** La même ligne sans la raison : repli tant que la colonne `error` n'existe pas en prod. */
export function sansErreur(l: LigneJournal): LigneJournal {
  return { user_id: l.user_id, grant_id: l.grant_id, tool: l.tool, summary: l.summary, ok: l.ok };
}

/** L'écriture a été refusée parce que la colonne `error` n'existe pas encore (SQL pas lancé). */
export function colonneErreurAbsente(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  if (e.code === "42703" || e.code === "PGRST204") return true;
  return /column/i.test(e.message ?? "") && /\berror\b/.test(e.message ?? "");
}
