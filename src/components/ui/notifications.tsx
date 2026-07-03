import * as React from "react";
import { Bell, BellRing, GripVertical, Trash2, Archive, ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Card } from "@/components/ui/card";
import { usePush } from "@/lib/push";
import { toast } from "@/components/ui/toast";

export interface NotificationItem {
  id: string;
  title: string;
  description: string;
  time: string;
}

/** Bouton d'activation des notifications push (par téléphone) — au-dessus de la liste. */
function PushRow() {
  const { state, busy, enable, disable, sendTest } = usePush();
  const [testing, setTesting] = React.useState(false);
  if (state === "unsupported") return null;
  const runTest = async () => {
    if (testing) return;
    setTesting(true);
    try {
      const r = await sendTest();
      if (!r.ok) toast(`Échec de l'appel${r.detail ? ` : ${r.detail}` : " — réessaie"}`);
      else if (r.total === 0) toast("Aucun appareil abonné — active d'abord sur ce téléphone");
      else if (r.sent === 0) toast(`Envoi refusé${r.detail ? ` : ${r.detail}` : ""}`);
      else toast(`Notification test envoyée (${r.sent}) 🎉`);
    } finally {
      setTesting(false);
    }
  };
  return (
    <div className="border-b border-border px-4 py-3">
      {state === "enabled" ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-signaltext">
              <BellRing className="h-3.5 w-3.5" /> Activées sur ce téléphone
            </span>
            <button
              type="button"
              onClick={disable}
              disabled={busy}
              className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-faint transition-colors hover:text-foreground disabled:opacity-50"
            >
              Désactiver
            </button>
          </div>
          <button
            type="button"
            onClick={runTest}
            disabled={testing}
            className="w-full rounded-lg border border-border px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50"
          >
            {testing ? "Envoi…" : "Envoyer un test 🔔"}
          </button>
        </div>
      ) : state === "needs-install" ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          📲 Pour recevoir les alertes sur iPhone :{" "}
          <span className="font-medium text-foreground">Partager → Ajouter à l'écran d'accueil</span>, puis ouvre l'app depuis son icône.
        </p>
      ) : state === "denied" ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          🔕 Notifications bloquées. Autorise-les dans les réglages du téléphone (Réglages → Notifications → TTP Suite).
        </p>
      ) : (
        <button
          type="button"
          onClick={enable}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <BellRing className="h-3.5 w-3.5" /> {busy ? "Activation…" : "Activer sur ce téléphone"}
        </button>
      )}
    </div>
  );
}

export function Notifications({ items = [] }: { items?: NotificationItem[] }) {
  const [notifications, setNotifications] = React.useState<NotificationItem[]>(items);
  const [activeId, setActiveId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setNotifications(items);
  }, [items]);

  const remove = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setActiveId(null);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Notifications"
          className="relative grid h-10 w-10 place-items-center rounded-lg bg-surface text-foreground shadow-sm transition-colors hover:bg-rowhover"
        >
          <Bell className="h-4 w-4" />
          {notifications.length > 0 && (
            <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {notifications.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end" sideOffset={8}>
        <Card className="max-h-96 overflow-y-auto border-none shadow-none">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold">Notifications</span>
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={() => setNotifications([])}
                className="text-[10px] font-semibold uppercase tracking-wide text-faint transition-colors hover:text-foreground"
              >
                Tout effacer
              </button>
            )}
          </div>
          <PushRow />
          {notifications.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Aucune notification 🎉</div>
          ) : (
            <ul className="divide-y divide-border">
              {notifications.map((item) => {
                const isActive = activeId === item.id;
                return (
                  <li key={item.id} className="flex items-center justify-between p-4 transition hover:bg-rowhover/50">
                    <motion.div animate={{ x: isActive ? -36 : 0 }} transition={{ duration: 0.2 }} className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{item.title}</span>
                        <span className="shrink-0 text-[11px] text-faint">{item.time}</span>
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">{item.description}</p>
                    </motion.div>
                    <div className="ml-2 flex items-center">
                      {isActive ? (
                        <div className="flex items-center gap-1.5">
                          <button type="button" className="rounded-md p-1 hover:bg-rowhover" onClick={() => setActiveId(null)} title="Archiver">
                            <Archive className="h-4 w-4 text-muted-foreground" />
                          </button>
                          <button type="button" className="rounded-md p-1 hover:bg-rowhover" onClick={() => remove(item.id)} title="Supprimer">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </button>
                          <button type="button" className="rounded-md p-1 hover:bg-rowhover" onClick={() => setActiveId(null)}>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </button>
                        </div>
                      ) : (
                        <button type="button" className="rounded-md p-1 hover:bg-rowhover" onClick={() => setActiveId(item.id)}>
                          <GripVertical className="h-4 w-4 text-muted-foreground" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </PopoverContent>
    </Popover>
  );
}
