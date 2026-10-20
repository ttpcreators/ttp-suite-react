/**
 * Gestes tactiles : un élément qu'on fait glisser au doigt ne doit ni sélectionner son
 * texte, ni ouvrir le menu de l'iPhone (appui long), ni partir en glisser-déposer natif.
 */
export const TOUCH_GESTURE_CLASS = "select-none [-webkit-touch-callout:none] [-webkit-user-drag:none]";

/** Garde le pointeur sur l'élément pendant un glisser (sans planter si le navigateur refuse). */
export function capturePointer(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* pointeur déjà relâché : rien à faire */
  }
}
