import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { titleCase } from "./utils";
import type { NotificationItem } from "@/components/ui/notifications";

/** Notifications dérivées des vraies données : factures en retard, briefs à valider, prochains événements. */
export function useNotifications(): NotificationItem[] {
  const [items, setItems] = useState<NotificationItem[]>([]);

  useEffect(() => {
    let alive = true;
    const todayStr = new Date().toISOString().slice(0, 10);
    Promise.all([
      supabase.from("invoices").select("party,amount,status").eq("status", "retard"),
      supabase.from("briefs").select("brand,creator,status").eq("status", "valider"),
      supabase.from("events").select("date,time,title").gte("date", todayStr).order("date").limit(3),
    ]).then(([inv, br, ev]) => {
      if (!alive) return;
      const out: NotificationItem[] = [];
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
      setItems(out);
    });
    return () => {
      alive = false;
    };
  }, []);

  return items;
}
