import { useState, type KeyboardEvent, type RefObject } from "react";
import { CreatorAvatar } from "@/components/ui/creator-avatar";
import { cn, titleCase } from "@/lib/utils";
import { insertMention, mentionAt, mentionSuggestions } from "@/lib/todoQuickAdd";

/** Créateur proposé sous « @ » (roster : useCreators). */
export type MentionCreator = { name: string; photo_url?: string | null; id?: string };

/**
 * « @ » dans un champ de texte : taper « @lé » propose les créateurs du roster (photo + nom),
 * ↑/↓ pour choisir, Entrée/Tab ou clic pour insérer « @Léna » (même écriture que l'ajout
 * rapide de la To-do, règles pures de src/lib/todoQuickAdd.ts), Échap pour fermer.
 * Sans `roster` (ou roster vide), le champ reste un champ normal.
 */
export function useCreatorMention<E extends HTMLInputElement | HTMLTextAreaElement>(
  ref: RefObject<E | null>,
  roster: readonly MentionCreator[] | undefined,
  value: string,
  onChange: (v: string) => void,
) {
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [idx, setIdx] = useState(0);
  const on = !!roster && roster.length > 0;
  const list = on && mention ? mentionSuggestions(mention.query, roster, 6) : [];

  const sync = (el: E) => {
    if (!on) return;
    const m = mentionAt(el.value, el.selectionStart ?? el.value.length);
    setMention(m);
    if (!m || m.query !== mention?.query) setIdx(0);
  };
  const pick = (name: string) => {
    const el = ref.current;
    if (!el || !mention || !roster) return;
    const r = insertMention(value, mention.start, el.selectionStart ?? value.length, name, roster);
    onChange(r.text);
    setMention(null);
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      el.setSelectionRange(r.caret, r.caret);
    });
  };
  const onKeyDown = (e: KeyboardEvent<E>) => {
    if (!list.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      setIdx((i) => (i + d + list.length) % list.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(list[Math.min(idx, list.length - 1)].name);
    } else if (e.key === "Escape") {
      // Ferme la liste, pas la fenêtre autour.
      e.preventDefault();
      e.stopPropagation();
      setMention(null);
    }
  };

  const fieldProps = on
    ? {
        onKeyDown,
        onSelect: (e: { currentTarget: E }) => sync(e.currentTarget),
        onBlur: () => window.setTimeout(() => setMention(null), 120),
        "aria-autocomplete": "list" as const,
        "aria-expanded": list.length > 0,
      }
    : {};

  const popup =
    list.length > 0 ? (
      <ul
        role="listbox"
        aria-label="Créateurs"
        // Téléphone : au-dessus du champ (le clavier cache le dessous) ; ordinateur : dessous.
        className="absolute left-0 z-40 w-[min(300px,100%)] overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-[0_12px_32px_-12px_rgba(15,23,42,0.3)] max-sm:bottom-[calc(100%+6px)] sm:top-[calc(100%+6px)]"
      >
        {list.map((c, i) => (
          <li key={c.id ?? c.name} role="option" aria-selected={i === idx}>
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setIdx(i)}
              onClick={() => pick(c.name)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] text-foreground transition-colors max-sm:min-h-11 max-sm:text-[16px]",
                i === idx ? "bg-rowhover" : "hover:bg-rowhover",
              )}
            >
              <CreatorAvatar name={c.name} photoUrl={c.photo_url} alt="" className="h-6 w-6 shrink-0 rounded-full text-[9px]" />
              <span className="min-w-0 truncate">{titleCase(c.name)}</span>
            </button>
          </li>
        ))}
      </ul>
    ) : null;

  return { fieldProps, sync, popup };
}
