// ============================================================================
// _shared/watchdog.ts : décide si Alfred a travaillé ce matin (logique pure, testée).
// Utilisé par la fonction agent-watchdog (pg_cron, matins de semaine).
// ============================================================================

export type JournalRow = { action: string; cree_le: string };
export type Verdict = { etat: "weekend" | "trop_tot" | "ok" | "deja_alerte" | "alerte"; message: string };

/** Jour de la semaine (1 = lundi … 7 = dimanche), date « AAAA-MM-JJ » et minutes depuis minuit, à Paris. */
export function parisNow(d: Date): { jour: number; date: string; minutes: number } {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const jours: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { jour: jours[p.weekday] ?? 1, date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/**
 * Lundi au vendredi, à partir de 10 h 15 (heure de Paris) : Alfred doit avoir écrit au
 * journal depuis 8 h 45 ce jour-là (n'importe quelle entrée : son point du matin, ou au
 * moins sa session). Sinon : alerte, une seule fois par jour.
 */
export function veilleAlfred(now: Date, rows: JournalRow[]): Verdict {
  const p = parisNow(now);
  if (p.jour >= 6) return { etat: "weekend", message: "" };
  if (p.minutes < 10 * 60 + 15) return { etat: "trop_tot", message: "" };
  const aujourdhui = rows.filter((r) => parisNow(new Date(r.cree_le)).date === p.date);
  if (aujourdhui.some((r) => r.action === "veille_alfred")) return { etat: "deja_alerte", message: "" };
  const actif = aujourdhui.some((r) => r.action !== "veille_alfred" && parisNow(new Date(r.cree_le)).minutes >= 8 * 60 + 45);
  if (actif) return { etat: "ok", message: "" };
  return {
    etat: "alerte",
    message: "Pas de point de 9 h ce matin : l'iMac est peut-être éteint, en veille ou déconnecté de Claude. Sur l'iMac : Terminal, claude, puis /login.",
  };
}
