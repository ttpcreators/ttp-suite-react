import { useEffect, useState } from "react";
import { toast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n";

/*
 * Espace créateur : plus de « Êtes-vous sûr ? ». L'action se fait tout de suite à l'écran,
 * un bandeau « Annuler » reste 5 secondes, puis l'action est enregistrée pour de vrai.
 * Annuler remet l'écran comme avant. Si l'enregistrement échoue, l'écran revient aussi
 * et un message dit quoi faire. Page fermée pendant le délai : l'action part tout de suite.
 */

const DELAY_MS = 5000;

type Pending = { id: number; label: string; revert: () => void; commit: () => Promise<boolean>; failText: string; timer: number };
let seq = 0;
const pending = new Map<number, Pending>();
const listeners = new Set<(items: { id: number; label: string }[]) => void>();
const emit = () => {
  const items = [...pending.values()].map((p) => ({ id: p.id, label: p.label }));
  for (const l of listeners) l(items);
};

async function run(p: Pending) {
  pending.delete(p.id);
  emit();
  let ok = false;
  try {
    ok = await p.commit();
  } catch {
    ok = false;
  }
  if (!ok) {
    p.revert();
    toast(p.failText, { variant: "error" });
  }
}

/** Fait l'action à l'écran (`apply`), la propose à l'annulation 5 s, puis l'enregistre (`commit`). */
export function undoable(label: string, o: { apply: () => void; revert: () => void; commit: () => Promise<boolean>; failText: string }) {
  o.apply();
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(10);
  const id = ++seq;
  const p: Pending = { id, label, revert: o.revert, commit: o.commit, failText: o.failText, timer: 0 };
  p.timer = window.setTimeout(() => void run(p), DELAY_MS);
  pending.set(id, p);
  emit();
}

function cancel(id: number) {
  const p = pending.get(id);
  if (!p) return;
  window.clearTimeout(p.timer);
  pending.delete(id);
  emit();
  p.revert();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    for (const p of [...pending.values()]) {
      window.clearTimeout(p.timer);
      void run(p);
    }
  });
}

/** Bandeau « Annuler » (au-dessus de la barre du bas au téléphone). */
export function UndoBar() {
  const t = useT();
  const [items, setItems] = useState<{ id: number; label: string }[]>([]);
  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);
  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-[1301] flex flex-col items-center gap-2 px-4 md:bottom-6">
      {items.map((i) => (
        <div
          key={i.id}
          role="status"
          className="pointer-events-auto flex w-full max-w-[420px] animate-[ttp-toast-in_.2s_ease-out] items-center gap-3 rounded-full bg-foreground py-1.5 pl-5 pr-1.5 text-background shadow-lg"
        >
          <span className="min-w-0 flex-1 truncate text-[15px]">{i.label}</span>
          <button
            type="button"
            onClick={() => cancel(i.id)}
            className="h-11 shrink-0 rounded-full px-4 text-[15px] font-semibold text-primary-foreground transition-transform duration-200 ease-out active:scale-95"
            style={{ background: "var(--primary)" }}
          >
            {t("Annuler")}
          </button>
        </div>
      ))}
    </div>
  );
}
