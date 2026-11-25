// ============================================================================
// sentBy.ts : « Envoyé par » dans la page Mails (qui de l'équipe a envoyé un mail).
// ----------------------------------------------------------------------------
// Demande de Gianni du 25/11 : Marc et Gianni envoient depuis les mêmes boîtes, au nom de
// Marc. Chaque envoi fait par l'app ou par Claude est noté dans email_activity avec son
// auteur (envoye_par, envoye_par_nom ; voir supabase/functions/_shared/auteurEnvoi.ts).
// Ici, logique PURE : retrouver l'auteur d'un message Gmail dans ce journal.
//   1. par l'id du message Gmail (envois depuis le 25/11) ;
//   2. sinon, même fil et envoi à moins de 3 minutes du message (envois plus anciens de la
//      file d'envoi, rattrapés par le SQL du 25/11).
// Un mail envoyé directement depuis Gmail n'est pas dans le journal : pas de mention.
// ============================================================================

export type SendLogRow = {
  thread_id: string | null;
  gmail_message_id: string | null;
  created_at: string | null;
  envoye_par: string | null;
  envoye_par_nom: string | null;
};

/** Écart accepté entre l'heure du message Gmail et la ligne du journal. */
export const TOLERANCE_MS = 3 * 60_000;

/** Prénom court à afficher : « Gianni.V » → « Gianni », « marc.test » → « Marc ». */
export function prenom(nom: string | null | undefined): string {
  const first = String(nom ?? "").trim().split(/[.\s_]+/)[0] ?? "";
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
}

/** Nom d'une ligne : le prénom réglé aujourd'hui dans l'app, sinon celui noté à l'envoi. */
export function nomLigne(r: SendLogRow, names?: Map<string, string>): string {
  const now = r.envoye_par ? names?.get(r.envoye_par) : undefined;
  return prenom(now || r.envoye_par_nom);
}

/** Auteur d'un message (id Gmail, fil, heure en ms), ou "" s'il n'est pas connu. */
export function auteurDuMessage(
  m: { id: string; threadId: string; ts: number },
  rows: SendLogRow[],
  names?: Map<string, string>,
): string {
  const signed = rows.filter((r) => r.envoye_par || r.envoye_par_nom);
  if (m.id) {
    const exact = signed.find((r) => r.gmail_message_id === m.id);
    if (exact) return nomLigne(exact, names);
    // Ce message est dans le journal, mais sans auteur (ancien envoi) : on ne devine pas.
    if (rows.some((r) => r.gmail_message_id === m.id)) return "";
  }
  if (!m.threadId || !Number.isFinite(m.ts) || m.ts <= 0) return "";
  let best: { r: SendLogRow; d: number } | null = null;
  for (const r of signed) {
    if (r.thread_id !== m.threadId || !r.created_at) continue;
    // Une ligne qui porte l'id d'un AUTRE message ne peut pas être celui-ci.
    if (m.id && r.gmail_message_id && r.gmail_message_id !== m.id) continue;
    const d = Math.abs(Date.parse(r.created_at) - m.ts);
    if (Number.isFinite(d) && d <= TOLERANCE_MS && (!best || d < best.d)) best = { r, d };
  }
  return best ? nomLigne(best.r, names) : "";
}

/** Toutes les personnes de l'équipe qui ont envoyé un mail dans ce fil (ordre alphabétique). */
export function auteursDuFil(threadId: string, rows: SendLogRow[], names?: Map<string, string>): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    if (r.thread_id !== threadId) continue;
    const n = nomLigne(r, names);
    if (n) out.add(n);
  }
  return [...out].sort((a, b) => a.localeCompare(b, "fr"));
}
