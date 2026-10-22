/**
 * Projet Claude « Assistant mail/message - TTP Creators » (claude.ai, compte de Marc).
 * Le bouton Claude de la fiche contact ouvre ce projet et copie le contexte du contact,
 * à coller (Cmd+V) dans la conversation.
 */
export const CLAUDE_MAIL_PROJECT_URL = "https://claude.ai/project/019f77a8-6eef-7680-9b95-532e9cc66f6e";

type Line = string | null | undefined | false;
const clean = (v?: string | null) => (v && v.trim() && v.trim() !== "—" ? v.trim() : "");
/** Date lisible (« 8 oct. 2026 ») depuis un ISO ou un en-tête Date de Gmail. */
function day(v: string): string {
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? v.slice(0, 16) : t.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

/** Texte de contexte d'un contact, prêt à coller dans Claude. */
export function contactBrief(c: {
  brand?: string | null;
  person?: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  instagram?: string | null;
  tag?: string | null;
  touches?: { date: string; canal: string; kind: string; note?: string }[];
  mails?: { direction: string; date: string; subject?: string; snippet?: string }[];
}): string {
  const who = [clean(c.person), clean(c.role)].filter(Boolean).join(", ");
  const lines: Line[] = [
    `Contact TTP Creators : ${clean(c.brand) || "(marque inconnue)"}${who ? ` · ${who}` : ""}`,
    clean(c.email) && `Email : ${clean(c.email)}`,
    clean(c.phone) && `Téléphone : ${clean(c.phone)}`,
    clean(c.instagram) && `Instagram : ${clean(c.instagram)}`,
    clean(c.tag) && `Catégorie : ${clean(c.tag)}`,
  ];
  const touches = (c.touches ?? []).slice(0, 6);
  if (touches.length) {
    lines.push("", "Échanges notés :");
    for (const t of touches) lines.push(`- ${day(t.date)} · ${t.canal} · ${t.kind}${t.note ? ` : ${t.note}` : ""}`);
  }
  const mails = (c.mails ?? []).slice(0, 6);
  if (mails.length) {
    lines.push("", "Derniers mails :");
    for (const m of mails) lines.push(`- ${day(String(m.date))} · ${m.direction === "in" ? "reçu" : "envoyé"} · ${m.subject || "(sans objet)"}${m.snippet ? ` : ${m.snippet.slice(0, 160)}` : ""}`);
  }
  lines.push("", "Ma demande : ");
  return lines.filter((l): l is string => typeof l === "string").join("\n");
}
