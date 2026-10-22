/**
 * Bouton « Demander à Claude » de la fiche contact (demande de Marc, 2026-10-22).
 *  - Compte de Marc : ouvre SA conversation Claude (ci-dessous), dans l'app Claude du Mac.
 *    Une conversation existante n'accepte pas de texte pré-rempli : la fiche du contact est
 *    copiée et se colle avec Cmd+V.
 *  - Autres comptes (Gianni…) : la conversation de Marc ne leur est pas accessible ; on ouvre
 *    une NOUVELLE conversation sur LEUR Claude, zone de message déjà remplie avec la fiche.
 * Lien `claude://claude.ai/…` (schéma déclaré par l'app Claude), site claude.ai en secours.
 */
const PERSONAL_CHATS: Record<string, string> = {
  "marcbouraoui@gmail.com": "claude.ai/chat/fc5ff6e6-5ee9-4a82-9c6b-0ada019bac5f",
  "marc@ttpcreators.pro": "claude.ai/chat/fc5ff6e6-5ee9-4a82-9c6b-0ada019bac5f",
};

/** Conversation Claude personnelle de ce compte, sinon null. */
export function personalChat(email: string | null | undefined): string | null {
  return PERSONAL_CHATS[(email ?? "").trim().toLowerCase()] ?? null;
}

function target(path: string, scheme: "claude" | "https", text?: string): string {
  const base = `${scheme}://${path}`;
  if (!text) return base;
  const q = encodeURIComponent(text);
  return q.length <= 6000 ? `${base}?q=${q}` : base;
}

/**
 * Ouvre Claude dans l'app (site en secours au bout d'1,5 s si l'app ne répond pas).
 * `chat` = conversation personnelle (texte collé à la main) ; sinon nouvelle conversation
 * pré-remplie avec `text`.
 */
export function openClaude(chat: string | null, text: string): void {
  const path = chat ?? "claude.ai/new";
  const q = chat ? undefined : text;
  let left = false;
  const away = () => {
    left = true;
  };
  window.addEventListener("blur", away, { once: true });
  document.addEventListener("visibilitychange", away, { once: true });
  window.location.href = target(path, "claude", q);
  window.setTimeout(() => {
    window.removeEventListener("blur", away);
    document.removeEventListener("visibilitychange", away);
    if (!left && document.visibilityState === "visible") window.open(target(path, "https", q), "_blank", "noopener");
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
