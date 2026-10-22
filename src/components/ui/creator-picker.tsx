import { useState, type KeyboardEvent } from "react";
import { Check, Search } from "@/components/icons";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, titleCase } from "@/lib/utils";
import { mentionSuggestions } from "@/lib/todoQuickAdd";
import { useT } from "@/lib/i18n";
import { Field } from "@/components/ui/form";

export type PickCreator = { name: string; photo_url?: string | null };

/**
 * Choix d'UN créateur : un champ de recherche puis le roster avec les photos, noms lisibles
 * (« Candice Maissa »), « Aucun » en dernier. La valeur reste le nom tel qu'il est enregistré.
 * `extraNames` : noms déjà utilisés qui ne sont plus dans le roster (gardés pour ne rien perdre).
 */
export function CreatorPicker({
  value,
  onChange,
  creators,
  extraNames = [],
  emptyLabel = "Aucun",
  placeholder = "Choisir…",
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (name: string) => void;
  creators: readonly PickCreator[];
  extraNames?: readonly string[];
  emptyLabel?: string;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const key = (n: string) => n.trim().toLocaleLowerCase("fr");
  const known = new Set(creators.map((c) => key(c.name)));
  const all: PickCreator[] = [
    ...creators.filter((c) => c.name),
    ...extraNames.filter((n) => n && !known.has(key(n))).map((name) => ({ name, photo_url: null })),
  ];
  const list = mentionSuggestions(q, all, all.length);
  // « Aucun » en dernier choix (seulement sans recherche).
  const options: (PickCreator | null)[] = q.trim() ? list : [...list, null];
  const current = value ? all.find((c) => key(c.name) === key(value)) ?? { name: value, photo_url: null } : null;

  const choose = (c: PickCreator | null) => {
    onChange(c ? c.name : "");
    setOpen(false);
    setQ("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      setIdx((i) => (i + d + options.length) % Math.max(1, options.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (options.length) choose(options[Math.min(idx, options.length - 1)]);
    }
  };
  const row = "flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left text-[13.5px] outline-none transition-colors max-sm:min-h-11 max-sm:text-[16px]";

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ("");
        setIdx(0);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "inline-flex h-[42px] w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring",
            className,
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {current && <CreatorAvatar name={current.name} photoUrl={current.photo_url} alt="" className="h-6 w-6 shrink-0 rounded-full text-[9px]" />}
            <span className={cn("min-w-0 flex-1 truncate text-left", !current && "text-muted-foreground")}>{current ? titleCase(current.name) : t(placeholder)}</span>
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
        className="z-[1300] flex w-[var(--radix-popover-trigger-width)] min-w-[240px] max-w-[calc(100vw-32px)] max-h-[min(380px,var(--radix-popover-content-available-height))] flex-col rounded-[16px] p-1"
        // Téléphone : pas de clavier d'office (la liste se lit d'abord) ; ordinateur : on tape tout de suite.
        onOpenAutoFocus={(e) => {
          if (window.matchMedia?.("(pointer: coarse)").matches) e.preventDefault();
        }}
      >
        <label className="mx-1 mt-1 flex h-10 shrink-0 items-center gap-2 rounded-[10px] bg-field px-2.5">
          <Search className="h-4 w-4 shrink-0 text-faint" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={onKey}
            placeholder={t("Rechercher")}
            aria-label={t("Rechercher un créateur")}
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-faint max-sm:text-[16px]"
          />
        </label>
        <div role="listbox" aria-label={ariaLabel} className="mt-1 flex min-h-0 flex-col gap-0.5 overflow-y-auto overscroll-contain">
          {options.map((c, i) => {
            const on = c ? !!current && key(c.name) === key(current.name) : !current;
            return (
              <button
                key={c ? c.name : "__none"}
                type="button"
                role="option"
                aria-selected={on}
                onMouseEnter={() => setIdx(i)}
                onClick={() => choose(c)}
                className={cn(row, i === idx ? "bg-rowhover" : "hover:bg-rowhover")}
              >
                {c ? (
                  <CreatorAvatar name={c.name} photoUrl={c.photo_url} alt="" className="h-7 w-7 shrink-0 rounded-full text-[10px]" />
                ) : (
                  <span aria-hidden className="h-7 w-7 shrink-0" />
                )}
                <span className={cn("min-w-0 flex-1 truncate", c ? "text-foreground" : "text-muted-foreground")}>{c ? titleCase(c.name) : t(emptyLabel)}</span>
                {on && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
          {q.trim() && options.length === 0 && <p className="px-2.5 py-2 text-[12px] text-muted-foreground">{t("Aucun")}</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** `CreatorPicker` avec son libellé, même allure que les autres champs des formulaires. */
export function CreatorPickerField({
  label,
  className,
  ...rest
}: { label: string; className?: string } & Parameters<typeof CreatorPicker>[0]) {
  return (
    <Field label={label} className={className}>
      <CreatorPicker ariaLabel={label} {...rest} />
    </Field>
  );
}
