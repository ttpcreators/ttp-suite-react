/*
 * Fiche d'un échange (Mail créateur) : les réactions emoji ne s'affichent jamais comme des
 * mails. Règles PURES, testées par mailThreadReactions.test.ts.
 *   • un message est une réaction si le serveur l'indique (`reaction`, creator-mail) ou, en
 *     repli (ancienne version du serveur), si son texte est le court texte de repli Gmail
 *     (« Marc a réagi avec ❤️ », « Marc reacted with ❤️ ») ;
 *   • la réaction devient une pastille sous le dernier vrai message qui la précède.
 */

export type ThreadMsg = { id: string; from: string; fromAgency?: boolean; html?: string; text?: string; reaction?: string };
export type ThreadPill = { emoji: string; who: string; count: number };

const TEXT_RE = /^\s*(\S.{0,60}?)\s+(?:a réagi avec|reacted with)\s+(\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|️|‍\p{Extended_Pictographic})*)\s*\.?\s*$/u;
const strip = (h: string) => h.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** Emoji et auteur si le message est une réaction, sinon null. */
export function reactionOf(m: ThreadMsg): { emoji: string; who: string | null } | null {
  const body = (m.text?.trim() || strip(m.html ?? "")).slice(0, 200);
  const hit = TEXT_RE.exec(body);
  if (m.reaction) return { emoji: m.reaction, who: hit?.[1] ?? null };
  return hit ? { emoji: hit[2], who: hit[1] } : null;
}

/** Prénom affiché sous la pastille : celui du texte de repli, sinon le nom de l'expéditeur. */
function whoOf(m: ThreadMsg, fromText: string | null): string {
  const raw = fromText || m.from.replace(/<[^>]*>/g, "").replace(/"/g, "").trim();
  const first = raw.split(/\s+/)[0] ?? "";
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
}

/** Sépare les vrais messages des réactions, rangées en pastilles (groupées par emoji). */
export function splitThreadReactions<T extends ThreadMsg>(msgs: T[]): { shown: T[]; pills: Map<string, ThreadPill[]> } {
  const shown: T[] = [];
  const pills = new Map<string, ThreadPill[]>();
  for (const m of msgs) {
    const r = reactionOf(m);
    const target = shown[shown.length - 1];
    if (!r || !target) {
      shown.push(m);
      continue;
    }
    const list = pills.get(target.id) ?? [];
    const who = whoOf(m, r.who);
    const same = list.find((p) => p.emoji === r.emoji);
    if (same) {
      same.count += 1;
      if (who && !same.who.split(", ").includes(who)) same.who = same.who ? `${same.who}, ${who}` : who;
    } else list.push({ emoji: r.emoji, who, count: 1 });
    pills.set(target.id, list);
  }
  return { shown, pills };
}
