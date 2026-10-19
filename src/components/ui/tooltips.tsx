import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Bulles d'aide de toute l'app : remplace la bulle grise du navigateur (lente, au
 * style du système, différente d'un navigateur à l'autre) par une bulle aux couleurs
 * de l'app, pour CHAQUE élément qui a un `title`, sans toucher aux pages.
 *
 * Au survol (souris seulement), le `title` passe dans `data-tip` pour que le
 * navigateur n'affiche plus sa propre bulle, puis la bulle apparaît après un court
 * délai. Si React réécrit le `title` plus tard, il est repris au survol suivant.
 * Les lecteurs d'écran gardent le texte : il est recopié dans `aria-label` quand
 * l'élément n'a ni libellé ni texte visible.
 */
const DELAY = 380;
const GAP = 8;

type Tip = { text: string; x: number; y: number; below: boolean };

function holder(t: EventTarget | null): HTMLElement | null {
  const el = t instanceof Element ? (t.closest("[title],[data-tip]") as HTMLElement | null) : null;
  if (!el || el.tagName === "svg" || el.closest("svg title")) return null;
  const title = el.getAttribute("title");
  if (title) {
    el.setAttribute("data-tip", title);
    el.removeAttribute("title");
    if (!el.getAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", title);
  }
  return el.getAttribute("data-tip") ? el : null;
}

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    if (!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) return;
    let timer = 0;
    let current: HTMLElement | null = null;
    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = holder(e.target);
      if (el === current) return;
      hide();
      if (!el) return;
      current = el;
      timer = window.setTimeout(() => {
        if (current !== el || !el.isConnected) return;
        const text = el.getAttribute("data-tip") ?? "";
        if (!text.trim()) return;
        const r = el.getBoundingClientRect();
        const below = r.top < 56; // trop près du haut : la bulle passe dessous
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + GAP : r.top - GAP, below });
      }, DELAY);
    };
    const out = (e: PointerEvent) => {
      if (current && !(e.relatedTarget instanceof Node && current.contains(e.relatedTarget))) hide();
    };
    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("pointerdown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  if (!tip) return null;
  // Centrée sur l'élément, gardée dans l'écran (12 px de marge).
  const maxW = 320;
  const left = Math.min(Math.max(tip.x, 12 + maxW / 2), window.innerWidth - 12 - maxW / 2);
  return createPortal(
    <div
      role="tooltip"
      className="tip-in pointer-events-none fixed z-[2000] w-max max-w-[320px] rounded-lg bg-foreground px-2.5 py-1.5 text-center text-[12px] font-medium leading-snug text-background shadow-lg"
      style={{ left, top: tip.y, transform: `translate(-50%, ${tip.below ? "0" : "-100%"})` }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
