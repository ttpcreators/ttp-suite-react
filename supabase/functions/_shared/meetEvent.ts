// ============================================================================
// _shared/meetEvent.ts : rendez-vous Google Agenda (avec lien Meet) demandé depuis
// l'app. Logique pure (validation, heure de fin, corps de l'évènement), testée.
// ============================================================================

export type MeetRequest = {
  title: string;
  date: string; // AAAA-MM-JJ (heure de Paris)
  time: string; // HH:MM
  duration: number; // minutes
  guests: string[];
  meet: boolean;
  invite: boolean;
  note: string;
  who: string | null;
};

const EMAIL_RE = /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/;

/** Lit et vérifie la demande ; renvoie un code d'erreur lisible par l'app sinon. */
export function parseMeetRequest(b: Record<string, unknown>): MeetRequest | { error: string } {
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s*[—–]\s*/g, ", ").trim().slice(0, max) : "");
  const title = s(b.title, 200);
  if (!title) return { error: "titre_requis" };
  const date = s(b.date, 10);
  const time = s(b.time, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return { error: "date_invalide" };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: "heure_invalide" };
  const duration = Math.round(Number(b.duration));
  if (!Number.isFinite(duration) || duration < 5 || duration > 480) return { error: "duree_invalide" };
  const raw = Array.isArray(b.guests) ? b.guests : [];
  const guests = [...new Set(raw.map((g) => String(g ?? "").trim().toLowerCase()).filter(Boolean))];
  const bad = guests.find((g) => !EMAIL_RE.test(g));
  if (bad) return { error: "invite_invalide" };
  if (guests.length > 30) return { error: "trop_d_invites" };
  const invite = b.invite !== false && guests.length > 0;
  return { title, date, time, duration, guests, meet: b.meet !== false, invite, note: s(b.note, 3000), who: s(b.who, 80) || null };
}

/** Heure de fin « AAAA-MM-JJTHH:MM:00 » (heure locale, sans fuseau : Google applique timeZone). */
export function localEnd(date: string, time: string, minutes: number): string {
  const d = new Date(`${date}T${time}:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString().slice(0, 19);
}

/** Corps de l'évènement Google Agenda (insert). */
export function meetEventBody(r: MeetRequest, tz: string, requestId: string): Record<string, unknown> {
  return {
    summary: r.title,
    ...(r.note ? { description: r.note } : {}),
    start: { dateTime: `${r.date}T${r.time}:00`, timeZone: tz },
    end: { dateTime: localEnd(r.date, r.time, r.duration), timeZone: tz },
    attendees: r.guests.map((email) => ({ email })),
    guestsCanSeeOtherGuests: true,
    extendedProperties: { private: { ttp_type: "call", ...(r.who ? { ttp_who: r.who } : {}) } },
    ...(r.meet ? { conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
  };
}

/** Lien Meet d'un évènement Google (hangoutLink, sinon point d'entrée vidéo). */
export function meetLinkOf(ev: { hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] } }): string {
  if (ev.hangoutLink) return ev.hangoutLink;
  return ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ?? "";
}
