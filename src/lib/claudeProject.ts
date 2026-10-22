/**
 * Bouton « Demander à Claude » de la fiche contact (demande de Marc, 2026-10-22).
 * Ouvre une NOUVELLE conversation, la barre de texte déjà remplie avec la fiche du contact
 * (`claude.ai/new?q=…`). Une conversation existante n'accepte pas de texte pré-rempli
 * (vérifié 2026-10-22), d'où la nouvelle conversation.
 *  - Compte de Marc : la conversation s'ouvre DANS son projet « Assistant mail/message -
 *    TTP Creators » (`&project=<id>`, vérifié : projet sélectionné + texte présent).
 *  - Autres comptes (Gianni…) : le projet de Marc ne leur est pas accessible ; nouvelle
 *    conversation sur LEUR Claude, avec la même fiche.
 * Lien `claude://claude.ai/…` (schéma déclaré par l'app Claude du Mac), site en secours.
 */
const PERSONAL_PROJECTS: Record<string, string> = {
  "marcbouraoui@gmail.com": "019f77a8-6eef-7680-9b95-532e9cc66f6e",
  "marc@ttpcreators.pro": "019f77a8-6eef-7680-9b95-532e9cc66f6e",
};

/** Projet Claude personnel de ce compte, sinon null. */
export function personalProject(email: string | null | undefined): string | null {
  return PERSONAL_PROJECTS[(email ?? "").trim().toLowerCase()] ?? null;
}

function target(scheme: "claude" | "https", text: string, project: string | null): string {
  const params: string[] = [];
  const q = encodeURIComponent(text);
  if (q.length <= 6000) params.push(`q=${q}`);
  if (project) params.push(`project=${encodeURIComponent(project)}`);
  return `${scheme}://claude.ai/new${params.length ? `?${params.join("&")}` : ""}`;
}

/** Ouvre Claude dans l'app (site en secours au bout d'1,5 s si l'app ne répond pas). */
export function openClaude(project: string | null, text: string): void {
  let left = false;
  const away = () => {
    left = true;
  };
  window.addEventListener("blur", away, { once: true });
  document.addEventListener("visibilitychange", away, { once: true });
  window.location.href = target("claude", text, project);
  window.setTimeout(() => {
    window.removeEventListener("blur", away);
    document.removeEventListener("visibilitychange", away);
    if (!left && document.visibilityState === "visible") window.open(target("https", text, project), "_blank", "noopener");
  }, 1500);
}

type Line = string | null | undefined | false;
const clean = (v?: string | null) => (v && v.trim() && v.trim() !== "—" ? v.trim() : "");
/** Extraits Gmail : « l&#39;ensemble » → « l'ensemble ». */
const unescape = (v: string) =>
  v.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
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
    for (const m of mails) lines.push(`- ${day(String(m.date))} · ${m.direction === "in" ? "reçu" : "envoyé"} · ${unescape(m.subject || "(sans objet)")}${m.snippet ? ` : ${unescape(m.snippet).slice(0, 160)}` : ""}`);
  }
  lines.push("", "Ma demande : ");
  return lines.filter((l): l is string => typeof l === "string").join("\n");
}
