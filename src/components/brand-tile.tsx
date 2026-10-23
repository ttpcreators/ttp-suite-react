import { MailAvatar } from "@/components/mail-avatar";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { brandInitials } from "@/lib/mailAvatar";
import { cn } from "@/lib/utils";

/**
 * Tuile « marque + photo du créateur » des listes maître-détail (Collabs : Gifting,
 * Négociations), même rendu que la liste des collabs : logo de la marque (sinon monogramme
 * encre) et petite photo du créateur en bas à droite.
 */
export function BrandTile({ brand, email, creator, photoUrl, size = "sm", onAccent = false }: {
  brand: string; email?: string | null; creator?: string | null; photoUrl?: string | null;
  size?: "sm" | "lg"; onAccent?: boolean;
}) {
  return (
    <span className="relative shrink-0">
      <MailAvatar
        name={brand}
        email={email ?? null}
        brand={brand}
        className={size === "lg" ? "h-14 w-14 rounded-[16px]" : "h-9 w-9 rounded-[11px]"}
        fallback={brandInitials(brand)}
        fallbackClassName={cn(
          "font-semibold tracking-[-0.02em]",
          size === "lg" ? "text-[20px]" : "text-[12.5px]",
          onAccent ? "bg-primary-foreground text-primary" : "bg-foreground text-background",
        )}
      />
      {creator && (
        <CreatorAvatar
          name={creator}
          photoUrl={photoUrl ?? null}
          className={cn(
            "absolute rounded-full ring-2",
            size === "lg" ? "-bottom-1.5 -right-1.5 h-7 w-7 text-[10px]" : "-bottom-1.5 -right-1.5 h-[18px] w-[18px] text-[8px]",
            onAccent ? "ring-primary" : "ring-surface",
          )}
        />
      )}
    </span>
  );
}

/** Liste maître (colonne de gauche) : sections titrées, une ligne par objet. */
export function MasterList<T extends { id: string }>({ groups, selectedId, onPick, row }: {
  groups: { key: string; label: string; items: T[] }[];
  selectedId?: string;
  onPick: (id: string) => void;
  row: (item: T, on: boolean) => { tile: React.ReactNode; title: string; sub?: string; right?: string };
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[22px] bg-surface p-3 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto">
      {groups.filter((g) => g.items.length).map((g) => (
        <section key={g.key}>
          <h3 className="flex items-center justify-between px-2 pb-1 pt-1.5 text-[12px] font-semibold text-muted-foreground">
            {g.label} <span className="tabular-nums">{g.items.length}</span>
          </h3>
          <div className="flex flex-col gap-0.5">
            {g.items.map((it) => {
              const on = selectedId === it.id;
              const r = row(it, on);
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => onPick(it.id)}
                  aria-current={on ? "true" : undefined}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-3 rounded-[14px] px-2.5 py-2 text-left transition-[background-color,transform] duration-[var(--dur-press)] active:scale-[0.99]",
                    on ? "bg-primary text-primary-foreground" : "hover:bg-rowhover",
                  )}
                >
                  {r.tile}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold" title={r.title}>{r.title}</span>
                    {r.sub && <span className={cn("block truncate text-[12px]", on ? "text-primary-foreground/80" : "text-muted-foreground")}>{r.sub}</span>}
                  </span>
                  {r.right && <span className={cn("shrink-0 text-[12px] font-semibold tabular-nums", on ? "text-primary-foreground/90" : "text-muted-foreground")}>{r.right}</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Lignes « libellé · valeur » d'une fiche détail. */
export function DetailRows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-border rounded-[16px] bg-panel">
      {rows.map(([k, v]) => (
        <div key={k} className="flex min-h-11 items-center justify-between gap-4 px-4 py-2.5">
          <dt className="shrink-0 text-[13px] text-muted-foreground">{k}</dt>
          <dd className="min-w-0 text-right text-[14px] font-medium text-foreground [overflow-wrap:anywhere]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
