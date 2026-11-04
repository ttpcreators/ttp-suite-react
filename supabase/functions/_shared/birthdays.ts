// Anniversaires des créateurs : la veille et le jour J. Partagé par la cloche de
// l'app (useNotifications) et le connecteur Claude (ttp-mcp, outil notifications).
// Le téléphone reçoit les mêmes rappels par le résumé du matin (daily-digest).

export type BirthdayCreator = { name: string; birth: string | null; status?: string | null };
export type Birthday = { name: string; when: "today" | "tomorrow"; date: string; age: number | null };

/** « 1999-11-05 », « 05/11/1999 » → « 1999-11-05 » ; illisible ou vide → "". */
function isoOf(s: unknown): string {
  const t = String(s ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  return fr ? `${fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}` : "";
}

function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.toISOString().slice(0, 10);
}

/** Créateurs actifs dont c'est l'anniversaire aujourd'hui ou demain (`today` = « AAAA-MM-JJ »).
 *  Un 29 février est fêté le 28 février les années non bissextiles. */
export function upcomingBirthdays(creators: BirthdayCreator[], today: string): Birthday[] {
  const tomorrow = nextDay(today);
  const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const out: Birthday[] = [];
  for (const c of creators) {
    if (String(c.status ?? "actif").toLowerCase() === "inactif") continue;
    const b = isoOf(c.birth);
    if (!b) continue;
    for (const [when, day] of [["today", today], ["tomorrow", tomorrow]] as const) {
      const y = Number(day.slice(0, 4));
      let md = b.slice(5);
      if (md === "02-29" && !leap(y)) md = "02-28";
      if (md !== day.slice(5)) continue;
      const born = Number(b.slice(0, 4));
      out.push({ name: c.name, when, date: day, age: born > 1900 && born <= y ? y - born : null });
    }
  }
  return out;
}
