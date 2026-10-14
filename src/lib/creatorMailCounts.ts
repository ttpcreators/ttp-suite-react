import { useEffect, useRef, useState, type RefObject } from "react";
import { supabase } from "./supabase";
import { listMails, type MailThreadLite } from "./creatorMail";
import { useLiveKey } from "./useLive";

/*
 * Pastilles de la page Mails (agence) : pour chaque créateur relié, le nombre
 * d'échanges À TRAITER = nouvelles demandes récentes (l'agence n'a pas encore
 * répondu, aucun statut choisi, dernier message de moins de 30 jours) + échanges
 * où le créateur a laissé un message que l'agence n'a pas encore lu. Un échange
 * qui coche les deux cases compte une fois.
 *
 * Coût maîtrisé : rien n'est relu quand l'onglet du navigateur est caché ni quand
 * la page Mails est masquée (`rootRef`). Les listes Gmail sont relues au plus toutes
 * les 5 min par créateur, deux créateurs à la fois au maximum ; les messages non lus
 * (une requête en base) au plus une fois par minute. La boîte d'un créateur ouverte
 * met sa pastille à jour tout de suite (reportCreatorThreads / markCreatorNotesRead).
 */
const LIST_TTL = 5 * 60_000;
const NOTES_GAP = 60_000;
const CONCURRENCY = 2;
/** Une « Nouvelle demande » sans réponse depuis plus de 30 jours n'est plus « à traiter ». */
const STALE_NEW = 30 * 86_400_000;
const key = (n: string) => n.trim().toLowerCase();
const nouvelles = new Map<string, Set<string>>(); // créateur → échanges « Nouvelle demande » récents
let unreadNotes = new Map<string, Set<string>>(); // créateur → échanges avec un message non lu
let notesAt = 0;
const listedAt = new Map<string, number>();
let running = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

const isTodoNew = (t: Pick<MailThreadLite, "status" | "ts">) =>
  t.status === "nouvelle" && (!t.ts || Date.now() - t.ts < STALE_NEW);

/** Nombre d'échanges à traiter pour ce créateur (0 si rien ou pas encore chargé). */
export function mailTodoCount(name: string): number {
  const a = nouvelles.get(key(name));
  const b = unreadNotes.get(key(name));
  if (!a?.size) return b?.size ?? 0;
  if (!b?.size) return a.size;
  return new Set([...a, ...b]).size;
}

/**
 * La boîte ouverte connaît déjà ses échanges : sa pastille suit sans autre appel.
 * `partial` : liste incomplète, les échanges absents gardent leur état précédent.
 */
export function reportCreatorThreads(creator: string, threads: MailThreadLite[], partial = false) {
  const k = key(creator);
  const next = new Set(threads.filter(isTodoNew).map((t) => t.id));
  if (partial) {
    const listed = new Set(threads.map((t) => t.id));
    nouvelles.get(k)?.forEach((id) => {
      if (!listed.has(id)) next.add(id);
    });
  }
  nouvelles.set(k, next);
  listedAt.set(k, Date.now());
  emit();
}

/** Les messages du créateur sur cet échange viennent d'être lus par l'agence (écriture réussie). */
export function markCreatorNotesRead(creator: string, threadId: string) {
  if (unreadNotes.get(key(creator))?.delete(threadId)) emit();
}

async function loadUnreadNotes() {
  const { data, error } = await supabase.from("creator_mail_notes").select("creator, thread_id").is("agency_read_at", null).limit(1000);
  if (error) return;
  const m = new Map<string, Set<string>>();
  for (const r of (data ?? []) as { creator: string; thread_id: string }[]) {
    const s = m.get(key(r.creator)) ?? new Set<string>();
    s.add(r.thread_id);
    m.set(key(r.creator), s);
  }
  unreadNotes = m;
  emit();
}

async function refresh(creators: string[], visible: () => boolean) {
  if (running) return;
  running = true;
  try {
    if (Date.now() - notesAt >= NOTES_GAP) {
      notesAt = Date.now();
      await loadUnreadNotes();
    }
    const due = creators.filter((c) => Date.now() - (listedAt.get(key(c)) ?? 0) >= LIST_TTL);
    let next = 0;
    // Petit pool : jamais plus de CONCURRENCY listes Gmail en même temps.
    const worker = async () => {
      while (next < due.length && visible()) {
        const c = due[next++];
        if (Date.now() - (listedAt.get(key(c)) ?? 0) < LIST_TTL) continue; // relue entre-temps par la boîte ouverte
        try {
          const r = await listMails(c);
          reportCreatorThreads(c, r.configured ? r.threads : [], !!r.partial);
        } catch {
          listedAt.set(key(c), Date.now()); // erreur (Gmail, réseau) : nouvel essai dans 5 min
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, worker));
  } finally {
    running = false;
  }
}

/**
 * Pastilles des créateurs reliés (`creators`), rafraîchies avec le reste de l'app,
 * seulement quand c'est utile : onglet du navigateur visible ET page affichée.
 * `rootRef` (conseillé) : élément de la page Mails ; masquée (vue gardée en mémoire,
 * `hidden`), rien n'est relu. `active: false` coupe aussi les relectures.
 * Renvoie la fonction de comptage (stable) ; le composant se redessine à chaque mise à jour.
 */
export function useCreatorMailCounts(
  creators: string[],
  opts: { rootRef?: RefObject<HTMLElement | null>; active?: boolean } = {},
): (name: string) => number {
  const [, setVersion] = useState(0);
  const live = useLiveKey();
  const list = useRef(creators);
  list.current = creators;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const sig = creators.map(key).join("|");
  useEffect(() => {
    const f = () => setVersion((v) => v + 1);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  useEffect(() => {
    const visible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
      const o = optsRef.current;
      if (o.active === false) return false;
      const el = o.rootRef?.current;
      // Page masquée (display: none quelque part au-dessus) : aucune boîte affichée.
      return !el || el.getClientRects().length > 0;
    };
    if (list.current.length && visible()) void refresh(list.current, visible);
  }, [sig, live, opts.active]);
  return mailTodoCount;
}
