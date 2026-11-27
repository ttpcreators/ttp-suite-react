/*
 * Pastille Mail de l'espace créateur (logique PURE, testée par creatorMailBadge.test.ts).
 * Deux sources disent qu'un échange a du nouveau :
 *   • les échanges qui ont bougé depuis son dernier passage sur cet appareil
 *     (unseenMailIds, src/lib/creatorMail.ts, qui compte déjà les remarques et les statuts
 *     posés par l'agence) ;
 *   • les repères « nouveau » de la base (activity_events, object_type « mail », object_id =
 *     id de l'échange), écrits pour ces mêmes remarques et statuts.
 * Un échange ne compte qu'une fois, comme dans la liste des mails (CreatorMails.tsx).
 * Module à part : creatorMail.ts est chargé à la demande, l'espace ne l'importe pas.
 */

export function mailBadgeCount(unseenIds: readonly string[], events: readonly { object_type: string; object_id: string }[]): number {
  const ids = new Set(unseenIds);
  for (const e of events) if (e.object_type === "mail" && e.object_id) ids.add(e.object_id);
  return ids.size;
}
