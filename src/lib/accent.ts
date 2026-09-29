/**
 * Couleur d'accent personnalisable (le token `--primary` de l'app). On pose la
 * couleur EN LIGNE sur `document.documentElement` → l'inline gagne sur les règles
 * `:root {}` ET `.dark {}` de la feuille de style, donc le changement marche dans
 * les DEUX thèmes sans rien casser. Le texte sur les boutons (`--primary-foreground`)
 * est recalculé (noir/blanc) selon la luminance → toujours lisible.
 *
 * Préférence PROPRE À CET APPAREIL (localStorage), comme le mode sombre.
 */

const KEY = "ttp:accent";

export type AccentPreset = { name: string; value: string };
/** value === "" ⇒ accent par défaut du thème (aucun override) : bleu en clair,
 *  blanc monochrome en sombre « Minuit ». « Bleu TTP » force le bleu partout. */
export const ACCENT_PRESETS: AccentPreset[] = [
  { name: "Par défaut", value: "" },
  { name: "Bleu TTP", value: "#2b7fff" },
  { name: "Indigo", value: "#6366f1" },
  { name: "Violet", value: "#8b5cf6" },
  { name: "Rose", value: "#ec4899" },
  { name: "Rouge", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Ambre", value: "#f59e0b" },
  { name: "Émeraude", value: "#10b981" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Bordeaux", value: "#7a2e2e" },
];

/** #rrggbb ou #rgb valide ? */
export function isHex(c: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim());
}

/** Luminance relative (0 = noir, 1 = blanc) — pour choisir un texte lisible dessus. */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const toLin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = toLin(parseInt(n.slice(0, 2), 16));
  const g = toLin(parseInt(n.slice(2, 4), 16));
  const b = toLin(parseInt(n.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Applique (ou retire si null/"") la couleur d'accent sur la racine. */
export function applyAccent(color: string | null): void {
  const el = document.documentElement;
  if (!color || !isHex(color)) {
    el.style.removeProperty("--primary");
    el.style.removeProperty("--primary-foreground");
    el.style.removeProperty("--ring");
    return;
  }
  const fg = luminance(color) > 0.55 ? "#18181b" : "#ffffff";
  el.style.setProperty("--primary", color);
  el.style.setProperty("--primary-foreground", fg);
  el.style.setProperty("--ring", color);
}

export function getAccent(): string {
  try {
    return localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

export function setAccent(color: string): void {
  try {
    if (color && isHex(color)) localStorage.setItem(KEY, color);
    else localStorage.removeItem(KEY);
  } catch {
    /* stockage indispo : on applique quand même en mémoire pour la session */
  }
  applyAccent(color || null);
}

/** À appeler au démarrage (avant le rendu) pour éviter tout flash de bleu. */
export function initAccent(): void {
  applyAccent(getAccent() || null);
  applyDarkStyle(getDarkStyle());
  // Thème clair/sombre mémorisé : posé AVANT le premier rendu (pas de flash blanc).
  document.documentElement.classList.toggle("dark", getThemePref());
}

// ── Thème clair/sombre mémorisé par appareil ──
const THEME_KEY = "ttp:theme";

export function getThemePref(): boolean {
  try {
    return localStorage.getItem(THEME_KEY) === "dark";
  } catch {
    return false;
  }
}

export function setThemePref(dark: boolean): void {
  try {
    if (dark) localStorage.setItem(THEME_KEY, "dark");
    else localStorage.removeItem(THEME_KEY);
  } catch {
    /* stockage indispo : le thème reste valable pour la session */
  }
}

// ── Style du thème sombre : « minuit » (défaut, façon Efferd) ou « classic » ──
// Classe `dark-classic` sur la racine : elle ne fait effet QU'EN mode sombre
// (règle `.dark.dark-classic` de index.css). Propre à cet appareil.
const DARK_KEY = "ttp:darkStyle";
export type DarkStyle = "minuit" | "classic";

export function getDarkStyle(): DarkStyle {
  try {
    return localStorage.getItem(DARK_KEY) === "classic" ? "classic" : "minuit";
  } catch {
    return "minuit";
  }
}

export function applyDarkStyle(style: DarkStyle): void {
  document.documentElement.classList.toggle("dark-classic", style === "classic");
}

export function setDarkStyle(style: DarkStyle): void {
  try {
    if (style === "classic") localStorage.setItem(DARK_KEY, "classic");
    else localStorage.removeItem(DARK_KEY);
  } catch {
    /* stockage indispo : appliqué pour la session */
  }
  applyDarkStyle(style);
}
