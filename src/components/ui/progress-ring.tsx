import { motion, useReducedMotion } from "motion/react";

/** Anneau de progression de la journée (pages « Aujourd'hui » agence et créateur), `value` de 0 à 1. */
export function ProgressRing({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const r = 18;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <svg viewBox="0 0 44 44" className="h-11 w-11 shrink-0 -rotate-90" aria-hidden>
      <circle cx="22" cy="22" r={r} fill="none" strokeWidth="4" className="stroke-field" />
      <motion.circle
        cx="22"
        cy="22"
        r={r}
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        className="stroke-primary"
        strokeDasharray={c}
        initial={reduce ? false : { strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - v) }}
        transition={{ duration: reduce ? 0 : 0.6, ease: "easeOut" }}
      />
    </svg>
  );
}
