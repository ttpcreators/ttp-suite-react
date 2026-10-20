import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Building2, LogOut, Moon, PanelLeftOpen, Settings, Sparkles, Star, Sun } from "@/components/icons";
import { NAV, findPinnable, type ViewId, FAVORIS_BASE, FAVORIS_ID, withFavorites } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { TtpSearch, TtpTrash } from "@/components/icons/ttp-icons";
import { useTheme } from "@/lib/theme";
import { AgencyAvatar } from "@/components/ui/agency-avatar";
import { useMyName } from "@/lib/useMyName";
import {
  SidebarBrand,
  SidebarLogo,
  SidebarNav,
  SidebarUser,
  sbIconCls,
  sbItemCls,
  sbRailCls,
  sbBadgeTotal,
  type SbGroup,
  type SbItem,
} from "@/components/ui/dashboard-sidebar";

// Pastilles en rouge doux : uniquement l'argent en retard (factures, relances).
const LATE_BADGE = new Set<string>(["facturation", "relances"]);

const NAV_GROUPS: SbGroup[] = NAV.map((f) => ({
  id: f.id,
  label: f.label,
  icon: f.icon,
  fixed: f.fixed,
  items: f.items.map((i) => ({ id: i.id, label: i.label, icon: i.icon, children: i.children, badgeTone: LATE_BADGE.has(i.id) ? "late" : undefined, noPin: FAVORIS_BASE.has(i.id) })),
}));

export function Sidebar({
  active,
  activeSub,
  onSelect,
  onLogout,
  space,
  onSpaceChange,
  onItemContext,
  onItemSplit,
  pinned,
  onTogglePin,
  hidden,
  userId,
  badges,
  search,
  tools,
}: {
  active: ViewId;
  activeSub?: string | null;
  onSelect: (id: ViewId, sub?: string) => void;
  onLogout: () => void;
  space: "agency" | "portal";
  onSpaceChange: (s: "agency" | "portal") => void;
  onItemContext?: (id: ViewId, e: ReactMouseEvent) => void;
  onItemSplit?: (id: ViewId) => void;
  /** Pages mises en favoris (étoile) → ajoutées à la section Favoris. */
  pinned?: ViewId[];
  /** Épingle/détache une page (étoile au survol). */
  onTogglePin?: (id: ViewId) => void;
  /** Pages masquées (ex. membre non-fondateur : Finance & Accès). */
  hidden?: ViewId[];
  /** Champ de recherche (sous la carte d'espace, comme la maquette). */
  search?: ReactNode;
  /** Boutons du pied, à droite de la carte utilisateur (notifications, thème). */
  tools?: ReactNode;
  /** Compte connecté (photo de profil de la carte utilisateur). */
  userId?: string;
  /** Notifications par page (id du menu) → pastilles. */
  badges?: Record<string, number>;
}) {
  const { dark, toggle: toggleTheme } = useTheme();
  // Nom de la personne connectée (chacun le sien), à la place de « Marc & Gianni ».
  const myName = useMyName(userId);
  const isPinned = (id: string) => (pinned ?? []).includes(id as ViewId);
  const isHidden = (id: string) => (hidden ?? []).includes(id as ViewId);
  // Pages mises en favoris (étoile, clic droit) : ajoutées au bout de la section Favoris,
  // sans sous-pages (lien direct). Une seule section, jamais de doublon.
  const GROUPS = useMemo<SbGroup[]>(() => {
    // Familles filtrées (on retire les pages masquées, puis les familles vides).
    const b = badges ?? {};
    const base = NAV_GROUPS
      .map((g) => ({
        ...g,
        items: g.items
          .filter((i) => !isHidden(i.id))
          .map((i) => ({ ...i, badge: b[i.id], children: i.children?.map((c) => ({ ...c, badge: b[c.id] })) })),
      }))
      .filter((g) => g.items.length > 0);
    const items = (pinned ?? [])
      .filter((id) => !isHidden(id))
      .map((id) => findPinnable(id))
      .filter((i): i is NonNullable<typeof i> => !!i)
      .map((i) => ({ id: i.id, label: i.label, icon: i.icon, badge: b[i.id], badgeTone: LATE_BADGE.has(i.id) ? ("late" as const) : undefined }));
    return withFavorites<SbItem, SbGroup>(base, items, (extra) => ({ id: FAVORIS_ID, label: "Favoris", icon: Star, fixed: true, items: extra }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned, hidden, badges]);
  // Sidebar repliable en rail d'icônes (mémorisé).
  // try/catch : localStorage lève une exception quand le stockage est bloqué.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("ttp:sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("ttp:sidebar-collapsed", collapsed ? "1" : "0");
    } catch {
      /* stockage indisponible */
    }
  }, [collapsed]);

  // ── Rail replié : logo + icônes seules (tooltip au survol) + pied ──
  if (collapsed) {
    return (
      <aside className="flex h-full w-[68px] shrink-0 flex-col items-center glass rounded-[22px] bg-surface p-2">
        <SidebarLogo className="mt-1 h-9 w-9" />
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className={cn(sbRailCls(false), "mt-2 h-8 w-8")}
          title="Déplier le menu"
          aria-label="Déplier le menu"
        >
          <PanelLeftOpen className="h-4 w-4" strokeWidth={1.75} />
        </button>
        {search && (
          <button type="button" onClick={() => setCollapsed(false)} className={cn(sbRailCls(false), "mt-1 h-8 w-8")} title="Rechercher" aria-label="Rechercher">
            <TtpSearch className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
        <nav className="mt-3 flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {GROUPS.map((g, gi) => (
            <div key={g.id} className="flex w-full flex-col items-center gap-1">
              {gi > 0 && <div className="my-1 h-px w-6 bg-foreground/10" />}
              {g.items.map((it) => {
                const n = sbBadgeTotal(it);
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => onSelect(it.id as ViewId)}
                    onContextMenu={onItemContext ? (e) => onItemContext(it.id as ViewId, e) : undefined}
                    title={n ? `${it.label} · ${n}` : it.label}
                    className={cn("relative", sbRailCls(active === it.id))}
                  >
                    <it.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                    {n > 0 && (
                      <span aria-hidden className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-foreground px-1 text-[9.5px] font-semibold tabular-nums text-background">
                        {n > 99 ? "99+" : n}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="mt-auto flex w-full flex-col items-center gap-1 pt-2">
          <button type="button" onClick={() => onSelect("corbeille")} title="Corbeille" className={sbRailCls(active === "corbeille")}>
            <TtpTrash className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
          <button type="button" onClick={onLogout} title="Se déconnecter" className={sbRailCls(false)}>
            <LogOut className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
        </div>
      </aside>
    );
  }

  const header = (
    <>
    <SidebarBrand
      title="TTP Suite"
      sub={space === "agency" ? "Espace agence" : "Espace créateurs"}
      onCollapse={() => setCollapsed(true)}
      options={[
        { id: "agency", label: "Agence", hint: "Gestion de l'agence", icon: Building2, active: space === "agency", onSelect: () => onSpaceChange("agency") },
        { id: "portal", label: "Créateurs", hint: "Espaces des créateurs", icon: Sparkles, active: space === "portal", onSelect: () => onSpaceChange("portal") },
      ]}
    />
    {search && <div className="mb-3">{search}</div>}
    </>
  );

  const footer = (
    <>
      <button type="button" onClick={() => onSelect("corbeille")} className={cn("group", sbItemCls(active === "corbeille"))}>
        <TtpTrash className={sbIconCls(active === "corbeille")} strokeWidth={1.75} />
        Corbeille
      </button>
      <div className="flex items-center gap-1 border-t border-border pt-2">
        <div className="min-w-0 flex-1">
          <SidebarUser
            avatar={<AgencyAvatar userId={userId} readOnly className="h-8 w-8" rounded="rounded-full" />}
            menuAvatar={<AgencyAvatar userId={userId} className="h-8 w-8" rounded="rounded-full" />}
            name={myName || "Marc & Gianni"}
            sub="Direction · TTP"
            actions={[
              { icon: Settings, label: "Paramètres", onClick: () => onSelect("parametres") },
              { icon: dark ? Sun : Moon, label: dark ? "Mode clair" : "Mode sombre", onClick: toggleTheme },
              { icon: LogOut, label: "Se déconnecter", onClick: onLogout },
            ]}
          />
        </div>
        {tools}
      </div>
    </>
  );

  return (
    <SidebarNav
      groups={GROUPS}
      activeId={active}
      activeSub={activeSub}
      onSelect={(id, sub) => onSelect(id as ViewId, sub)}
      onItemContext={onItemContext ? (id, e) => onItemContext(id as ViewId, e) : undefined}
      onItemSplit={onItemSplit ? (id) => onItemSplit(id as ViewId) : undefined}
      isPinned={isPinned}
      onTogglePin={onTogglePin ? (id) => onTogglePin(id as ViewId) : undefined}
      header={header}
      footer={footer}
    />
  );
}
