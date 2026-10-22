import { useEffect, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { getCreatorRecipients, insertRecipient, matchRecipients, recipientToken, type CreatorRecipient, type RecipientOption } from "@/lib/creatorRecipients";

/**
 * Champ d'adresses (À, Cc, Cci) : taper « @lena » (ou « lena ») propose les adresses du
 * créateur ; Entrée, Tab ou un clic l'insère, suivie de « , » pour enchaîner. La liste est
 * posée sur la page (portail) : elle n'est jamais coupée par le cadre de la réponse.
 */
export function AddressInput({
  value, onChange, className, ...rest
}: { value: string; onChange: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const ref = useRef<HTMLInputElement>(null);
  const [list, setList] = useState<CreatorRecipient[]>([]);
  const [caret, setCaret] = useState<number | null>(null); // null : liste fermée
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  const query = caret === null ? null : recipientToken(value, caret).query;
  const options: RecipientOption[] = query === null ? [] : matchRecipients(list, query, value);
  const open = options.length > 0;

  useEffect(() => {
    if (query !== null && !list.length) void getCreatorRecipients().then(setList);
  }, [query, list.length]);
  useEffect(() => setActive(0), [query]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 328)), top: r.bottom + 6, width: Math.min(320, window.innerWidth - 16) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const track = () => setCaret(ref.current?.selectionStart ?? value.length);
  const pick = (o: RecipientOption) => {
    const next = insertRecipient(value, caret ?? value.length, o.email);
    onChange(next.value);
    setCaret(null);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  return (
    <>
      <input
        {...rest}
        ref={ref}
        value={value}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
        }}
        onClick={track}
        onKeyUp={(e) => {
          if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) track();
        }}
        onBlur={() => setCaret(null)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(options[Math.min(active, options.length - 1)]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setCaret(null);
              return;
            }
          }
          rest.onKeyDown?.(e);
        }}
        className={className}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && pos &&
        createPortal(
          <div
            role="listbox"
            aria-label="Adresses des créateurs"
            style={{ left: pos.left, top: pos.top, width: pos.width }}
            className="fixed z-[1300] overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-lg shadow-black/10"
          >
            {options.map((o, i) => (
              <button
                key={o.email}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
                className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left", i === active && "bg-rowhover")}
              >
                {o.photo ? (
                  <img src={o.photo} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-[12px] font-semibold text-muted-foreground">{o.name.charAt(0).toUpperCase()}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">{o.name}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{o.email}</span>
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
