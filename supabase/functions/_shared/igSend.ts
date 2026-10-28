// ============================================================================
// _shared/igSend.ts : envoi d'un DM Instagram depuis l'app (fonction ig-send).
// Règles pures, testées par igSend.test.ts.
// ============================================================================

/** Longueur maximale d'un DM Instagram (limite Meta : 1 000 caractères). */
export const DM_MAX = 1000;

/** Fenêtre de réponse de Meta : 24 h après le dernier message de l'interlocuteur. */
export const REPLY_WINDOW_MS = 24 * 3600e3;

/** Peut-on encore répondre depuis l'app ? (dernier message reçu, ISO ; null = jamais reçu). */
export function canReply(lastIncomingAt: string | null | undefined, now = Date.now()): boolean {
  if (!lastIncomingAt) return false;
  const t = Date.parse(lastIncomingAt);
  return Number.isFinite(t) && now - t < REPLY_WINDOW_MS;
}

type GraphError = { code?: number; error_subcode?: number; message?: string };
/** Erreur Meta à l'envoi → raison lisible pour l'app. */
export function sendWhy(e: GraphError): string {
  // Hors de la fenêtre de 24 h (ou personne qui n'a jamais écrit).
  if (e.code === 10 && (e.error_subcode === 2534022 || e.error_subcode === 2018278)) return "hors_fenetre";
  if (/outside of allowed window|24 hour/i.test(e.message ?? "")) return "hors_fenetre";
  // Compte qui n'accepte pas le message (bloqué, désactivé, réglages de confidentialité).
  if (e.code === 551 || e.error_subcode === 1545041) return "indisponible";
  if (e.code === 190) return "meta_jeton";
  if (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613) return "meta_limite";
  if (e.code === 10 || e.code === 200 || e.code === 3) return "meta_autorisation";
  return e.message === "reseau" ? "reseau" : `meta_${e.code ?? "erreur"}`;
}

/** Texte envoyé : nettoyé, non vide, sous la limite. null si refusé. */
export function cleanDm(text: unknown): string | null {
  const t = String(text ?? "").replace(/\r\n/g, "\n").trim();
  return t && t.length <= DM_MAX ? t : null;
}
