import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { MailBox } from "@/lib/mailSend";
import { sendAsFromJson, type SendAs } from "../../supabase/functions/_shared/sendAs.ts";

/*
 * Menu « De : » du composeur : adresses « Envoyer en tant que » réglées dans Gmail pour la
 * boîte (gmail-send, action « sendas »). Lu une fois par boîte et gardé 10 min. En cas
 * d'échec (ancienne version de gmail-send, Gmail injoignable), liste vide : le menu ne
 * propose alors que la boîte, et aucun alias n'est jamais envoyé sans avoir été lu.
 */

const OK_TTL = 10 * 60_000;
const FAIL_TTL = 60_000;
const cache = new Map<MailBox, { at: number; ok: boolean; list: SendAs[] }>();
const inflight = new Map<MailBox, Promise<SendAs[]>>();

export function loadSendAs(box: MailBox): Promise<SendAs[]> {
  const hit = cache.get(box);
  if (hit && Date.now() - hit.at < (hit.ok ? OK_TTL : FAIL_TTL)) return Promise.resolve(hit.list);
  const cur = inflight.get(box);
  if (cur) return cur;
  const p = (async () => {
    let list: SendAs[] = [];
    let ok = false;
    try {
      const { data, error } = await supabase.functions.invoke("gmail-send", { body: { action: "sendas", box }, timeout: 20_000 });
      const d = (data ?? {}) as { ok?: boolean; list?: unknown };
      if (!error && d.ok) {
        list = sendAsFromJson(d.list);
        ok = true;
      }
    } catch {
      /* liste vide : seule la boîte est proposée */
    }
    cache.set(box, { at: Date.now(), ok, list });
    inflight.delete(box);
    return list;
  })();
  inflight.set(box, p);
  return p;
}

/** Adresses de la boîte (principale en premier) ; `aliases` = celles des créatrices. */
export function useSendAs(box: MailBox): { list: SendAs[]; aliases: SendAs[]; loading: boolean } {
  const [state, setState] = useState<{ box: MailBox; list: SendAs[] } | null>(() => {
    const hit = cache.get(box);
    return hit ? { box, list: hit.list } : null;
  });
  useEffect(() => {
    let live = true;
    void loadSendAs(box).then((list) => {
      if (live) setState({ box, list });
    });
    return () => {
      live = false;
    };
  }, [box]);
  const list = state?.box === box ? state.list : [];
  return { list, aliases: list.filter((x) => !x.primary), loading: state?.box !== box };
}

/**
 * Expéditeur choisi pour `box` : "" = adresse principale. Remis à "" quand la boîte change
 * ou quand l'alias n'est plus réglé dans Gmail (liste lue). `sender` = l'alias choisi (null
 * sinon) ; `unverified` = alias demandé (brouillon) mais liste pas encore lue ou illisible :
 * ne pas envoyer, sinon le mail partirait sans la bonne signature.
 */
export function useSender(box: MailBox, initial = "") {
  const sa = useSendAs(box);
  const [choice, setChoice] = useState<{ box: MailBox; from: string }>({ box, from: initial });
  const asked = choice.box === box ? choice.from : "";
  const sender = (asked && sa.aliases.find((x) => x.email === asked)) || null;
  // Liste lue et alias absent : retour à la boîte. Liste illisible : on garde le choix.
  const from = asked && !sa.loading && sa.list.length && !sender ? "" : asked;
  return {
    ...sa,
    from,
    setFrom: (v: string) => setChoice({ box, from: v }),
    sender,
    unverified: !!from && !sender,
  };
}
