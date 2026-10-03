import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Onglets animés réutilisables (agence + créateur). Porté depuis un composant
 * 21st.dev : on GARDE sa logique `useTabs` (a11y clavier ← → Home/End, activation
 * auto/manuelle) et l'indicateur GLISSANT (spring), mais habillé avec NOS tokens
 * (panel/surface/primary) au lieu des couleurs codées en dur. Barre seule par
 * défaut ; passe `renderPanel` pour afficher un panneau animé sous les onglets.
 */

const INDICATOR = { type: "spring", stiffness: 620, damping: 42, mass: 0.35 } as const;
const PANEL = { type: "spring", stiffness: 460, damping: 38, mass: 0.8 } as const;
const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

export type TabItem = {
  value: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** Compteur affiché après le libellé (ex. nombre d'éléments filtrés). */
  count?: number;
  /** Pastille de couleur avant le libellé (classe Tailwind, ex. "bg-emerald-500"). */
  dot?: string;
  /** Masque le libellé (l'icône reste) : toujours, ou seulement sur mobile. */
  hideLabel?: "always" | "mobile";
};
export type TabsActivation = "automatic" | "manual";

type UseTabsOptions = {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  activation?: TabsActivation;
};

export function useTabs({ items, value: controlled, defaultValue, onValueChange, activation = "automatic" }: UseTabsOptions) {
  const base = useId();
  const nodes = useRef(new Map<string, HTMLButtonElement>());
  const direction = useRef(1);
  const [internal, setInternal] = useState(() => defaultValue ?? items.find((i) => !i.disabled)?.value ?? items[0]?.value ?? "");
  const value = controlled ?? internal;
  const emit = useRef(onValueChange);
  emit.current = onValueChange;

  const select = useCallback(
    (next: string) => {
      if (next === value) return;
      const from = items.findIndex((i) => i.value === value);
      const to = items.findIndex((i) => i.value === next);
      direction.current = to < from ? -1 : 1;
      if (controlled === undefined) setInternal(next);
      emit.current?.(next);
    },
    [controlled, items, value],
  );

  const focusAt = useCallback((i: number) => { const item = items[i]; if (item) nodes.current.get(item.value)?.focus(); }, [items]);
  const nextEnabled = useCallback(
    (from: number, dir: number) => {
      const n = items.length;
      let i = from < 0 ? 0 : from;
      for (let k = 0; k < n; k += 1) { i = (i + dir + n) % n; if (!items[i].disabled) return i; }
      return from;
    },
    [items],
  );
  const endStop = useCallback(
    (dir: number) => {
      const n = items.length;
      if (dir > 0) { for (let i = 0; i < n; i += 1) if (!items[i].disabled) return i; }
      else { for (let i = n - 1; i >= 0; i -= 1) if (!items[i].disabled) return i; }
      return 0;
    },
    [items],
  );

  const getTabProps = useCallback(
    (item: TabItem, index: number) => ({
      id: `${base}-tab-${item.value}`,
      role: "tab" as const,
      type: "button" as const,
      "aria-selected": item.value === value,
      "aria-controls": `${base}-panel-${item.value}`,
      "aria-disabled": item.disabled ? (true as const) : undefined,
      tabIndex: item.value === value ? 0 : -1,
      ref: (node: HTMLButtonElement | null) => { if (node) nodes.current.set(item.value, node); else nodes.current.delete(item.value); },
      onClick: () => { if (!item.disabled) select(item.value); },
      onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          const to = nextEnabled(index, e.key === "ArrowRight" ? 1 : -1);
          focusAt(to);
          if (activation === "automatic") select(items[to].value);
        } else if (e.key === "Home" || e.key === "End") {
          e.preventDefault();
          const to = endStop(e.key === "Home" ? 1 : -1);
          focusAt(to);
          if (activation === "automatic") select(items[to].value);
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (!item.disabled) select(item.value);
        }
      },
    }),
    [activation, base, endStop, focusAt, items, nextEnabled, select, value],
  );

  const getPanelProps = useCallback(
    (panelValue: string) => ({ id: `${base}-panel-${panelValue}`, role: "tabpanel" as const, "aria-labelledby": `${base}-tab-${panelValue}`, tabIndex: 0 }),
    [base],
  );

  return { value, select, direction: direction.current, tabListProps: { role: "tablist" as const, "aria-orientation": "horizontal" as const }, getTabProps, getPanelProps };
}

export type TabsProps = {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  activation?: TabsActivation;
  renderPanel?: (value: string) => ReactNode;
  label?: string;
  className?: string;
  panelClassName?: string;
  /** "md" (défaut) : barre de page. "sm" : version compacte (dans une carte, un graphique…). */
  size?: "sm" | "md";
  /** Occupe toute la largeur, onglets répartis à parts égales. */
  fullWidth?: boolean;
  /** Passe à la ligne à toutes les tailles (filtres à nombreuses options) au lieu de défiler. */
  wrap?: boolean;
};

export function Tabs({ items, value, defaultValue, onValueChange, activation = "automatic", renderPanel, label = "Onglets", className = "", panelClassName = "", size = "md", fullWidth = false, wrap = false }: TabsProps) {
  const sm = size === "sm";
  const tabs = useTabs({ items, value, defaultValue, onValueChange, activation });
  const reduced = useReducedMotion();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [ind, setInd] = useState({ x: 0, y: 0, width: 0, height: 0, ready: false });
  const selectedIndex = items.findIndex((i) => i.value === tabs.value);

  useIso(() => {
    const node = tabRefs.current[selectedIndex];
    if (!node) return;
    // x/y + largeur/hauteur : sur mobile la barre peut passer à la ligne (flex-wrap),
    // l'indicateur suit donc aussi la position verticale de l'onglet actif.
    const read = () => setInd((prev) => (prev.x === node.offsetLeft && prev.y === node.offsetTop && prev.width === node.offsetWidth && prev.height === node.offsetHeight && prev.ready ? prev : { x: node.offsetLeft, y: node.offsetTop, width: node.offsetWidth, height: node.offsetHeight, ready: true }));
    read();
    const row = rowRef.current;
    if (!row) return;
    const observer = new ResizeObserver(read);
    observer.observe(row);
    return () => observer.disconnect();
  }, [selectedIndex, items]);

  return (
    <div className={className}>
      <div
        {...tabs.tabListProps}
        ref={rowRef}
        aria-label={label}
        className={cn(
          "relative flex max-w-full flex-wrap gap-0.5 overflow-x-auto border border-border bg-surface [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          !wrap && "sm:flex-nowrap",
          sm ? "rounded-lg p-0.5" : "rounded-xl p-1",
          fullWidth ? "w-full" : "w-fit",
        )}
      >
        {/* Indicateur glissant (fond de l'onglet actif) : animé via `animate` (un simple
            `style` ne déclenche pas le ressort). Masqué si aucune valeur ne correspond. */}
        <motion.span
          aria-hidden
          className={cn("pointer-events-none absolute bg-muted", sm ? "rounded-md" : "rounded-lg")}
          initial={false}
          animate={{ left: ind.x, top: ind.y, width: ind.width, height: ind.height, opacity: ind.ready && selectedIndex >= 0 ? 1 : 0 }}
          transition={reduced || !ind.ready ? { duration: 0 } : INDICATOR}
        />
        {items.map((item, index) => {
          const selected = item.value === tabs.value;
          return (
            <button
              key={item.value}
              {...tabs.getTabProps(item, index)}
              ref={(node) => { tabRefs.current[index] = node; }}
              aria-label={item.hideLabel ? item.label : undefined}
              title={item.hideLabel === "always" ? item.label : undefined}
              className={cn(
                "relative z-10 flex shrink-0 items-center justify-center whitespace-nowrap font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-foreground/20 [&_svg]:text-current",
                sm ? "h-7 gap-1.5 rounded-md px-2.5 text-[12px]" : "h-8 gap-2 rounded-lg px-3 text-[13px]",
                fullWidth && "flex-1",
                item.disabled ? "cursor-default text-faint" : selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.dot && <span className={cn("size-1.5 shrink-0 rounded-full", item.dot)} />}
              {item.icon}
              {item.hideLabel !== "always" && (
                <span className={cn(item.hideLabel === "mobile" && "max-sm:sr-only")}>{item.label}</span>
              )}
              {item.count !== undefined && (
                <span className={cn("tabular-nums", selected ? "text-muted-foreground" : "text-faint")}>{item.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {renderPanel ? (
        <motion.div
          key={tabs.value}
          {...tabs.getPanelProps(tabs.value)}
          initial={reduced ? false : { opacity: 0, x: tabs.direction * 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={reduced ? { duration: 0 } : PANEL}
          className={cn("outline-none", panelClassName)}
        >
          {renderPanel(tabs.value)}
        </motion.div>
      ) : null}
    </div>
  );
}

export default Tabs;
