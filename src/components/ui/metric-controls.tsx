import { useEffect, useRef, useState } from "react";
import { ChevronDown, Activity, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChartView } from "./metric-chart";

export type PeriodOption = { label: string; points?: number };

export function ViewToggle({
  value,
  onChange,
}: {
  value: ChartView;
  onChange: (v: ChartView) => void;
}) {
  return (
    <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {(["curve", "bar"] as ChartView[]).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "grid h-8 w-8 sm:h-6 sm:w-6 place-items-center rounded-md transition-colors",
            value === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
          aria-label={v === "curve" ? "Courbe" : "Barres"}
        >
          {v === "curve" ? <Activity className="h-3.5 w-3.5" /> : <BarChart3 className="h-3.5 w-3.5" />}
        </button>
      ))}
    </div>
  );
}

export function PeriodSelect({
  value,
  options,
  onChange,
  accentText,
}: {
  value: string;
  options: PeriodOption[];
  onChange: (o: PeriodOption) => void;
  accentText?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div ref={ref} className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        style={accentText ? undefined : undefined}
      >
        {value} <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-30 min-w-[160px] rounded-xl border border-border bg-card p-1 shadow-lg">
          {options.map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => {
                onChange(o);
                setOpen(false);
              }}
              className={cn(
                "block w-full rounded-lg px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-muted",
                o.label === value ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
