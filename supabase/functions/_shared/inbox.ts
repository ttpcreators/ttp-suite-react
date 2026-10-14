// ============================================================================
// _shared/inbox.ts : ce qu'on tire des messages privés (DM) Instagram de TTP.
// Logique pure (sans réseau), utilisée par ig-inbox.
// ============================================================================

export type DmMsg = { id: string; at: string; me: boolean; text: string };
export type Touch = { id: string; date: string; canal: string; kind: string; note?: string };

const excerpt = (t: string, n: number) => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/**
 * Journal de prospection (contacts.touches) : une touche par jour et par sens.
 * TTP écrit → « Premier contact » (rien avant) ou « Relance » ; la marque écrit →
 * « Réponse reçue ». Id stable « ig:<conversation>:<jour>:m|t » : un rejeu du cron
 * n'ajoute jamais deux fois la même touche. Renvoie seulement les touches à ajouter.
 */
export function dmTouches(threadId: string, msgs: DmMsg[], existing: Touch[], lastContacted: string | null): Touch[] {
  const known = new Set(existing.map((t) => t.id));
  const groups = new Map<string, DmMsg[]>();
  for (const m of [...msgs].sort((a, b) => a.at.localeCompare(b.at))) {
    if (!m.at) continue;
    const key = `${m.at.slice(0, 10)}:${m.me ? "m" : "t"}`;
    const g = groups.get(key) ?? [];
    g.push(m);
    groups.set(key, g);
  }
  const dates = existing.map((t) => t.date).filter(Boolean);
  if (lastContacted) dates.push(lastContacted);
  const added: Touch[] = [];
  for (const [key, g] of [...groups.entries()].sort((a, b) => a[1][0].at.localeCompare(b[1][0].at))) {
    const first = g[0];
    const id = `ig:${threadId}:${key}`;
    const before = dates.some((d) => d < first.at) || added.length > 0;
    if (!known.has(id)) {
      const text = g.find((m) => m.text.trim())?.text ?? "";
      added.push({
        id,
        date: first.at,
        canal: "instagram",
        kind: first.me ? (before ? "relance" : "contact") : "reponse",
        note: text ? `DM Instagram : « ${excerpt(text, 90)} »` : "DM Instagram",
      });
    }
    dates.push(first.at);
  }
  return added;
}

/** Message sans texte (photo, vidéo, story partagée, réaction…). */
export const NO_TEXT = "(photo, vidéo ou story)";
