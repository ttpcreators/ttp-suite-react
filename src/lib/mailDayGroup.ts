/**
 * Groupe d'un fil dans la liste : « Aujourd'hui », « Hier », « Cette semaine » (en français,
 * à traduire par l'appelant), puis le mois dans la langue `locale`.
 */
export function dayGroup(ts: number, now = new Date(), locale = "fr-FR"): string {
  const d = new Date(ts);
  const day0 = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day0(now) - day0(d)) / 86400000);
  if (diff <= 0) return "Aujourd'hui";
  if (diff === 1) return "Hier";
  if (diff < 7) return "Cette semaine";
  const m = d.toLocaleDateString(locale, { month: "long", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
  return m.charAt(0).toUpperCase() + m.slice(1);
}
