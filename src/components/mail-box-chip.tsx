import { cn } from "@/lib/utils";
import { BOX_LABEL, BOX_STYLE, type MailBox } from "@/lib/mailSend";

/** Pastille de boîte d'envoi : violet = partnerships@, vert fluo = talent@. */
export function BoxChip({ box, prefix, className }: { box: MailBox; prefix?: string; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-md px-1.5 py-px text-[11px] font-semibold", BOX_STYLE[box].chip, className)}>
      {prefix ? `${prefix} ` : ""}{BOX_LABEL[box]}
    </span>
  );
}

/** Sélecteur de boîte coloré (composeur, transfert). */
export function BoxPicker({ value, onChange }: { value: MailBox; onChange: (b: MailBox) => void }) {
  return (
    <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
      {(["partnerships", "talent"] as const).map((b) => (
        <button
          key={b}
          type="button"
          onClick={() => onChange(b)}
          aria-pressed={value === b}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors",
            value === b ? BOX_STYLE[b].chip + " shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {value !== b && <span className={cn("h-2 w-2 rounded-full", BOX_STYLE[b].dot)} />}
          {BOX_LABEL[b]}
        </button>
      ))}
    </div>
  );
}
