import * as React from "react";
import { TtpBell, TtpBrief, TtpContract, TtpInvoice, TtpMail, TtpPerson, TtpPlanning, TtpPulse, TtpSpark } from "@/components/icons/ttp-icons";
import { BellRing, type LucideIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NotificationPanel, type PanelItem } from "@/components/ui/notification-panel";
import { usePush } from "@/lib/push";
import { toast } from "@/components/ui/toast";
import { viewTitle } from "@/lib/nav";
import { actorInitials, readIds, toggleIds, writeIds } from "@/lib/notifLocal";
import type { StatusTone } from "@/lib/statusTone";

export type NotifKind = "team" | "creator" | "email" | "facture" | "brief" | "event" | "contrat" | "bug";

export interface NotificationItem {
  id: string;
  title: string;
  description: string;
  time: string;
  kind?: NotifKind;
  /** Page concernée (id du menu). Les choses à traiter (briefs, factures, contrats, bugs) comptent dans sa pastille. */
  page?: string;
}

/** Types de notifications (ordre d'affichage des filtres). */
export const NOTIF_KINDS: { value: NotifKind; label: string }[] = [
  { value: "team", label: "Équipe" },
  { value: "creator", label: "Créateurs" },
  { value: "email", label: "Emails" },
  { value: "facture", label: "Factures" },
  { value: "brief", label: "Briefs" },
  { value: "event", label: "Agenda" },
  { value: "contrat", label: "Contrats" },
  { value: "bug", label: "Bugs" },
];

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
              className="shrink-0 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
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
          onClick={async () => {
            const ok = await enable();
            if (!ok && Notification.permission === "granted") toast("Activation échouée — réessaie");
          }}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-primary px-3 py-2 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <BellRing className="h-3.5 w-3.5" /> {busy ? "Activation…" : "Activer sur ce téléphone"}
        </button>
      )}
    </div>
  );
}

/** Icône et couleur de chaque genre de notification (statuts : rouge = argent en retard seulement). */
const KIND_META: Record<NotifKind, { icon: LucideIcon; tone: StatusTone }> = {
  team: { icon: TtpPerson, tone: "progress" },
  creator: { icon: TtpSpark, tone: "info" },
  email: { icon: TtpMail, tone: "progress" },
  facture: { icon: TtpInvoice, tone: "late" },
  brief: { icon: TtpBrief, tone: "info" },
  event: { icon: TtpPlanning, tone: "progress" },
  contrat: { icon: TtpContract, tone: "wait" },
  bug: { icon: TtpPulse, tone: "wait" },
};
/** Ce qui attend un geste (onglet « À traiter ») et le bouton proposé dans la ligne. */
const KIND_ACTION: Partial<Record<NotifKind, string>> = {
  facture: "Relancer",
  brief: "Valider le brief",
  contrat: "Voir le contrat",
  bug: "Voir le diagnostic",
};

export function Notifications({
  items = [],
  onDismiss,
  onOpenPage,
  variant = "default",
}: {
  /** « bar » : simple icône pour la barre de titre du mode iPhone ; « sidebar » : bouton du pied de menu (s'ouvre à droite). */
  variant?: "default" | "bar" | "sidebar";
  items?: NotificationItem[];
  /** Effacement PERSISTANT (mémorisé côté serveur) — sinon la notif revient au refresh. */
  onDismiss?: (ids: string[]) => void;
  /** Ouvre la page concernée (clic sur une ligne, bouton d'action, réglages). */
  onOpenPage?: (page: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  // Lue / archivée : propre à cet appareil (lib/notifLocal).
  const [read, setRead] = React.useState(() => readIds("read"));
  const [archived, setArchived] = React.useState(() => readIds("archived"));
  const mark = (ids: string[], on: boolean) => {
    const next = toggleIds(read, ids, on);
    setRead(next);
    writeIds("read", next);
  };
  const archive = (ids: string[], on: boolean) => {
    const next = toggleIds(archived, ids, on);
    setArchived(next);
    writeIds("archived", next);
  };

  const panelItems: PanelItem[] = items.map((n) => {
    const kind = n.kind ?? "team";
    const meta = KIND_META[kind];
    const action = KIND_ACTION[kind];
    return {
      id: n.id,
      title: n.title,
      description: n.description,
      time: n.time,
      context: n.page ? viewTitle(n.page) : undefined,
      initials: kind === "team" ? actorInitials(n.title) || undefined : undefined,
      icon: meta.icon,
      tone: meta.tone,
      unread: !read.has(n.id),
      archived: archived.has(n.id),
      actionable: !!action,
      actions: action && n.page && onOpenPage ? [{ id: "open", label: action, tone: "primary" }] : undefined,
    };
  });
  const unreadCount = panelItems.filter((n) => n.unread && !n.archived).length;
  const go = (id: string) => {
    const page = items.find((n) => n.id === id)?.page;
    if (page && onOpenPage) {
      onOpenPage(page);
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Notifications"
          className={variant === "bar"
            ? "relative grid h-11 w-11 place-items-center text-foreground"
            : variant === "sidebar"
              ? "relative grid h-9 w-9 shrink-0 place-items-center rounded-full text-foreground/60 transition-colors hover:bg-rowhover hover:text-foreground"
              : "relative grid h-10 w-10 place-items-center rounded-full bg-surface text-foreground shadow-sm transition-colors hover:bg-rowhover"}
        >
          <TtpBell className={variant === "bar" ? "h-[22px] w-[22px]" : "h-4 w-4"} strokeWidth={variant === "bar" ? 1.9 : 2} />
          {unreadCount > 0 && (
            <span className={(variant === "bar" ? "absolute right-1 top-1" : variant === "sidebar" ? "absolute -right-0.5 -top-0.5" : "absolute -right-1 -top-1") + " grid h-[18px] min-w-[18px] place-items-center rounded-full bg-badge px-1 text-[10px] font-bold text-white"}>
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[400px] max-w-[calc(100vw-1rem)] overflow-hidden p-0"
        side={variant === "sidebar" ? "right" : undefined}
        align="end"
        sideOffset={variant === "sidebar" ? 14 : 8}
      >
        <NotificationPanel
          items={panelItems}
          maxHeight={440}
          top={<PushRow />}
          onOpenItem={(it) => go(it.id)}
          onAction={(it) => go(it.id)}
          onReadChange={(it, unread) => mark([it.id], !unread)}
          onArchiveChange={(it, on) => archive([it.id], on)}
          onDelete={onDismiss ? (it) => onDismiss([it.id]) : undefined}
          onMarkAllRead={() => mark(items.map((n) => n.id), true)}
          onSettings={onOpenPage ? () => {
            onOpenPage("parametres");
            setOpen(false);
          } : undefined}
        />
      </PopoverContent>
    </Popover>
  );
}
