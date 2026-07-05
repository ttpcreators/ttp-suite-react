import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { getAppState, invalidateAppState, saveAppStateKey } from "./appState";
import { useLiveKey } from "./useLive";
import { todayISO } from "./dates";
import { titleCase } from "./utils";
import { toast } from "@/components/ui/toast";
import type { NotificationItem } from "@/components/ui/notifications";

type Deadline = { creator: string; type: string; start: string; months: number };
function ctEnd(start: string, months: number): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(start);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1 + (months || 0), Number(m[3]));
}
function ctDaysLeft(d: Date): number {
  const t = new Date();
  return Math.round((d.getTime() - new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()) / 86400000);
}
/** "il y a X j" / "hier" / "aujourd'hui" à partir d'un created_at. */
function agoLabel(iso: string | null): string {
  if (!iso) return "récemment";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "récemment";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "hier";
  return `il y a ${days} j`;
}

/** Notifications dérivées des vraies données : activité créateur, factures en retard, briefs à valider, événements.
 *  Les IDs sont STABLES (contenu, pas index) pour que l'effacement persiste :
 *  les ids effacés sont mémorisés dans le blob agence `notifDismissed`. */
export function useNotifications(): { items: NotificationItem[]; dismiss: (ids: string[]) => void } {
  const [items, setItems] = useState<NotificationItem[]>([]);
  // Rejoue le fetch à chaque tick live : indispensable après une connexion par
  // formulaire (le premier fetch part AVANT l'auth → RLS renvoie vide) et pour
  // garder la cloche à jour sans recharger la page.
  const live = useLiveKey();

  useEffect(() => {
    let alive = true;
    const run = async () => {
    // Attend la restauration de la session : un fetch pré-auth renvoie des
    // listes vides (RLS) et mettrait en cache un blob vide → les notifications
    // effacées réapparaîtraient au refresh. On repart toujours d'un blob frais.
    const { data: s } = await supabase.auth.getSession();
    if (!alive) return;
    if (!s.session) {
      setItems([]);
      return;
    }
    invalidateAppState();
    const todayStr = todayISO();
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    Promise.all([
      supabase.from("invoices").select("party,amount,status").eq("status", "retard"),
      supabase.from("briefs").select("brand,creator,status").eq("status", "valider"),
      supabase.from("events").select("date,time,title").or("deleted.is.null,deleted.eq.false").gte("date", todayStr).order("date").limit(3),
      getAppState().catch(() => ({}) as Record<string, unknown>),
      supabase.from("todos").select("text,creator,created_at").eq("source", "creator").gte("created_at", weekAgo).order("created_at", { ascending: false }).limit(8),
      supabase.from("ideas").select("text,creator,created_at").eq("source", "creator").gte("created_at", weekAgo).order("created_at", { ascending: false }).limit(8),
    ]).then(([inv, br, ev, app, tdC, idC]) => {
      if (!alive) return;
      if (inv.error || br.error || ev.error) {
        console.error("Chargement des notifications échoué:", { inv: inv.error, br: br.error, ev: ev.error });
        setItems([]);
        return;
      }
      const out: NotificationItem[] = [];
      // Activité créateur en premier (7 derniers jours) — désactivable dans Paramètres.
      const prefs = ((app as Record<string, unknown>).notifPrefs as Record<string, boolean | undefined>) ?? {};
      const bellCreator = prefs.bellCreatorActivity !== false;
      if (bellCreator && !tdC.error) {
        ((tdC.data as { text: string; creator: string | null; created_at: string | null }[]) ?? []).forEach((t) =>
          out.push({
            id: `ctd:${t.created_at}:${t.text.slice(0, 40)}`,
            title: "Nouvelle tâche d'un créateur",
            description: `${t.creator ? titleCase(t.creator) : "Créateur"} · ${t.text}`,
            time: agoLabel(t.created_at),
          }),
        );
      }
      if (bellCreator && !idC.error) {
        ((idC.data as { text: string; creator: string | null; created_at: string | null }[]) ?? []).forEach((i) =>
          out.push({
            id: `cid:${i.created_at}:${i.text.slice(0, 40)}`,
            title: "Nouvelle idée d'un créateur",
            description: `${i.creator ? titleCase(i.creator) : "Créateur"} · ${i.text}`,
            time: agoLabel(i.created_at),
          }),
        );
      }
      ((inv.data as { party: string; amount: string }[]) ?? []).forEach((i) =>
        out.push({
          id: `inv:${i.party}:${i.amount}`,
          title: "Facture en retard",
          description: `${i.party} · ${i.amount}`,
          time: "à relancer",
        }),
      );
      ((br.data as { brand: string; creator: string | null }[]) ?? []).forEach((b) =>
        out.push({
          id: `br:${b.brand}:${b.creator ?? ""}`,
          title: "Brief à valider",
          description: `${b.brand}${b.creator ? ` × ${titleCase(b.creator)}` : ""}`,
          time: "en attente",
        }),
      );
      ((ev.data as { date: string; time: string; title: string }[]) ?? []).forEach((e) =>
        out.push({
          id: `ev:${e.date}:${e.title.slice(0, 40)}`,
          title: "Événement à venir",
          description: `${e.title}${e.time && e.time !== "—" ? ` · ${e.time}` : ""}`,
          time: e.date,
        }),
      );
      // Contrats bientôt échus (≤ 60 jours) ou déjà expirés.
      (((app as Record<string, unknown>).contractDeadlines as Deadline[]) ?? []).forEach((d) => {
        const end = ctEnd(d.start, d.months);
        if (!end) return;
        const left = ctDaysLeft(end);
        if (left > 60) return;
        out.push({
          id: `ct:${d.creator}:${d.type}:${d.start}`,
          title: left < 0 ? "Contrat expiré" : "Contrat à renouveler",
          description: `${titleCase(d.creator)} · ${d.type}`,
          time: left < 0 ? `expiré depuis ${-left} j` : `expire dans ${left} j`,
        });
      });
      // Ne réaffiche jamais ce qui a été effacé (persisté dans le blob).
      const dismissed = new Set(((app as Record<string, unknown>).notifDismissed as string[]) ?? []);
      setItems(out.filter((n) => !dismissed.has(n.id)));
    }).catch((e) => {
      if (!alive) return;
      console.error("Notifications — échec réseau:", e);
      setItems([]);
    });
    };
    run();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  /** Efface définitivement (persiste les ids dans le blob agence, tous appareils). */
  const dismiss = async (ids: string[]) => {
    if (!ids.length) return;
    setItems((prev) => prev.filter((n) => !ids.includes(n.id)));
    invalidateAppState();
    const cur = (((await getAppState())["notifDismissed"] as string[]) ?? []);
    const merged = [...new Set([...cur, ...ids])].slice(-300); // borne la liste
    const ok = await saveAppStateKey("notifDismissed", merged);
    if (!ok) toast("Effacement non synchronisé — réessaie");
  };

  return { items, dismiss };
}
