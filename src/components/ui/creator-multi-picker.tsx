import { useState } from "react";
import { Building2, Check } from "@/components/icons";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, titleCase } from "@/lib/utils";
import { avatarStack, creatorsLabel, normalizeCreators, toggleCreator } from "@/lib/todoCreators";

export type PickerCreator = { name: string; photo_url?: string | null };

/**
 * Choix de PLUSIEURS créateurs (cases à cocher dans un menu), même allure que les
 * sélecteurs de l'app. Libellé : « Sélectionner… », un nom, ou « Justine + 2 ».
 * `agencyLabel` ajoute en tête une option qui vide la liste (tâche interne).
 */
export function CreatorMultiPicker({
  value,
  onChange,
  creators,
  agencyLabel,
  placeholder = "Sélectionner…",
  ariaLabel,
  size = "md",
  pill,
  className,
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
  creators: readonly PickerCreator[];
  agencyLabel?: string;
  placeholder?: string;
  ariaLabel?: string;
  /** md : 42 px (formulaires) ; sm : 36 px (panneaux). */
  size?: "md" | "sm";
  pill?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const picked = normalizeCreators(value);
  const pickedKeys = new Set(picked.map((n) => n.toLocaleLowerCase("fr")));
  const photoOf = new Map(creators.map((c) => [c.name, c.photo_url ?? null]));
  const label = picked.length ? creatorsLabel(picked) : agencyLabel ?? placeholder;
  const row = "flex w-full items-center gap-2.5 rounded-[14px] px-2.5 py-2 text-left text-[13px] outline-none transition-colors hover:bg-rowhover focus-visible:bg-rowhover";
  const box = (on: boolean) =>
    cn(
      "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] transition-colors",
      on ? "bg-primary text-primary-foreground" : "border-2 border-faint",
    );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "group inline-flex w-full min-w-0 items-center justify-between gap-2 border border-border bg-surface px-3 text-[13px] text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring",
            pill ? "rounded-full" : "rounded-[10px]",
            size === "md" ? "h-[42px]" : "h-9",
            className,
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {picked.length > 0 && <CreatorStack names={picked} photoOf={(n) => photoOf.get(n)} size="xs" />}
            <span className={cn("min-w-0 flex-1 truncate text-left", !picked.length && !agencyLabel && "text-muted-foreground")}>{label}</span>
          </span>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground" aria-hidden>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        collisionPadding={16}
        className="z-[1300] w-[var(--radix-popover-trigger-width)] min-w-[220px] max-w-[calc(100vw-32px)] max-h-[min(340px,var(--radix-popover-content-available-height))] rounded-[16px] p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div role="listbox" aria-multiselectable="true" aria-label={ariaLabel} className="flex flex-col gap-0.5">
          {agencyLabel && (
            <button type="button" role="option" aria-selected={picked.length === 0} onClick={() => onChange([])} className={row}>
              <span className={box(picked.length === 0)}>{picked.length === 0 && <Check className="h-3 w-3" strokeWidth={3} />}</span>
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-field text-muted-foreground" aria-hidden>
                <Building2 className="h-3 w-3" />
              </span>
              <span className="min-w-0 flex-1 truncate">{agencyLabel}</span>
            </button>
          )}
          {creators.map((c) => {
            const on = pickedKeys.has(c.name.toLocaleLowerCase("fr"));
            return (
              <button key={c.name} type="button" role="option" aria-selected={on} onClick={() => onChange(toggleCreator(picked, c.name))} className={row}>
                <span className={box(on)}>{on && <Check className="h-3 w-3" strokeWidth={3} />}</span>
                <CreatorAvatar name={c.name} photoUrl={c.photo_url} alt="" className="h-5 w-5 shrink-0 rounded-full text-[9px]" />
                <span className={cn("min-w-0 flex-1 truncate", on ? "text-foreground" : "text-muted-foreground")}>{titleCase(c.name)}</span>
              </button>
            );
          })}
          {creators.length === 0 && <p className="px-2.5 py-2 text-[12px] text-muted-foreground">Aucun créateur</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Avatars qui se chevauchent (3 au plus, puis « +N ») ; icône agence si la liste est vide. */
export function CreatorStack({
  names,
  photoOf,
  size,
  max = 3,
}: {
  names: readonly string[];
  photoOf: (name: string) => string | null | undefined;
  size: "xs" | "sm";
  max?: number;
}) {
  const cls = size === "xs" ? "h-4 w-4 rounded-[5px] text-[8px]" : "h-6 w-6 rounded-full text-[10px]";
  if (names.length === 0) {
    return (
      <span aria-hidden className={cn("grid shrink-0 place-items-center bg-field text-muted-foreground", cls)}>
        <Building2 className={size === "xs" ? "h-2.5 w-2.5" : "h-3.5 w-3.5"} />
      </span>
    );
  }
  const { shown, more } = avatarStack(names, max);
  return (
    <span aria-hidden className="flex shrink-0 items-center">
      {shown.map((n, i) => (
        <CreatorAvatar
          key={n}
          name={n}
          photoUrl={photoOf(n)}
          alt=""
          className={cn("shrink-0 bg-field ring-2 ring-surface", cls, i > 0 && (size === "xs" ? "-ml-1.5" : "-ml-2"))}
        />
      ))}
      {more > 0 && (
        <span className={cn("-ml-1.5 grid shrink-0 place-items-center bg-field px-0.5 font-semibold tabular-nums text-muted-foreground ring-2 ring-surface", cls, "w-auto min-w-4", size === "sm" && "min-w-6 -ml-2")}>
          +{more}
        </span>
      )}
    </span>
  );
}
