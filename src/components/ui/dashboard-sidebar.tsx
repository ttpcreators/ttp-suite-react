import { useEffect, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { Check, ChevronRight, ChevronsUpDown, Columns2, PanelLeftClose, Star, type LucideIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { VIEW_HINTS } from "@/lib/viewHints";
import { useLang, useT } from "@/lib/i18n";

/** À quoi sert la page (bulle au survol du menu). */
const hintOf = (id: string) => (VIEW_HINTS as Record<string, string | undefined>)[id];

const BASE = import.meta.env.BASE_URL;

/** Sous-page ; `pinnable` = aussi une vraie page, à mettre en favoris (étoile, clic droit). */
export type SbChild = { id: string; label: string; pinnable?: boolean; badge?: number };
/** `badge` = nombre de notifications de la page (pastille ; 0 ou absent = rien). */
/** `noPin` : page fixe de Favoris (pas d'étoile). */
export type SbItem = { id: string; label: string; icon: LucideIcon; badge?: number; badgeTone?: "late"; noPin?: boolean; children?: SbChild[] };
/** `fixed` = section toujours dépliée (Favoris), hors accordéon. */
export type SbGroup = { id: string; label: string; icon: LucideIcon; fixed?: boolean; items: SbItem[] };

/*
 * Langage visuel (TTP Suite 2.0) : sidebar posée à même le fond. Intitulés de section
 * discrets, icônes à la couleur d'accent, élément actif sur une pastille pleine
 * d'accent (texte blanc) qui GLISSE d'une ligne à l'autre au clic. Pastilles de nombre
 * grises, rouges seulement pour l'argent en retard. Partagé agence et créateurs.
 */
const ACTIVE_BG = "bg-primary";
const HOVER_BG = "hover:bg-rowhover";
/** Ressort de la pastille active (glisse, sans rebond visible). */
const PILL_SPRING = { type: "spring", stiffness: 520, damping: 44, mass: 0.7 } as const;

/** Ligne de menu (pleine largeur). `pill` : le fond actif est la pastille animée (ActivePill). */
export const sbItemCls = (active: boolean, pill = false) =>
  cn(
    "relative isolate flex w-full select-none items-center gap-2.5 rounded-[10px] px-3 py-[7px] text-left text-[14px] transition-[color,background-color,transform] duration-[var(--dur-press)] active:scale-[0.98] focus-visible:outline-offset-[-2px] motion-reduce:active:scale-100",
    active ? cn(!pill && ACTIVE_BG, "font-medium text-primary-foreground") : cn("text-foreground/85 hover:text-foreground", HOVER_BG),
  );
/** Icône d'une ligne de menu. */
export const sbIconCls = (active: boolean) =>
  cn("h-[18px] w-[18px] shrink-0 transition-colors", active ? "text-primary-foreground" : "text-primary");
/** Bouton carré du rail replié (icône seule). */
export const sbRailCls = (active: boolean) =>
  cn(
    "grid h-10 w-10 shrink-0 place-items-center rounded-[12px] transition-[color,background-color,transform] duration-[var(--dur-press)] active:scale-95",
    active ? cn(ACTIVE_BG, "text-primary-foreground") : cn("text-primary", HOVER_BG),
  );
const rowKey = (groupId: string, itemId: string) => `r:${groupId}/${itemId}`;
const childKey = (itemId: string, childId: string) => `c:${itemId}/${childId}`;
/**
 * La ligne qui porte la pastille active, UNE seule : la sous-page choisie si elle est
 * affichée, sinon la première ligne de la page (Favoris passe avant sa section : une
 * page ajoutée aux favoris s'allume là-haut, pas deux fois).
 */
function pillKeyOf(groups: SbGroup[], activeId: string, activeSub?: string | null): string | null {
  if (activeSub) {
    for (const g of groups) for (const i of g.items) if (i.id === activeId && (i.children ?? []).some((c) => c.id === activeSub)) return childKey(i.id, activeSub);
  }
  for (const g of groups) for (const i of g.items) if (i.id === activeId) return rowKey(g.id, i.id);
  return null;
}
/** Pastille d'accent de la ligne active : un seul exemplaire qui glisse vers la ligne cliquée. */
function ActivePill() {
  const reduce = useReducedMotion();
  return (
    <motion.span
      layoutId="sb-active-pill"
      aria-hidden
      className={cn("absolute inset-0 -z-10 rounded-[10px]", ACTIVE_BG)}
      transition={reduce ? { duration: 0 } : PILL_SPRING}
    />
  );
}
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
export function SbCount({ n, className, tone, onActive }: { n: number; className?: string; tone?: "late"; onActive?: boolean }) {
  return (
    <span
      className={cn(
        "grid h-[20px] min-w-[22px] shrink-0 place-items-center rounded-full px-1.5 text-[11.5px] font-semibold tabular-nums",
        onActive ? "bg-primary-foreground/25 text-primary-foreground" : tone === "late" ? "bg-late-soft text-late" : "bg-field text-foreground/70",
        className,
      )}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}
/** Total des pastilles d'un item (lui-même + ses sous-pages). */
export const sbBadgeTotal = (item: SbItem) =>
  (item.badge ?? 0) + (item.children ?? []).reduce((s, c) => s + (c.badge ?? 0), 0);
/** Petit bouton d'action révélé dans une ligne (chevron, vue partagée, étoile). */
const ghostBtn = "grid h-6 w-6 place-items-center rounded-md text-foreground/40 transition-colors hover:bg-foreground/[0.06] hover:text-foreground";
/** Les mêmes, posés sur la pastille d'accent de la ligne active. */
const ON_PILL_BTN = "text-primary-foreground/70 hover:bg-primary-foreground/15 hover:text-primary-foreground";

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
  /** Page en favoris → étoile pleine, toujours visible. */
  pinned?: boolean;
  /** Épingle/détache au survol (étoile). Absent = pas d'étoile. */
  onTogglePin?: () => void;
}) {
  // Réserve la place à droite : chevron/split (right-1.5) + étoile épingle (right-8).
  const t = useT();
  // Les aides au survol décrivent les pages AGENCE (en français) : pas affichées en anglais.
  const hint = useLang() === "en" ? undefined : hintOf(item.id);
  const pr = onTogglePin
    ? (hasChildren ? "pr-[3.75rem]" : "pr-9")
    : (hasChildren ? "pr-9" : "pr-2.5");
  return (
    <div className="group relative flex items-center">
      <button type="button" onClick={onClick} onContextMenu={onContext} title={hint} aria-current={active ? "page" : undefined} className={cn(sbItemCls(active, true), pr)}>
        {active && <ActivePill />}
        <item.icon className={sbIconCls(active)} strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {/* Pastille : décalée pour ne pas passer sous le bouton « à côté » ni l'étoile. */}
        {!!item.badge && (
          <SbCount n={item.badge} tone={item.badgeTone} onActive={active} className={cn(!hasChildren && (onSplit || onTogglePin) && "mr-6")} />
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
          aria-label={open ? t("Replier") : t("Déplier")}
          aria-expanded={open}
          className={cn("absolute right-1.5", ghostBtn, active && ON_PILL_BTN)}
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
            title={t("Ouvrir à côté (2 pages côte à côte)")}
            aria-label={t("Ouvrir à côté")}
            className={cn("absolute right-1.5 opacity-0 focus-visible:opacity-100 group-hover:opacity-100", ghostBtn, active && ON_PILL_BTN)}
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
          title={pinned ? t("Retirer des favoris") : t("Ajouter aux favoris")}
          aria-label={pinned ? t("Retirer des favoris") : t("Ajouter aux favoris")}
          aria-pressed={pinned}
          className={cn(
            "absolute right-8 focus-visible:opacity-100",
            ghostBtn,
            active && ON_PILL_BTN,
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
  groupId,
  pillKey,
  onSelect,
  onItemContext,
  onItemSplit,
  isPinned,
  onTogglePin,
}: {
  item: SbItem;
  groupId: string;
  /** Ligne qui porte la pastille active (une seule dans tout le menu, voir pillKeyOf). */
  pillKey: string | null;
  onSelect: (id: string, sub?: string) => void;
  onItemContext?: (id: string, e: ReactMouseEvent) => void;
  onItemSplit?: (id: string) => void;
  isPinned?: (id: string) => boolean;
  onTogglePin?: (id: string) => void;
}) {
  const hasChildren = !!item.children && item.children.length > 0;
  const rowActive = pillKey === rowKey(groupId, item.id);
  const childActive = hasChildren && item.children!.some((c) => pillKey === childKey(item.id, c.id));
  const parentActive = rowActive || childActive;
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
  const t = useT();
  return (
    <div className="flex flex-col">
      <Row
        item={shown}
        active={rowActive}
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
        onTogglePin={onTogglePin && !item.noPin ? () => onTogglePin(item.id) : undefined}
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
                const on = pillKey === childKey(item.id, c.id);
                const pin = c.pinnable && onTogglePin ? () => onTogglePin(c.id) : null;
                const pinnedChild = !!(c.pinnable && isPinned?.(c.id));
                return (
                  <div key={c.id} className="group relative flex items-center">
                    <button
                      type="button"
                      onClick={() => onSelect(item.id, c.id)}
                      onContextMenu={c.pinnable && onItemContext ? (e) => onItemContext(c.id, e) : undefined}
                      aria-current={on ? "page" : undefined}
                      className={cn(sbItemCls(on, true), "py-[5px] text-[13.5px]", pin && "pr-9")}
                    >
                      {on && <ActivePill />}
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      {!!c.badge && <SbCount n={c.badge} onActive={on} />}
                    </button>
                    {pin && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          pin();
                        }}
                        title={pinnedChild ? t("Retirer des favoris") : t("Ajouter aux favoris")}
                        aria-label={pinnedChild ? t("Retirer des favoris") : t("Ajouter aux favoris")}
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
  pillKey,
  open,
  onToggle,
  onSelect,
  onItemContext,
  onItemSplit,
  isPinned,
  onTogglePin,
}: {
  group: SbGroup;
  pillKey: string | null;
  open: boolean;
  onToggle: () => void;
  onSelect: (id: string, sub?: string) => void;
  onItemContext?: (id: string, e: ReactMouseEvent) => void;
  onItemSplit?: (id: string) => void;
  isPinned?: (id: string) => boolean;
  onTogglePin?: (id: string) => void;
}) {
  const containsActive = group.items.some((i) => pillKey === rowKey(group.id, i.id) || (i.children ?? []).some((c) => pillKey === childKey(i.id, c.id)));
  const total = group.items.reduce((s, i) => s + sbBadgeTotal(i), 0);
  const items = (
    <div className="flex flex-col gap-0.5 pb-2">
      {group.items.map((item) => (
        <ItemBlock
          key={item.id}
          item={item}
          groupId={group.id}
          pillKey={pillKey}
          onSelect={onSelect}
          onItemContext={onItemContext}
          onItemSplit={onItemSplit}
          isPinned={isPinned}
          onTogglePin={onTogglePin}
        />
      ))}
    </div>
  );
  // Section fixe (Favoris) : intitulé simple, toujours dépliée.
  if (group.fixed) {
    return (
      <div className="flex flex-col">
        <div className="flex h-8 select-none items-center px-2.5 text-[12px] font-semibold text-foreground/50">{group.label}</div>
        {items}
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "group/h flex h-8 select-none items-center gap-1.5 rounded-[8px] px-2.5 text-left text-[12px] font-semibold transition-colors hover:text-foreground",
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
        <div className="min-h-0 overflow-hidden">{items}</div>
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
  const t = useT();
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
            <button type="button" className={cn(card, "transition-colors hover:border-foreground/15 data-[state=open]:border-foreground/15")} aria-label={t("Changer d'espace")}>
              {inner}
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-foreground/40" strokeWidth={1.75} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="w-[224px] p-1.5" onOpenAutoFocus={(e) => e.preventDefault()}>
            <div className="px-2 pb-1.5 pt-1 text-[12px] text-muted-foreground">{t("Espaces")}</div>
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
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border text-foreground/70">
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
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-foreground/40 transition-colors hover:bg-surface/60 hover:text-foreground dark:hover:bg-rowhover"
          title={t("Replier le menu")}
          aria-label={t("Replier le menu")}
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
  const pillKey = pillKeyOf(groups, activeId, activeSub);
  const activeGroupId =
    groups.find((g) => !g.fixed && g.items.some((i) => pillKey === rowKey(g.id, i.id) || (i.children ?? []).some((c) => pillKey === childKey(i.id, c.id))))?.id ?? null;
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroupId);
  useEffect(() => {
    if (activeGroupId) setOpenGroup(activeGroupId);
  }, [activeGroupId]);

  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col p-3">
      <AccentGradientDef />
      {header}
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <LayoutGroup id="sidebar-nav">
        {groups.map((g) => (
          <Group
            key={g.id}
            group={g}
            pillKey={pillKey}
            open={openGroup === g.id}
            onToggle={() => setOpenGroup((cur) => (cur === g.id ? null : g.id))}
            onSelect={onSelect}
            onItemContext={onItemContext}
            onItemSplit={onItemSplit}
            isPinned={isPinned}
            onTogglePin={onTogglePin}
          />
        ))}
        </LayoutGroup>
      </nav>
      {footer && <div className="mt-auto flex flex-col gap-1 pt-2">{footer}</div>}
    </aside>
  );
}
