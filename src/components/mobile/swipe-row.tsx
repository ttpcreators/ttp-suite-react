import { useState, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIosPhone } from "@/components/mobile/ios-sheet";

/*
 * Ligne qu'on fait glisser vers la gauche pour révéler des actions (comme Mail et
 * Rappels sur iPhone). Mode iPhone seulement : ailleurs, la ligne est rendue telle
 * quelle. Le défilement vertical reste libre (touch-action: pan-y).
 */

export type SwipeAction = { key: string; label: string; icon: LucideIcon; tone: "green" | "red" | "gray" | "blue"; onClick: () => void };

const TONE: Record<SwipeAction["tone"], string> = {
  green: "bg-[#34c759]",
  red: "bg-[#ff3b30]",
  gray: "bg-zinc-400 dark:bg-zinc-600",
  blue: "bg-[#007aff]",
};
const BTN_W = 78;
const SPRING = { type: "spring" as const, damping: 36, stiffness: 420 };

export function SwipeRow({ actions, children, className }: { actions: SwipeAction[]; children: ReactNode; className?: string }) {
  const ios = useIosPhone();
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const [open, setOpen] = useState(false);
  if (!ios || actions.length === 0) return <>{children}</>;
  const W = actions.length * BTN_W;
  const to = (v: number) => animate(x, v, reduce ? { duration: 0 } : SPRING);
  const close = () => {
    to(0);
    setOpen(false);
  };
  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div className="absolute inset-y-0 right-0 flex" style={{ width: W }} aria-hidden={!open}>
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            tabIndex={open ? 0 : -1}
            onClick={() => {
              close();
              a.onClick();
            }}
            className={cn("flex h-full flex-col items-center justify-center gap-1 text-[12px] font-medium text-white", TONE[a.tone])}
            style={{ width: BTN_W }}
          >
            <a.icon className="h-5 w-5" strokeWidth={2} />
            {a.label}
          </button>
        ))}
      </div>
      <motion.div
        style={{ x, touchAction: "pan-y" }}
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -W, right: 0 }}
        dragElastic={{ left: 0.12, right: 0 }}
        dragMomentum={false}
        onDragEnd={(_, info) => {
          const wantsOpen = info.offset.x < -W / 3 || info.velocity.x < -350;
          const wantsClose = info.offset.x > W / 4 || info.velocity.x > 350;
          if (open ? !wantsClose : wantsOpen) {
            to(-W);
            setOpen(true);
          } else close();
        }}
        // Ligne ouverte : un toucher la referme au lieu d'ouvrir la tâche.
        onClickCapture={(e) => {
          if (!open) return;
          e.stopPropagation();
          e.preventDefault();
          close();
        }}
        className="relative bg-surface"
      >
        {children}
      </motion.div>
    </div>
  );
}
