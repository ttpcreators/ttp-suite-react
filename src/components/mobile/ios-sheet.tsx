import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, useDragControls, useReducedMotion } from "motion/react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsPhone } from "@/lib/iosUi";

/*
 * Feuilles façon iOS (mode iPhone, téléphone seulement) :
 *   - IosSheet       : feuille qui monte du bas, poignée en haut, se ferme en
 *                      glissant vers le bas ou en touchant le fond ;
 *   - IosActionSheet : liste d'actions en bas d'écran + « Annuler » (menus ⋯,
 *                      confirmations de suppression).
 */

/** Affichage iPhone = écran de téléphone. */
export function useIosPhone(): boolean {
  return useIsPhone();
}

const SPRING = { type: "spring" as const, damping: 34, stiffness: 380, mass: 0.9 };

/** Bloque le défilement de la page derrière une feuille ouverte. */
function useLockScroll() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
}

/**
 * Feuille du bas. `children` = le panneau (gardé tel quel : ses en-têtes, champs et
 * boutons) ; la feuille lui donne toute la largeur, des coins hauts arrondis et la marge
 * du bas de l'iPhone (règles `.ios-sheet-panel` dans index.css).
 */
export function IosSheet({ onClose, children, zIndex = 1000, label }: { onClose: () => void; children: ReactNode; zIndex?: number; label?: string }) {
  const drag = useDragControls();
  const reduce = useReducedMotion();
  useLockScroll();
  return createPortal(
    <div className="ios-sheet fixed inset-0 flex items-end justify-center" style={{ zIndex }} role="dialog" aria-modal="true" aria-label={label}>
      <motion.div
        className="absolute inset-0 bg-black/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: reduce ? 0 : 0.2 }}
        onClick={onClose}
      />
      <motion.div
        className="ios-sheet-panel relative w-full"
        initial={{ y: reduce ? 0 : "100%" }}
        animate={{ y: 0 }}
        transition={reduce ? { duration: 0 } : SPRING}
        drag="y"
        dragControls={drag}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.9 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 110 || info.velocity.y > 650) onClose();
        }}
      >
        {/* Poignée : on la tire vers le bas pour fermer. */}
        <div
          className="absolute inset-x-0 top-0 z-20 flex h-6 touch-none justify-center pt-[7px]"
          onPointerDown={(e) => drag.start(e)}
          aria-hidden
        >
          <span className="h-[5px] w-9 rounded-full bg-foreground/20" />
        </div>
        {children}
      </motion.div>
    </div>,
    document.body,
  );
}

export type IosAction = { key: string; label: string; icon?: LucideIcon; danger?: boolean; onClick: () => void };

/** Feuille d'actions iOS : titre/message facultatifs, actions, puis « Annuler » à part. */
export function IosActionSheet({ title, message, actions, onCancel, cancelLabel = "Annuler" }: {
  title?: string; message?: string; actions: IosAction[]; onCancel: () => void; cancelLabel?: string;
}) {
  const reduce = useReducedMotion();
  useLockScroll();
  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title ?? "Actions"}>
      <motion.div className="absolute inset-0 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduce ? 0 : 0.2 }} onClick={onCancel} />
      <motion.div
        className="relative flex w-full flex-col gap-2 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        initial={{ y: reduce ? 0 : "100%" }}
        animate={{ y: 0 }}
        transition={reduce ? { duration: 0 } : SPRING}
      >
        <div className="ios-actions overflow-hidden rounded-[14px]">
          {(title || message) && (
            <div className="border-b border-foreground/10 px-4 py-3.5 text-center">
              {title && <p className="text-[13px] font-semibold text-muted-foreground">{title}</p>}
              {message && <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{message}</p>}
            </div>
          )}
          {actions.map((a, i) => (
            <button
              key={a.key}
              type="button"
              onClick={a.onClick}
              className={cn(
                "flex h-[57px] w-full items-center justify-center gap-2.5 px-4 text-[19px]",
                i > 0 && "border-t border-foreground/10",
                a.danger ? "text-red-600 dark:text-red-500" : "text-primary",
              )}
            >
              {a.icon && <a.icon className="h-[19px] w-[19px] shrink-0" strokeWidth={1.9} />}
              <span className="truncate">{a.label}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={onCancel} className="ios-actions h-[57px] w-full rounded-[14px] text-[19px] font-semibold text-primary">
          {cancelLabel}
        </button>
      </motion.div>
    </div>,
    document.body,
  );
}

/** Fenêtre de la page : feuille du bas en mode iPhone, sinon le calque d'origine (inchangé). */
export function Overlay({ onClose, className, children, label }: {
  onClose: () => void;
  /** Classes du calque d'origine (fond sombre centré) : gardées telles quelles hors mode iPhone. */
  className: string;
  children: ReactNode;
  label?: string;
}) {
  const ios = useIosPhone();
  if (ios) {
    const z = /\bz-\[(\d+)\]/.exec(className)?.[1] ?? /\bz-(\d+)\b/.exec(className)?.[1];
    return (
      <IosSheet onClose={onClose} zIndex={Math.max(Number(z ?? 100), 100) + 900} label={label}>
        {children}
      </IosSheet>
    );
  }
  return (
    <div className={className} onClick={onClose}>
      {children}
    </div>
  );
}
