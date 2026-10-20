import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Archive, Bell, Check, CheckCheck, Inbox, MoreHorizontal, Settings2, Trash2, type LucideIcon } from "@/components/icons";
import { TONE_SOLID, type StatusTone } from "@/lib/statusTone";
import { cn } from "@/lib/utils";

/*
 * Panneau de notifications (d'après un composant fourni par Marc, adapté à l'app :
 * français, jetons de couleur, motion/react).
 *
 * Une notification est une phrase : le titre porte le sens, la description et le
 * moment restent discrets. La pastille sur l'avatar dit de quel genre d'évènement il
 * s'agit, pour sauter d'un coup d'œil toute une famille de lignes.
 *
 *   • Les actions se règlent sur place : la ligne ne disparaît pas, elle garde une
 *     petite trace de ce qui a été fait.
 *   • Archiver est un déplacement, pas un effacement : la ligne part dans
 *     « Archivées » et le menu ⋯ peut la remettre. « Effacer » supprime pour de bon.
 */

const SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 } as const;
const SOFT = { type: "spring", stiffness: 300, damping: 30 } as const;

export type PanelAction = {
  id: string;
  label: string;
  tone?: "primary" | "quiet";
  /** Ce que la ligne affiche une fois l'action faite. */
  resolved?: string;
};

export type PanelItem = {
  id: string;
  /** Phrase principale (« Facture en retard », « Gianni a terminé la tâche »). */
  title: string;
  description?: string;
  time: string;
  /** Où ça se passe (nom de la page), en fil discret sous la phrase. */
  context?: string;
  /** Avatar : initiales d'une personne, sinon l'icône du genre d'évènement. */
  initials?: string;
  icon: LucideIcon;
  tone: StatusTone;
  unread?: boolean;
  archived?: boolean;
  /** Demande une action (onglet « À traiter »). */
  actionable?: boolean;
  actions?: PanelAction[];
};

export type NotificationPanelProps = {
  items: PanelItem[];
  onAction?: (item: PanelItem, actionId: string) => void;
  onOpenItem?: (item: PanelItem) => void;
  onReadChange?: (item: PanelItem, unread: boolean) => void;
  onArchiveChange?: (item: PanelItem, archived: boolean) => void;
  onDelete?: (item: PanelItem) => void;
  onMarkAllRead?: () => void;
  onSettings?: () => void;
  /** Bloc affiché sous l'en-tête (ex. activation des notifications sur ce téléphone). */
  top?: React.ReactNode;
  maxHeight?: number;
  className?: string;
};

function Avatar({ item }: { item: PanelItem }) {
  const Icon = item.icon;
  return (
    <span className="relative block h-8 w-8 shrink-0">
      <span aria-hidden className={cn("grid h-8 w-8 place-items-center rounded-full bg-field text-[11px] font-semibold", item.tone === "late" ? "text-late" : item.tone === "wait" ? "text-wait" : "text-muted-foreground")}>
        {item.initials ? item.initials : <Icon className="h-4 w-4" />}
      </span>
      {/* Genre d'évènement, lisible sans lire la phrase */}
      {item.initials && (
        <span aria-hidden className={cn("absolute -bottom-0.5 -right-0.5 grid h-[15px] w-[15px] place-items-center rounded-full ring-2 ring-surface", TONE_SOLID[item.tone])}>
          <Icon className="h-[9px] w-[9px]" />
        </span>
      )}
    </span>
  );
}

const MENU_W = 196;
const MENU_GAP = 6;

/**
 * Menu ⋯ d'une ligne. Rendu dans un portail (la liste défile : un menu sur la
 * dernière ligne serait coupé), donc placé à la main et retourné au-dessus du
 * bouton quand la place manque sous lui, dans les limites du panneau.
 */
function RowMenu({ unread, archived, onRead, onArchive, onDelete }: { unread: boolean; archived: boolean; onRead: () => void; onArchive: () => void; onDelete?: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [box, setBox] = React.useState({ top: 0, left: 0, above: false });
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  const place = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      setOpen(false);
      return;
    }
    const r = trigger.getBoundingClientRect();
    // La ligne est sortie de la liste en défilant : on ferme plutôt que de flotter seul.
    const list = trigger.closest("[data-notif-list]")?.getBoundingClientRect();
    if (list && (r.bottom < list.top + 4 || r.top > list.bottom - 4)) {
      setOpen(false);
      return;
    }
    const height = menuRef.current?.offsetHeight ?? 110;
    const panel = trigger.closest("[data-notification-panel]")?.getBoundingClientRect();
    const lowest = Math.min(panel?.bottom ?? window.innerHeight, window.innerHeight - 8);
    const highest = Math.max(panel?.top ?? 0, 8);
    const fitsBelow = r.bottom + MENU_GAP + height <= lowest;
    const fitsAbove = r.top - MENU_GAP - height >= highest;
    const above = !fitsBelow && fitsAbove;
    let top = above ? r.top - MENU_GAP - height : r.bottom + MENU_GAP;
    if (!fitsBelow && !fitsAbove) top = Math.max(highest, lowest - height);
    top = Math.min(Math.max(top, 8), Math.max(8, window.innerHeight - height - 8));
    setBox({ top, left: Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8)), above });
  }, []);

  React.useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  React.useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  const entry = "flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[12.5px] text-foreground/85 transition-colors hover:bg-rowhover";
  const run = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Options de la notification"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={cn(
          "grid h-6 w-6 place-items-center rounded-[7px] transition-colors hover:bg-rowhover hover:text-foreground",
          // Visible au repos : un bouton qu'on ne voit pas, personne ne le trouve.
          open ? "bg-rowhover text-foreground" : "text-muted-foreground opacity-70 group-hover/row:opacity-100 focus-visible:opacity-100",
        )}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <motion.div
                  ref={menuRef}
                  role="menu"
                  // Le menu vit dans un portail : un clic dedans ne doit pas fermer le panneau.
                  onPointerDown={(e) => e.stopPropagation()}
                  initial={{ opacity: 0, scale: 0.98, y: box.above ? 4 : -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98, y: box.above ? 4 : -4 }}
                  transition={SOFT}
                  style={{ position: "fixed", top: box.top, left: box.left, width: MENU_W }}
                  className={cn("z-[1300] rounded-[12px] border border-border bg-popover p-1 shadow-xl", box.above ? "origin-bottom-right" : "origin-top-right")}
                >
                  <button type="button" role="menuitem" className={entry} onClick={run(onRead)}>
                    <Check className="h-3.5 w-3.5 text-muted-foreground" />
                    {unread ? "Marquer comme lue" : "Marquer comme non lue"}
                  </button>
                  <button type="button" role="menuitem" className={entry} onClick={run(onArchive)}>
                    {archived ? <Inbox className="h-3.5 w-3.5 text-muted-foreground" /> : <Archive className="h-3.5 w-3.5 text-muted-foreground" />}
                    {archived ? "Remettre dans la liste" : "Archiver"}
                  </button>
                  {onDelete && (
                    <button type="button" role="menuitem" className={cn(entry, "text-destructive")} onClick={run(onDelete)}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Effacer pour toute l'équipe
                    </button>
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}

function Row({
  item,
  resolved,
  onAction,
  onOpen,
  onRead,
  onArchive,
  onDelete,
}: {
  item: PanelItem;
  resolved?: string;
  onAction: (actionId: string) => void;
  onOpen: () => void;
  onRead: () => void;
  onArchive: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group/row relative flex w-full cursor-default gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-offset-[-2px]",
        item.unread ? "bg-primary/[0.04] hover:bg-primary/[0.07]" : "hover:bg-rowhover",
      )}
    >
      <Avatar item={item} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className={cn("m-0 text-[13px] leading-[1.45]", item.unread ? "font-semibold text-foreground" : "font-medium text-foreground/90")}>{item.title}</p>
            {item.description && <p className="m-0 mt-0.5 line-clamp-2 text-[12.5px] leading-[1.45] text-muted-foreground">{item.description}</p>}
            {/* Moment et endroit, sur une ligne discrète */}
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-faint">
              <span>{item.time}</span>
              {item.context && (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate">{item.context}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
            <RowMenu unread={!!item.unread} archived={!!item.archived} onRead={onRead} onArchive={onArchive} onDelete={onDelete} />
            {item.unread ? <span aria-label="Non lue" className="mt-[7px] h-[7px] w-[7px] shrink-0 rounded-full bg-primary" /> : <span className="h-[7px] w-[7px] shrink-0" />}
          </div>
        </div>
        {/* Une action faite garde sa place dans l'historique */}
        {resolved ? (
          <p className="m-0 mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Check className="h-3.5 w-3.5 text-ok" strokeWidth={2.75} />
            {resolved}
          </p>
        ) : item.actions?.length ? (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {item.actions.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAction(a.id);
                }}
                className={cn(
                  "inline-flex h-8 items-center rounded-full px-3.5 text-[12.5px] font-medium transition-colors",
                  a.tone === "primary" ? "bg-primary text-primary-foreground hover:opacity-90" : "bg-field text-foreground hover:bg-rowhover",
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

type TabId = "all" | "unread" | "todo" | "archived";
const TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "Tout" },
  { id: "unread", label: "Non lues" },
  { id: "todo", label: "À traiter" },
  { id: "archived", label: "Archivées" },
];

export function NotificationPanel({
  items,
  onAction,
  onOpenItem,
  onReadChange,
  onArchiveChange,
  onDelete,
  onMarkAllRead,
  onSettings,
  top,
  maxHeight = 420,
  className,
}: NotificationPanelProps) {
  const reduced = useReducedMotion();
  const [tab, setTab] = React.useState<TabId>("all");
  const [resolved, setResolved] = React.useState<Record<string, string>>({});

  const shown = React.useMemo(() => {
    switch (tab) {
      case "unread":
        return items.filter((n) => !n.archived && n.unread);
      case "todo":
        return items.filter((n) => !n.archived && n.actionable);
      case "archived":
        return items.filter((n) => n.archived);
      default:
        return items.filter((n) => !n.archived);
    }
  }, [items, tab]);

  const unread = items.filter((n) => n.unread && !n.archived).length;
  const counts: Record<TabId, number> = {
    all: 0,
    unread,
    todo: items.filter((n) => n.actionable && !n.archived).length,
    archived: 0,
  };

  return (
    <div data-notification-panel="" className={cn("w-full overflow-hidden bg-popover text-foreground", className)}>
      <div className="flex items-center justify-between gap-3 px-4 pb-0.5 pt-3.5">
        <h2 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">Notifications</h2>
        <button
          type="button"
          onClick={() => onMarkAllRead?.()}
          disabled={unread === 0}
          className="inline-flex items-center gap-1.5 rounded-[8px] px-1.5 py-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <CheckCheck className="h-3.5 w-3.5" />
          Tout marquer comme lu
        </button>
      </div>

      <div className="flex items-center gap-1 border-b border-border px-3">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={active ? "page" : undefined}
                className={cn("relative shrink-0 px-2 py-2.5 text-[13px] font-medium transition-colors", active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                <span className="inline-flex items-center gap-1.5">
                  {t.label}
                  {counts[t.id] > 0 ? <span className="rounded-full bg-primary px-1.5 py-px text-[10.5px] font-semibold tabular-nums text-primary-foreground">{counts[t.id]}</span> : null}
                </span>
                {active ? (
                  <motion.span layoutId="notif-tab" transition={reduced ? { duration: 0 } : SPRING} className="absolute inset-x-1.5 -bottom-px h-[3px] rounded-full bg-foreground" />
                ) : null}
              </button>
            );
          })}
        </div>
        {onSettings && (
          <button
            type="button"
            aria-label="Réglages des notifications"
            title="Réglages des notifications"
            onClick={onSettings}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
          >
            <Settings2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {top}

      <div data-notif-list="" style={{ maxHeight }} className="divide-y divide-border overflow-y-auto overscroll-contain [scrollbar-width:thin]">
        <AnimatePresence initial={false}>
          {shown.map((item) => (
            <motion.div
              key={item.id}
              layout={!reduced}
              initial={false}
              exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0, transition: { duration: 0.18 } }}
              transition={SPRING}
            >
              <Row
                item={item}
                resolved={resolved[item.id]}
                onOpen={() => {
                  if (item.unread) onReadChange?.(item, false);
                  onOpenItem?.(item);
                }}
                onRead={() => onReadChange?.(item, !item.unread)}
                onArchive={() => onArchiveChange?.(item, !item.archived)}
                onDelete={onDelete ? () => onDelete(item) : undefined}
                onAction={(actionId) => {
                  const action = item.actions?.find((a) => a.id === actionId);
                  if (action?.resolved) setResolved((r) => ({ ...r, [item.id]: action.resolved! }));
                  if (item.unread) onReadChange?.(item, false);
                  onAction?.(item, actionId);
                }}
              />
            </motion.div>
          ))}
        </AnimatePresence>

        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-field text-muted-foreground">
              <Bell className="h-[18px] w-[18px]" />
            </span>
            <p className="m-0 text-[13px] font-medium text-foreground">{tab === "archived" ? "Rien d'archivé" : tab === "todo" ? "Rien à traiter" : "Tu es à jour"}</p>
            <p className="m-0 text-[12.5px] text-muted-foreground">{tab === "archived" ? "Les notifications archivées arrivent ici." : "Les nouveautés s'afficheront ici."}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default NotificationPanel;
