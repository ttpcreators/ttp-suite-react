/**
 * Bouton « Demander à Claude » de la fiche contact : ouvre la conversation Claude de Marc
 * avec le contexte du contact.
 */
/**
 * Conversation Claude choisie par Marc (2026-10-22) pour les demandes depuis une fiche contact.
 * Ouverte dans l'app Claude du Mac (`claude://claude.ai/…`, schéma déclaré par l'app), sinon
 * sur le site. Le contexte du contact est copié dans le presse-papiers et passé aussi en `?q=`
 * (pris en compte si Claude le permet pour une conversation existante ; sinon Cmd+V).
 */
const CLAUDE_CHAT_PATH = "claude.ai/chat/fc5ff6e6-5ee9-4a82-9c6b-0ada019bac5f";

function withText(base: string, text?: string): string {
  if (!text) return base;
  const q = encodeURIComponent(text);
  return q.length <= 6000 ? `${base}?q=${q}` : base;
}

/** Ouvre la conversation dans l'app Claude ; si l'app ne répond pas, le site au bout d'1,5 s. */
export function openClaudeProject(text?: string): void {
  let left = false;
  const away = () => {
    left = true;
  };
  window.addEventListener("blur", away, { once: true });
  document.addEventListener("visibilitychange", away, { once: true });
  window.location.href = withText(`claude://${CLAUDE_CHAT_PATH}`, text);
  window.setTimeout(() => {
    window.removeEventListener("blur", away);
    document.removeEventListener("visibilitychange", away);
    if (!left && document.visibilityState === "visible") window.open(withText(`https://${CLAUDE_CHAT_PATH}`, text), "_blank", "noopener");
  }, 1500);
}

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
