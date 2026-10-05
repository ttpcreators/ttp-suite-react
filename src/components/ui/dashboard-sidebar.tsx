import { useEffect, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { Check, ChevronRight, ChevronsUpDown, Columns2, PanelLeftClose, Star, type LucideIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL;

/** Sous-page ; `pinnable` = aussi une vraie page, épinglable aux raccourcis (étoile, clic droit). */
export type SbChild = { id: string; label: string; pinnable?: boolean; badge?: number };
/** `badge` = nombre de notifications de la page (pastille ; 0 ou absent = rien). */
export type SbItem = { id: string; label: string; icon: LucideIcon; badge?: number; children?: SbChild[] };
export type SbGroup = { id: string; label: string; icon: LucideIcon; items: SbItem[] };

/*
 * Langage visuel (façon Efferd) : la sidebar est posée à même le fond, sans
 * cadre. Intitulés de section discrets, icônes et libellés gris, élément actif
 * sur une pastille claire (blanche en clair, gris profond en sombre), aucun
 * aplat de couleur. Partagé par l'espace agence et l'espace créatrices.
 */
const ACTIVE_BG = "bg-surface dark:bg-rowhover";
const HOVER_BG = "hover:bg-surface/60 dark:hover:bg-rowhover/70";

/** Ligne de menu (pleine largeur). */
export const sbItemCls = (active: boolean) =>
  cn(
    "flex w-full select-none items-center gap-2.5 rounded-[8px] px-2.5 py-[6px] text-left text-[13px] transition-colors focus-visible:outline-offset-[-2px]",
    active ? cn(ACTIVE_BG, "font-medium text-foreground") : cn("text-foreground/70 hover:text-foreground", HOVER_BG),
  );
/** Icône d'une ligne de menu. */
export const sbIconCls = (active: boolean) =>
  cn("h-4 w-4 shrink-0 transition-colors", active ? "text-foreground" : "text-foreground/45 group-hover:text-foreground/80");
/** Bouton carré du rail replié (icône seule). */
export const sbRailCls = (active: boolean) =>
  cn(
    "grid h-10 w-10 shrink-0 place-items-center rounded-[10px] transition-colors",
    active ? cn(ACTIVE_BG, "text-foreground") : cn("text-foreground/50 hover:text-foreground", HOVER_BG),
  );
/** Dégradé SVG de l'accent (deux bouts `--accent-a/-b`, égaux hors accent en dégradé). */
const ACCENT_GRAD_ID = "ttp-accent-grad";
function AccentGradientDef() {
  return (
    <svg width="0" height="0" aria-hidden className="absolute">
      <defs>
        <linearGradient id={ACCENT_GRAD_ID} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--accent-a)" }} />
          <stop offset="1" style={{ stopColor: "var(--accent-b)" }} />
        </linearGradient>
      </defs>
    </svg>
  );
}
/** Pastille de nombre (notifications) à droite d'une ligne du menu. */
export function SbCount({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cn("grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-foreground px-1 text-[10.5px] font-semibold tabular-nums text-background", className)}>
      {n > 99 ? "99+" : n}
    </span>
  );
}
/** Total des pastilles d'un item (lui-même + ses sous-pages). */
export const sbBadgeTotal = (item: SbItem) =>
  (item.badge ?? 0) + (item.children ?? []).reduce((s, c) => s + (c.badge ?? 0), 0);
/** Petit bouton d'action révélé dans une ligne (chevron, vue partagée, étoile). */
const ghostBtn = "grid h-6 w-6 place-items-center rounded-md text-foreground/40 transition-colors hover:bg-foreground/[0.06] hover:text-foreground";

function Row({
  item,
  active,
  onClick,
  onContext,
  onSplit,
  hasChildren,
  open,
  onToggle,
  pinned,
  onTogglePin,
}: {
  item: SbItem;
  active: boolean;
  onClick: () => void;
  onContext?: (e: ReactMouseEvent) => void;
  /** Ouvre cette page « à côté » (vue partagée) : bouton révélé au survol. */
  onSplit?: () => void;
  hasChildren?: boolean;
  open?: boolean;
  onToggle?: () => void;
  /** Page épinglée (Raccourcis) → étoile pleine, toujours visible. */
  pinned?: boolean;
  /** Épingle/détache au survol (étoile). Absent = pas d'étoile. */
  onTogglePin?: () => void;
}) {
  // Réserve la place à droite : chevron/split (right-1.5) + étoile épingle (right-8).
  const pr = onTogglePin
    ? (hasChildren ? "pr-[3.75rem]" : "pr-9")
    : (hasChildren ? "pr-9" : "pr-2.5");
  return (
    <div className="group relative flex items-center">
      <button type="button" onClick={onClick} onContextMenu={onContext} className={cn(sbItemCls(active), pr)}>
        <item.icon className={sbIconCls(active)} strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {/* Pastille : décalée pour ne pas passer sous le bouton « à côté » ni l'étoile. */}
        {!!item.badge && (
          <SbCount n={item.badge} className={cn(!hasChildren && (onSplit || onTogglePin) && "mr-6")} />
        )}
      </button>

      {/* Chevron de repli (items à sous-pages) : toggle SANS naviguer */}
      {hasChildren ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.();
          }}
          aria-label={open ? "Replier" : "Déplier"}
          aria-expanded={open}
          className={cn("absolute right-1.5", ghostBtn)}
        >
          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform duration-200", open && "rotate-90")} strokeWidth={2} />
        </button>
      ) : (
        onSplit && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSplit();
            }}
            title="Ouvrir à côté (2 pages côte à côte)"
            aria-label="Ouvrir à côté"
            className={cn("absolute right-1.5 opacity-0 focus-visible:opacity-100 group-hover:opacity-100", ghostBtn)}
          >
            <Columns2 className="h-3.5 w-3.5" />
          </button>
        )
      )}
      {/* Étoile d'épingle : pleine & permanente si épinglée, sinon révélée au survol. */}
      {onTogglePin && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          title={pinned ? "Détacher des raccourcis" : "Épingler aux raccourcis"}
          aria-label={pinned ? "Détacher des raccourcis" : "Épingler aux raccourcis"}
          aria-pressed={pinned}
          className={cn(
            "absolute right-8 focus-visible:opacity-100",
            ghostBtn,
            pinned ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          {/* Épinglée : étoile à la couleur d'accent (dégradé compris, cf. ACCENT_GRAD_ID) */}
          <Star className="h-3.5 w-3.5" style={pinned ? { stroke: `url(#${ACCENT_GRAD_ID})`, fill: `url(#${ACCENT_GRAD_ID})` } : undefined} />
        </button>
      )}
    </div>
  );
}

/**
 * Un item de nav + ses sous-pages REPLIABLES (chevron, animation, guide
 * d'indentation). Ouvert par défaut ; état mémorisé par item ; se rouvre
 * toujours quand la page/ sous-page active est dedans.
 */
function ItemBlock({
  item,
  activeId,
  activeSub,
  onSelect,
  onItemContext,
  onItemSplit,
  isPinned,
  onTogglePin,
}: {
  item: SbItem;
  activeId: string;
  activeSub?: string | null;
  onSelect: (id: string, sub?: string) => void;
  onItemContext?: (id: string, e: ReactMouseEvent) => void;
  onItemSplit?: (id: string) => void;
  isPinned?: (id: string) => boolean;
  onTogglePin?: (id: string) => void;
}) {
  const hasChildren = !!item.children && item.children.length > 0;
  const parentActive = item.id === activeId;
  const childActive = hasChildren && parentActive && item.children!.some((c) => c.id === activeSub);
  const storageKey = `ttp:sb-item:${item.id}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(storageKey) !== "0"; // défaut : ouvert
    } catch {
      return true; // stockage indisponible
    }
  });
  // La page active rouvre toujours son item (navigation / recherche).
  useEffect(() => {
    if (parentActive && hasChildren) setOpen(true);
  }, [parentActive, hasChildren]);
  const toggle = () =>
    setOpen((o) => {
      const next = !o;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* stockage indispo : état gardé en mémoire */
      }
      return next;
    });

  // Sous-pages repliées : leurs pastilles remontent sur la ligne parente.
  const shown = hasChildren && !open ? { ...item, badge: sbBadgeTotal(item) || undefined } : item;
  return (
    <div className="flex flex-col">
      <Row
        item={shown}
        active={parentActive && !childActive}
        hasChildren={hasChildren}
        open={open}
        onToggle={toggle}
        onClick={() => {
          onSelect(item.id);
          if (hasChildren) setOpen(true);
        }}
        onContext={onItemContext ? (e) => onItemContext(item.id, e) : undefined}
        onSplit={!hasChildren && onItemSplit ? () => onItemSplit(item.id) : undefined}
        pinned={isPinned?.(item.id)}
        onTogglePin={onTogglePin ? () => onTogglePin(item.id) : undefined}
      />
      {hasChildren && (
        <div
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-300 ease-in-out",
            open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="min-h-0 overflow-hidden">
            {/* Guide vertical aligné sur le centre de l'icône parente */}
            <div className="my-0.5 ml-[17px] flex flex-col gap-0.5 border-l border-foreground/10 pl-2">
              {item.children!.map((c) => {
                const on = parentActive && activeSub === c.id;
                const pin = c.pinnable && onTogglePin ? () => onTogglePin(c.id) : null;
                const pinnedChild = !!(c.pinnable && isPinned?.(c.id));
                return (
                  <div key={c.id} className="group relative flex items-center">
                    <button
                      type="button"
                      onClick={() => onSelect(item.id, c.id)}
                      onContextMenu={c.pinnable && onItemContext ? (e) => onItemContext(c.id, e) : undefined}
                      className={cn(sbItemCls(on), "py-[5px]", pin && "pr-9")}
                    >
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      {!!c.badge && <SbCount n={c.badge} />}
                    </button>
                    {pin && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          pin();
                        }}
                        title={pinnedChild ? "Détacher des raccourcis" : "Épingler aux raccourcis"}
                        aria-label={pinnedChild ? "Détacher des raccourcis" : "Épingler aux raccourcis"}
                        aria-pressed={pinnedChild}
                        className={cn("absolute right-1.5 focus-visible:opacity-100", ghostBtn, pinnedChild ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                      >
                        <Star className="h-3.5 w-3.5" style={pinnedChild ? { stroke: `url(#${ACCENT_GRAD_ID})`, fill: `url(#${ACCENT_GRAD_ID})` } : undefined} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Une SECTION : intitulé discret (sans icône) + ses pages. Repliable, contrôlée
 * par le parent (accordéon : une seule section ouverte à la fois, la sidebar
 * reste courte). Repliée mais contenant la page active → petit point.
 */
function Group({
  group,
  activeId,
  activeSub,
  open,
  onToggle,
  onSelect,
  onItemContext,
  onItemSplit,
  isPinned,
  onTogglePin,
}: {
  group: SbGroup;
  activeId: string;
  activeSub?: string | null;
  open: boolean;
  onToggle: () => void;
  onSelect: (id: string, sub?: string) => void;
  onItemContext?: (id: string, e: ReactMouseEvent) => void;
  onItemSplit?: (id: string) => void;
  isPinned?: (id: string) => boolean;
  onTogglePin?: (id: string) => void;
}) {
  const containsActive = group.items.some((i) => i.id === activeId);
  const total = group.items.reduce((s, i) => s + sbBadgeTotal(i), 0);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "group/h flex h-8 select-none items-center gap-1.5 rounded-[8px] px-2.5 text-left text-[12px] font-medium transition-colors hover:text-foreground",
          open || containsActive ? "text-foreground/60" : "text-foreground/50",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{group.label}</span>
        {/* Section repliée : total de ses pastilles (sinon le point « page active ici »). */}
        {!open && total > 0 ? (
          <SbCount n={total} />
        ) : (
          !open && containsActive && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/60" aria-hidden />
        )}
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-foreground/30 transition-[transform,color] duration-200 group-hover/h:text-foreground/60",
            open && "rotate-90",
          )}
          strokeWidth={2}
        />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-in-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-0.5 pb-2">
            {group.items.map((item) => (
              <ItemBlock
                key={item.id}
                item={item}
                activeId={activeId}
                activeSub={activeSub}
                onSelect={onSelect}
                onItemContext={onItemContext}
                onItemSplit={onItemSplit}
                isPinned={isPinned}
                onTogglePin={onTogglePin}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Logo carré TTP (fond sombre fixe : le logo est blanc). */
export function SidebarLogo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <div className={cn("shrink-0 overflow-hidden rounded-[8px] bg-[#14181E]", className)}>
      <img src={`${BASE}cover.png`} alt="TTP" className="h-full w-full object-cover" />
    </div>
  );
}

export type SbSpaceOption = { id: string; label: string; hint: string; icon: LucideIcon; active: boolean; onSelect: () => void };

/**
 * En-tête : carte « espace » (logo + nom + sous-titre). Avec `options`, la carte
 * ouvre un petit menu pour changer d'espace (façon sélecteur d'organisation).
 */
export function SidebarBrand({
  title,
  sub,
  options,
  onCollapse,
}: {
  title: string;
  sub: string;
  options?: SbSpaceOption[];
  onCollapse?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const card = "flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border border-border bg-surface p-1.5 pr-2 text-left";
  const inner = (
    <>
      <SidebarLogo />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-tight text-foreground">{title}</span>
        <span className="mt-0.5 block truncate text-[12px] leading-tight text-muted-foreground">{sub}</span>
      </span>
    </>
  );
  return (
    <div className="mb-3 flex items-center gap-1">
      {options ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" className={cn(card, "transition-colors hover:border-foreground/15 data-[state=open]:border-foreground/15")} aria-label="Changer d'espace">
              {inner}
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-foreground/40" strokeWidth={1.75} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="w-[224px] p-1.5" onOpenAutoFocus={(e) => e.preventDefault()}>
            <div className="px-2 pb-1.5 pt-1 text-[12px] text-muted-foreground">Espaces</div>
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  o.onSelect();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left transition-colors hover:bg-rowhover"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] border border-border text-foreground/70">
                  <o.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">{o.label}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{o.hint}</span>
                </span>
                {o.active && <Check className="h-4 w-4 shrink-0 text-foreground" />}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      ) : (
        <div className={card}>{inner}</div>
      )}
      {onCollapse && (
        <button
          type="button"
          onClick={onCollapse}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-foreground/40 transition-colors hover:bg-surface/60 hover:text-foreground dark:hover:bg-rowhover"
          title="Replier le menu"
          aria-label="Replier le menu"
        >
          <PanelLeftClose className="h-4 w-4" strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

export type SbUserAction = { icon: LucideIcon; label: string; onClick: () => void };

/**
 * Pied de sidebar : carte utilisateur (photo + nom + rôle). Un clic ouvre un
 * menu (réglages, thème, déconnexion). `menuAvatar` = avatar affiché dans le
 * menu (peut être éditable, contrairement à celui de la carte).
 */
export function SidebarUser({
  avatar,
  menuAvatar,
  name,
  sub,
  actions,
}: {
  avatar: ReactNode;
  menuAvatar?: ReactNode;
  name: string;
  sub: string;
  actions: SbUserAction[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn("flex w-full items-center gap-2.5 rounded-[10px] p-1.5 pr-2 text-left transition-colors", HOVER_BG, "data-[state=open]:bg-surface dark:data-[state=open]:bg-rowhover")}
        >
          {avatar}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium leading-tight text-foreground">{name}</span>
            <span className="mt-0.5 block truncate text-[12px] leading-tight text-muted-foreground">{sub}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-foreground/40" strokeWidth={1.75} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" sideOffset={10} className="w-[232px] p-1.5" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex items-center gap-2.5 px-2 pb-2.5 pt-1.5">
          {menuAvatar ?? avatar}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium leading-tight text-foreground">{name}</span>
            <span className="mt-0.5 block truncate text-[12px] leading-tight text-muted-foreground">{sub}</span>
          </span>
        </div>
        <div className="-mx-1.5 mb-1 h-px bg-border" />
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => {
              setOpen(false);
              a.onClick();
            }}
            className="flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left text-[13px] text-foreground/80 transition-colors hover:bg-rowhover hover:text-foreground"
          >
            <a.icon className="h-4 w-4 shrink-0 text-foreground/50" strokeWidth={1.75} />
            {a.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Sidebar desktop : en-tête (carte d'espace), sections de nav repliables (et
 * sous-pages repliables par item), puis pied de page (carte utilisateur).
 * Générique : on lui passe les groupes + le contenu header/footer.
 */
export function SidebarNav({
  groups,
  activeId,
  activeSub,
  onSelect,
  onItemContext,
  onItemSplit,
  isPinned,
  onTogglePin,
  header,
  footer,
}: {
  groups: SbGroup[];
  activeId: string;
  activeSub?: string | null;
  onSelect: (id: string, sub?: string) => void;
  onItemContext?: (id: string, e: ReactMouseEvent) => void;
  onItemSplit?: (id: string) => void;
  isPinned?: (id: string) => boolean;
  onTogglePin?: (id: string) => void;
  header?: ReactNode;
  footer?: ReactNode;
}) {
  // Accordéon : une seule section ouverte à la fois. Celle de la page active s'ouvre
  // automatiquement (navigation, recherche) ; un clic sur une autre section bascule.
  const activeGroupId = groups.find((g) => g.items.some((i) => i.id === activeId))?.id ?? null;
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroupId ?? groups[0]?.id ?? null);
  useEffect(() => {
    if (activeGroupId) setOpenGroup(activeGroupId);
  }, [activeGroupId]);

  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col p-3">
      <AccentGradientDef />
      {header}
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {groups.map((g) => (
          <Group
            key={g.id}
            group={g}
            activeId={activeId}
            activeSub={activeSub}
            open={openGroup === g.id}
            onToggle={() => setOpenGroup((cur) => (cur === g.id ? null : g.id))}
            onSelect={onSelect}
            onItemContext={onItemContext}
            onItemSplit={onItemSplit}
            isPinned={isPinned}
            onTogglePin={onTogglePin}
          />
        ))}
      </nav>
      {footer && <div className="mt-auto flex flex-col gap-1 pt-2">{footer}</div>}
    </aside>
  );
}
