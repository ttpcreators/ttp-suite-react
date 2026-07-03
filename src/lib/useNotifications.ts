import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { getAppState } from "./appState";
import { titleCase } from "./utils";
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

/** Notifications dérivées des vraies données : activité créateur, factures en retard, briefs à valider, événements. */
export function useNotifications(): NotificationItem[] {
  const [items, setItems] = useState<NotificationItem[]>([]);

  useEffect(() => {
    let alive = true;
    const todayStr = new Date().toISOString().slice(0, 10);
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
      // Activité créateur en premier (ce qu'un créateur a ajouté depuis son espace, 7 derniers jours).
      if (!tdC.error) {
        ((tdC.data as { text: string; creator: string | null; created_at: string | null }[]) ?? []).forEach((t, k) =>
          out.push({
            id: `ctd-${k}`,
            title: "Nouvelle tâche d'un créateur",
            description: `${t.creator ? titleCase(t.creator) : "Créateur"} · ${t.text}`,
            time: agoLabel(t.created_at),
          }),
        );
      }
      if (!idC.error) {
        ((idC.data as { text: string; creator: string | null; created_at: string | null }[]) ?? []).forEach((i, k) =>
          out.push({
            id: `cid-${k}`,
            title: "Nouvelle idée d'un créateur",
            description: `${i.creator ? titleCase(i.creator) : "Créateur"} · ${i.text}`,
            time: agoLabel(i.created_at),
          }),
        );
      }
      ((inv.data as { party: string; amount: string }[]) ?? []).forEach((i, k) =>
        out.push({
          id: `inv-${k}`,
          title: "Facture en retard",
          description: `${i.party} · ${i.amount}`,
          time: "à relancer",
        }),
      );
      ((br.data as { brand: string; creator: string | null }[]) ?? []).forEach((b, k) =>
        out.push({
          id: `br-${k}`,
          title: "Brief à valider",
          description: `${b.brand}${b.creator ? ` × ${titleCase(b.creator)}` : ""}`,
          time: "en attente",
        }),
      );
      ((ev.data as { date: string; time: string; title: string }[]) ?? []).forEach((e, k) =>
        out.push({
          id: `ev-${k}`,
          title: "Événement à venir",
          description: `${e.title}${e.time && e.time !== "—" ? ` · ${e.time}` : ""}`,
          time: e.date,
        }),
      );
      // Contrats bientôt échus (≤ 60 jours) ou déjà expirés.
      (((app as Record<string, unknown>).contractDeadlines as Deadline[]) ?? []).forEach((d, k) => {
        const end = ctEnd(d.start, d.months);
        if (!end) return;
        const left = ctDaysLeft(end);
        if (left > 60) return;
        out.push({
          id: `ct-${k}`,
          title: left < 0 ? "Contrat expiré" : "Contrat à renouveler",
          description: `${titleCase(d.creator)} · ${d.type}`,
          time: left < 0 ? `expiré depuis ${-left} j` : `expire dans ${left} j`,
        });
      });
      setItems(out);
    }).catch((e) => {
      if (!alive) return;
      console.error("Notifications — échec réseau:", e);
      setItems([]);
    });
    return () => {
      alive = false;
    };
  }, []);

  return items;
}
