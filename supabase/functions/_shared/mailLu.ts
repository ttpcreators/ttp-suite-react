// ============================================================================
// _shared/mailLu.ts : un mail ouvert dans Gmail ou Spark est « lu » dans l'app.
// ----------------------------------------------------------------------------
// gmail-poll (toutes les 5 min) liste les mails NON LUS récents de chaque boîte, puis
// marque lus (email_activity.read_at) les mails de la cloche qui n'y sont plus : ils
// ont été ouverts ailleurs (Gmail, Spark, le téléphone), archivés lus ou supprimés.
// Prudence : une boîte dont la liste a échoué ou est incomplète ne marque rien.
// Règles PURES, testées par mailLu.test.ts.
// ============================================================================

export type BoxName = "partnerships" | "talent";

/** Ligne de la cloche encore non lue. `box` vide : ligne enregistrée avant la colonne. */
export type MailRow = { id: string; gmail_message_id: string | null; box?: string | null };

/** Non lus de chaque boîte ; null = liste échouée ou incomplète (on ne conclut rien). */
export type UnreadByBox = Partial<Record<BoxName, Set<string> | null>>;

/** Un mail est-il non lu au moment de son arrivée (libellé UNREAD de Gmail) ? */
export function isUnread(labelIds: readonly string[] | null | undefined): boolean {
  return (labelIds ?? []).includes("UNREAD");
}

/**
 * Ids des lignes à marquer lues. Boîte connue : lue si son id n'est plus dans les non
 * lus de CETTE boîte. Boîte inconnue (anciennes lignes) : lue seulement si toutes les
 * boîtes ont bien été lues et qu'aucune ne l'a en non lu.
 */
export function rowsNowRead(rows: readonly MailRow[], unread: UnreadByBox, boxes: readonly BoxName[]): string[] {
  const out: string[] = [];
  const allOk = boxes.length > 0 && boxes.every((b) => unread[b] instanceof Set);
  for (const r of rows) {
    const id = r.gmail_message_id;
    if (!id) continue;
    const box = r.box === "talent" || r.box === "partnerships" ? r.box : null;
    if (box) {
      const set = unread[box];
      if (set instanceof Set && !set.has(id)) out.push(r.id);
    } else if (allOk && boxes.every((b) => !(unread[b] as Set<string>).has(id))) {
      out.push(r.id);
    }
  }
  return out;
}
