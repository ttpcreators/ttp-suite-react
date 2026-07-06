import { type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { Select, SelectTrigger, SelectContent, SelectItem } from "./select";

const inputCls =
  "w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/15";

/** Bouton vert « + Label » (déclenche l'ouverture d'un formulaire). */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
    >
      <Plus className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={"flex min-w-0 flex-1 flex-col gap-1.5 sm:min-w-[150px] " + className}>
      <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">{label}</span>
      {children}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}) {
  return (
    <Field label={label} className={className}>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={inputCls}
      />
    </Field>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <Field label={label} className={className}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-[42px] w-full rounded-lg bg-surface" placeholder="Sélectionner…" />
        <SelectContent>
          {options.map((o, i) => (
            <SelectItem key={o.value} index={i} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** Formulaire en ligne (carte) qui s'ouvre au-dessus d'une liste. */
export function InlineForm({
  open,
  title,
  onClose,
  onSubmit,
  submitLabel = "Ajouter",
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="mb-4 rounded-2xl border border-border bg-surface p-5 shadow-sm"
    >
      <div className="mb-3.5 flex items-center justify-between">
        <div className="text-sm font-semibold">{title}</div>
        <button type="button" onClick={onClose} className="text-faint transition-colors hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      {/* Mobile : champs empilés en pleine largeur. ≥ sm : rangée multi-colonnes. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        {children}
        <button
          type="submit"
          className="h-[42px] w-full shrink-0 rounded-lg bg-primary px-5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 sm:w-auto"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

/** Petit bouton de suppression pour une ligne. */
export function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-[#E5484D]"
      title="Supprimer"
    >
      <X className="h-4 w-4" />
    </button>
  );
}
