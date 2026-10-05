import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { listMails, type MailThreadLite } from "./creatorMail";
import { useLiveKey } from "./useLive";

/*
 * Pastilles de la page Mails (agence) : pour chaque créateur relié, le nombre
 * d'échanges À TRAITER = nouvelles demandes (l'agence n'a pas encore répondu et
 * aucun statut n'a été choisi) + échanges où le créateur a laissé un message que
 * l'agence n'a pas encore lu. Un échange qui coche les deux cases compte une fois.
 *
 * Les listes Gmail sont relues au plus toutes les 3 min, un créateur à la fois
 * (pour ménager Gmail) ; les messages non lus (une requête en base) à chaque
 * rafraîchissement. La boîte d'un créateur ouverte met sa pastille à jour tout
 * de suite (reportCreatorThreads / markCreatorNotesRead).
 */
const LIST_TTL = 3 * 60_000;
const key = (n: string) => n.trim().toLowerCase();
const nouvelles = new Map<string, Set<string>>(); // créateur → échanges « Nouvelle demande »
let unreadNotes = new Map<string, Set<string>>(); // créateur → échanges avec un message non lu
const listedAt = new Map<string, number>();
let running = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** Nombre d'échanges à traiter pour ce créateur (0 si rien ou pas encore chargé). */
export function mailTodoCount(name: string): number {
  const a = nouvelles.get(key(name));
  const b = unreadNotes.get(key(name));
  if (!a?.size) return b?.size ?? 0;
  if (!b?.size) return a.size;
  return new Set([...a, ...b]).size;
}

/** La boîte ouverte connaît déjà ses échanges : sa pastille suit sans autre appel. */
export function reportCreatorThreads(creator: string, threads: MailThreadLite[]) {
  nouvelles.set(key(creator), new Set(threads.filter((t) => t.status === "nouvelle").map((t) => t.id)));
  listedAt.set(key(creator), Date.now());
  emit();
}

/** Les messages du créateur sur cet échange viennent d'être lus par l'agence. */
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

async function refresh(creators: string[]) {
  if (running) return;
  running = true;
  try {
    await loadUnreadNotes();
    for (const c of creators) {
      if (Date.now() - (listedAt.get(key(c)) ?? 0) < LIST_TTL) continue;
      try {
        const r = await listMails(c);
        reportCreatorThreads(c, r.configured ? r.threads : []);
      } catch {
        listedAt.set(key(c), Date.now()); // erreur (Gmail, réseau) : nouvel essai dans 3 min
      }
    }
  } finally {
    running = false;
  }
}

/**
 * Pastilles des créateurs reliés (`creators`), rafraîchies avec le reste de l'app.
 * Renvoie la fonction de comptage (stable) ; le composant se redessine à chaque mise à jour.
 */
export function useCreatorMailCounts(creators: string[]): (name: string) => number {
  const [, setVersion] = useState(0);
  const live = useLiveKey();
  const list = useRef(creators);
  list.current = creators;
  const sig = creators.map(key).join("|");
  useEffect(() => {
    const f = () => setVersion((v) => v + 1);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  useEffect(() => {
    if (list.current.length) void refresh(list.current);
  }, [sig, live]);
  return mailTodoCount;
}
