import { useEffect, useState } from "react";

/** Affiche un toast. Utilisable depuis n'importe où (pas de contexte requis). */
export function toast(message: string) {
  window.dispatchEvent(new CustomEvent("ttp-toast", { detail: message }));
}

type Item = { id: number; message: string };
let seq = 0;

export function Toaster() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const message = (e as CustomEvent<string>).detail;
      const id = ++seq;
      setItems((l) => [...l, { id, message }]);
      window.setTimeout(() => {
        setItems((l) => l.filter((i) => i.id !== id));
      }, 2600);
    };
    window.addEventListener("ttp-toast", onToast);
    return () => window.removeEventListener("ttp-toast", onToast);
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[200] flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((i) => (
        <div
          key={i.id}
          className="pointer-events-auto animate-[ttp-toast-in_.2s_ease] rounded-xl bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg"
        >
          {i.message}
        </div>
      ))}
    </div>
  );
}
