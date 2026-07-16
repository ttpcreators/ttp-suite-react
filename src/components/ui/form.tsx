import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X, ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
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

export type AddMenuItem = { key: string; label: string; hint?: string; icon?: LucideIcon; onClick: () => void };

/**
 * Bouton « + Label » AVEC menu déroulant : UN seul bouton dans l'en-tête, le choix se
 * fait dans le menu — au lieu d'empiler plusieurs boutons côte à côte (illisible sur
 * mobile). Menu rendu en portail et clampé dans le viewport (se retourne vers le haut
 * s'il manque de place en bas), même mécanique qu'ActionMenu.
 */
export function AddMenuButton({ label, items }: { label: string; items: AddMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setOpen(true);
  };
  const run = (item: AddMenuItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    item.onClick();
  };

  const W = 240;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  // Aligné à droite du bouton, mais jamais hors écran (marge 8px) → OK sur mobile.
  const left = rect ? Math.min(Math.max(8, rect.right - W), Math.max(8, vw - W - 8)) : 0;
  const spaceBelow = rect ? vh - rect.bottom - 8 : 0;
  const spaceAbove = rect ? rect.top - 8 : 0;
  const menuUp = !!rect && spaceBelow < 180 && spaceAbove > spaceBelow;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90"
      >
        <Plus className="h-3.5 w-3.5" /> {label}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open &&
        rect &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[70]"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
            />
            <div
              role="menu"
              className="fixed z-[71] overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-xl"
              style={{ ...(menuUp ? { bottom: vh - rect.top + 6 } : { top: rect.bottom + 6 }), left, width: W }}
            >
              {items.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  role="menuitem"
                  onClick={(e) => run(it, e)}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-rowhover"
                >
                  {it.icon && <it.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-foreground">{it.label}</span>
                    {it.hint && <span className="mt-0.5 block text-[11px] leading-snug text-faint">{it.hint}</span>}
                  </span>
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
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

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  return (
    <Field label={label} className={className}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={inputCls + " resize-y leading-relaxed"}
      />
    </Field>
  );
}

/** Champ texte qui grandit tout seul au fil des lignes tapées (lisibilité) —
 *  sans barre de défilement ni poignée de redimensionnement. */
export function AutoGrowTextField({
  label,
  value,
  onChange,
  placeholder,
  minRows = 2,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minRows?: number;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Recale la hauteur sur le contenu à chaque changement de valeur (y compris
  // quand le formulaire est réinitialisé après envoi → revient à minRows).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <Field label={label} className={className}>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={minRows}
        className={inputCls + " resize-none overflow-hidden leading-relaxed"}
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
