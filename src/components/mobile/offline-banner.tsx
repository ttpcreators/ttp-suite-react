import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/*
 * Bandeau « Hors connexion » : l'app reste lisible (dernières données affichées),
 * mais rien ne s'enregistre tant que le réseau n'est pas revenu. Disparaît seul.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  if (!offline) return null;
  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 z-[1250] flex justify-center px-4" style={{ top: "calc(env(safe-area-inset-top) + 8px)" }}>
      <span className="flex items-center gap-2 rounded-full bg-foreground px-3.5 py-1.5 text-[12px] font-medium text-background shadow-lg">
        <WifiOff className="h-3.5 w-3.5" /> Hors connexion : les modifications attendront le réseau
      </span>
    </div>
  );
}
