import { useCallback, useState } from "react";

/**
 * État d'onglet ou de filtre MÉMORISÉ sur cet appareil : après un rechargement, la
 * page rouvre sur le même onglet. `allowed` = valeurs possibles ; une valeur gardée
 * qui n'y figure plus (onglet retiré) est ignorée au profit de `initial`.
 */
export function readSticky<T>(key: string, allowed: readonly T[], initial: T): T {
  try {
    const raw = localStorage.getItem(`ttp:ui:${key}`);
    if (raw == null) return initial;
    const v = JSON.parse(raw) as T;
    return allowed.includes(v) ? v : initial;
  } catch {
    return initial; // stockage indisponible ou valeur illisible
  }
}

export function useStickyState<T extends string | number>(key: string, allowed: readonly T[], initial: T | (() => T)) {
  const [value, setValue] = useState<T>(() => readSticky(key, allowed, typeof initial === "function" ? (initial as () => T)() : initial));
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(`ttp:ui:${key}`, JSON.stringify(next));
      } catch {
        /* stockage indisponible : l'onglet reste valable pour la session */
      }
    },
    [key],
  );
  return [value, set] as const;
}
