import { useEffect, useState } from "react";
import { myDisplayName, onMyNameChange } from "@/lib/team";

/**
 * Prénom de la personne connectée (Paramètres → Ton prénom, ou Accès → Modifier),
 * mis à jour dès qu'il change. "" pendant le chargement.
 */
export function useMyName(userId?: string): string {
  const [name, setName] = useState("");
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const load = () => void myDisplayName().then((n) => alive && setName(n));
    load();
    const off = onMyNameChange(load);
    return () => {
      alive = false;
      off();
    };
  }, [userId]);
  return name;
}
