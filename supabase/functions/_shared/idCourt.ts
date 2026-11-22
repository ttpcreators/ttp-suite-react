// ============================================================================
// _shared/idCourt.ts : retrouver un élément par le début de son id (santé d'Alfred, 22/11/2026).
// Alfred raccourcit les ids à 8 caractères dans ses boutons Telegram (« fait tâche 515a22fd »,
// 64 octets au plus) : l'app ne trouvait rien et la tâche n'était jamais cochée. Un id court de
// 8 à 35 caractères hexadécimaux devient une plage d'uuid ; plusieurs résultats : on refuse.
// ============================================================================

/** La plage d'uuid qui commence par ce début d'id, ou null si ce n'en est pas un. */
export function plageUuid(debut: string): { de: string; a: string } | null {
  const h = String(debut ?? "").trim().toLowerCase().replace(/-/g, "");
  if (!/^[0-9a-f]{8,31}$/.test(h)) return null;
  const forme = (x: string) => `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
  return { de: forme(h.padEnd(32, "0")), a: forme(h.padEnd(32, "f")) };
}

/** Un id complet d'uuid ? */
export const estUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? "").trim());
