import { useEffect, type RefObject } from "react";

/**
 * Ferme un élément ouvert quand on touche ou clique ailleurs (ou touche Échap).
 * behavior « consume » : ce premier tap extérieur ne fait QUE fermer (il n'active pas
 * le bouton qui se trouvait dessous), comme un menu natif.
 */
export function useDismiss(
  active: boolean,
  onDismiss: () => void,
  ref: RefObject<HTMLElement | null>,
  opts: { behavior?: "consume" | "passthrough" } = {},
): void {
  const consume = opts.behavior === "consume";
  useEffect(() => {
    if (!active) return;
    const inside = (t: EventTarget | null) => !!ref.current && t instanceof Node && ref.current.contains(t);
    let swallowClick = false;
    const onDown = (e: PointerEvent) => {
      if (inside(e.target)) return;
      swallowClick = consume;
      onDismiss();
    };
    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [active, consume, onDismiss, ref]);
}
