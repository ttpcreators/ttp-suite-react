import { supabase } from "./supabase";

/**
 * Lu dans l'app → lu dans Gmail (et donc dans Spark, qui lit Gmail). Sert à la cloche :
 * lire, ou remettre en non lu, une notification de mail fait pareil sur le fil Gmail
 * (fonction gmail-thread, actions « read » / « unread »), puis le note dans
 * email_activity.read_at pour tous les appareils. La relève (gmail-poll) fait le chemin
 * inverse toutes les 5 minutes.
 */
export type MailRef = { activityId: string; threadId: string; box: string | null };

type Box = "partnerships" | "talent";

async function setGmail(threadId: string, box: Box, action: "read" | "unread"): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke("gmail-thread", { body: { threadId, box, action } });
    return !error && !!data?.ok && data.action === action;
  } catch {
    return false;
  }
}

/** Fil inconnu de sa boîte (anciennes lignes sans boîte) : on essaie les deux. */
async function setThread(ref: MailRef, action: "read" | "unread"): Promise<boolean> {
  const boxes: Box[] = ref.box === "talent" ? ["talent"] : ref.box === "partnerships" ? ["partnerships"] : ["partnerships", "talent"];
  for (const b of boxes) if (await setGmail(ref.threadId, b, action)) return true;
  return false;
}

/** Marque ces mails lus (ou non lus) dans Gmail, 4 fils à la fois. Renvoie les fils réussis. */
export async function syncMailsRead(refs: MailRef[], read: boolean): Promise<string[]> {
  const byThread = new Map<string, MailRef>();
  for (const r of refs) if (r.threadId && !byThread.has(r.threadId)) byThread.set(r.threadId, r);
  const queue = [...byThread.values()].slice(0, 60);
  const done: string[] = [];
  const work = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) if (await setThread(r, read ? "read" : "unread")) done.push(r.threadId);
  };
  await Promise.all([work(), work(), work(), work()]);
  if (done.length) await markActivity(done, read);
  return done;
}

/** Note l'état lu de ces fils dans la cloche (tous les appareils). */
export async function markActivity(threads: string[], read: boolean): Promise<void> {
  if (!threads.length) return;
  try {
    await supabase.from("email_activity").update({ read_at: read ? new Date().toISOString() : null })
      .eq("direction", "in").in("thread_id", threads);
  } catch {
    /* colonne absente ou réseau : la relève rattrapera */
  }
}
