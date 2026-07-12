import { useId, type ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { GooeyFilter } from "./gooey-filter";

/**
 * Toggle segmenté avec effet « gooey » : la pastille active glisse et se déforme
 * comme une goutte de liquide (filtre SVG). Interface identique à un toggle
 * classique (value / onChange), donc remplaçable en place.
 */
export function GooeyTabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { value: string; label: ReactNode }[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const fid = "goo" + useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <div className={cn("relative flex h-10 rounded-xl bg-panel p-1 ring-1 ring-border", className)}>
      <GooeyFilter id={fid} strength={6} />
      {/* Couche filtrée : la pastille active (morphe en glissant) */}
      <div className="pointer-events-none absolute inset-1 flex" style={{ filter: `url(#${fid})` }}>
        {tabs.map((t) => (
          <div key={t.value} className="relative flex-1">
            {value === t.value && (
              <motion.div
                layoutId={`gootab-${fid}`}
                className="absolute inset-0 rounded-lg bg-surface"
                transition={{ type: "spring", bounce: 0.12, duration: 0.5 }}
              />
            )}
          </div>
        ))}
      </div>
      {/* Couche texte cliquable (non filtrée) */}
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={cn(
            "relative z-10 flex-1 rounded-lg text-[12px] font-medium transition-colors",
            value === t.value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
