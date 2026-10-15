import type { AppState } from "@/lib/appState";
import { ALL_ITEMS, type ViewId } from "@/lib/nav";

/**
 * Pages rangées : retirées du menu, de la recherche, des raccourcis et des onglets iPhone,
 * pour TOUTE l'agence (blob agence `hiddenPages`). Rien n'est effacé : la page reste
 * ouvrable (onglet déjà ouvert, lien) et Paramètres → « Pages affichées » la remet.
 * Clé absente = tri du 2026-10-15 (Modèles et Checklist, quasi jamais utilisées).
 */
export const HIDDEN_PAGES_KEY = "hiddenPages";
export const DEFAULT_HIDDEN_PAGES: ViewId[] = ["templates", "checklist"];
/** Événement local : Paramètres prévient l'app tout de suite (sans attendre le tick partagé). */
export const HIDDEN_PAGES_EVENT = "ttp-hidden-pages";
/** Jamais rangeable : c'est là qu'on réaffiche les pages. */
export const ALWAYS_SHOWN: ViewId[] = ["parametres"];

const KNOWN = new Set<string>(ALL_ITEMS.map((i) => i.id));

export function hiddenPagesOf(s: AppState): ViewId[] {
  const v = s[HIDDEN_PAGES_KEY];
  if (!Array.isArray(v)) return DEFAULT_HIDDEN_PAGES;
  return v.filter((x): x is ViewId => typeof x === "string" && KNOWN.has(x) && !ALWAYS_SHOWN.includes(x as ViewId));
}
