import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabase";
import { useLiveKey } from "./useLive";
import { initNavSeen, oldestSeen, seenAt, subscribeNavSeen, syncNavSeen } from "./navSeen";
import type { NotificationItem } from "@/components/ui/notifications";

/*
 * Pastilles du menu (ordinateur, onglets iPhone, écran « Plus »). Le chiffre d'une
 * page additionne :
 *   - ce qui est NOUVEAU POUR TOI depuis ta dernière visite de la page : ce que le
 *     reste de l'équipe y a fait (ajouté, terminé, rouvert, changé de statut ou
 *     d'étape, d'après le journal agency_activity) et ce que les créateurs y ont
 *     ajouté (tâches, idées, évènements, cadeaux ; mails et avis sur leurs mails).
 *     Ouvrir la page remet ce compteur à zéro ;
 *   - ce qui reste À TRAITER (cloche) : briefs à valider, factures en retard,
 *     contrats à renouveler, bugs. Ça disparaît quand c'est réglé ou effacé.
 */
const ACTIVITY_PAGE: Record<string, string> = {
  todos: "todo", todo_routines: "todo", ideas: "ideas", events: "planning", contacts: "contacts",
  creators: "roster", collabs: "collabs", briefs: "briefs", invoices: "facturation", documents: "documents",
  gifting: "gifting", creator_pool: "vivier", prospects: "prospection",
};
const PENDING_KINDS = new Set(["brief", "facture", "contrat", "bug"]);
const MIN_GAP = 55_000; // au plus une relecture par minute (le tick live passe toutes les 20 s)

type Hit = { page: string; at: number };
type Row = { created_at: string };

export function useNavBadges(uid: string | undefined, notifs: NotificationItem[], viewing: string[]): Record<string, number> {
  const live = useLiveKey();
  const [hits, setHits] = useState<Hit[]>([]);
  const [version, setVersion] = useState(0);
  const last = useRef({ uid: "", at: 0 });

  useEffect(() => subscribeNavSeen(() => setVersion((v) => v + 1)), []);

  useEffect(() => {
    if (!uid) return;
    initNavSeen(uid);
    if (last.current.uid === uid && Date.now() - last.current.at < MIN_GAP) return;
    last.current = { uid, at: Date.now() };
    void syncNavSeen();
    let alive = true;
    const since = new Date(oldestSeen()).toISOString();
    const rows = (page: string, q: PromiseLike<{ data: unknown; error: unknown }>) =>
      Promise.resolve(q).then(({ data, error }) => (error ? [] : ((data ?? []) as Row[]).map((r) => ({ page, at: Date.parse(r.created_at) }))));
    Promise.all([
      Promise.resolve(
        supabase.from("agency_activity").select("entity, created_at").neq("actor_id", uid).gte("created_at", since)
          .in("verb", ["add", "done", "reopen", "status", "step"]).order("created_at", { ascending: false }).limit(500),
      ).then(({ data, error }) =>
        error ? [] : ((data ?? []) as { entity: string; created_at: string }[])
          .filter((r) => ACTIVITY_PAGE[r.entity])
          .map((r) => ({ page: ACTIVITY_PAGE[r.entity], at: Date.parse(r.created_at) })),
      ),
      rows("todo", supabase.from("todos").select("created_at").eq("source", "creator").gte("created_at", since).limit(200)),
      rows("ideas", supabase.from("ideas").select("created_at").eq("source", "creator").gte("created_at", since).limit(200)),
      rows("planning", supabase.from("events").select("created_at").eq("source", "creator").or("deleted.is.null,deleted.eq.false").gte("created_at", since).limit(200)),
      rows("gifting", supabase.from("gifting").select("created_at").eq("source", "creator").gte("created_at", since).limit(200)),
      rows("mails", supabase.from("email_activity").select("created_at").eq("direction", "in").gte("created_at", since).limit(300)),
      rows("mails", supabase.from("creator_mail_status_log").select("created_at").eq("by_role", "creator").gte("created_at", since).limit(200)),
      rows("mails", supabase.from("creator_mail_notes").select("created_at").eq("by_role", "creator").gte("created_at", since).limit(200)),
    ]).then((lists) => {
      if (alive) setHits(lists.flat().filter((h) => Number.isFinite(h.at)));
    }).catch(() => {});
    return () => {
      alive = false;
    };
  }, [uid, live]);

  const viewingKey = viewing.join("|");
  return useMemo(() => {
    const open = new Set(viewingKey.split("|"));
    const out: Record<string, number> = {};
    for (const h of hits) if (!open.has(h.page) && h.at > seenAt(h.page)) out[h.page] = (out[h.page] ?? 0) + 1;
    for (const n of notifs) if (n.page && n.kind && PENDING_KINDS.has(n.kind)) out[n.page] = (out[n.page] ?? 0) + 1;
    return out;
    // `version` : une visite enregistrée (ici ou sur un autre appareil) recalcule les chiffres.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits, notifs, viewingKey, version]);
}
