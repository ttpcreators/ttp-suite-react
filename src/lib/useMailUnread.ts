import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { useLiveKey } from "./useLive";
import { BOX_LABEL, type MailBox } from "./mailSend";
import type { MailUnread } from "./aujourdhui";

type PeekRes = { ok?: boolean; boxes?: Partial<Record<MailBox, { historyId?: string; unread?: number }>>; error?: string };

const MIN_GAP = 60_000; // au plus un coup d'œil par minute
let last: { at: number; value: MailUnread } = { at: 0, value: null };

/** Un mail vient d'être lu / remis non lu dans l'app : le prochain affichage redemande. */
export function invalidateMailUnread(): void {
  last = { ...last, at: 0 };
}

/**
 * Mails non lus par boîte, via le « coup d'œil » de gmail-history (le même appel léger
 * que la page Mails fait chaque minute : `{ peek: true, box: "all" }`). null tant que
 * c'est inconnu (Google non relié, ancienne version de la fonction, coupure réseau).
 */
export function useMailUnread(): MailUnread {
  const [value, setValue] = useState<MailUnread>(last.value);
  const live = useLiveKey();
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (Date.now() - last.at < MIN_GAP) {
      setValue(last.value);
      return;
    }
    last = { ...last, at: Date.now() };
    supabase.functions
      .invoke("gmail-history", { body: { peek: true, box: "all" } })
      .then(({ data, error }) => {
        const res = (data ?? {}) as PeekRes;
        if (error || !res.ok || !res.boxes) return;
        const next: MailUnread = (Object.keys(BOX_LABEL) as MailBox[])
          .filter((b) => res.boxes?.[b])
          .map((b) => ({ box: b, label: BOX_LABEL[b], count: Math.max(0, Number(res.boxes?.[b]?.unread) || 0) }));
        last = { at: Date.now(), value: next };
        if (alive.current) setValue(next);
      })
      .catch(() => {});
    return () => {
      alive.current = false;
    };
  }, [live]);

  return value;
}
