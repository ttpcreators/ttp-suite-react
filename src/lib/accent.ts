/**
 * Couleur d'accent personnalisable : la variable `--accent` (que `--primary` et
 * `--ring` relisent). On pose la couleur EN LIGNE sur `document.documentElement`
 * → l'inline gagne sur les règles de thème de la feuille de style, donc le
 * changement marche dans les trois thèmes. Le texte posé dessus (`--on-accent`)
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

/**
 * Accents EN DÉGRADÉ (valeur « #a,#b ») : les boutons pleins passent en dégradé
 * de deux couleurs (classe `accent-grad` sur la racine, voir index.css) ; le
 * texte et les liens prennent la couleur médiane. Toutes assez soutenues pour
 * un texte blanc lisible.
 */
export const ACCENT_GRADIENTS: AccentPreset[] = [
  { name: "Aurore", value: "#ec4899,#8b5cf6" },
  { name: "Océan", value: "#2b7fff,#06b6d4" },
  { name: "Crépuscule", value: "#f97316,#db2777" },
  { name: "Lagon", value: "#10b981,#2b7fff" },
  { name: "Nuit", value: "#6366f1,#a855f7" },
];

/** #rrggbb ou #rgb valide ? */
export function isHex(c: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim());
}

/** Accent en dégradé (« #a,#b ») → les deux couleurs, sinon null. */
export function parseGradient(v: string | null | undefined): [string, string] | null {
  const parts = (v ?? "").split(",").map((x) => x.trim());
  return parts.length === 2 && isHex(parts[0]) && isHex(parts[1]) ? [parts[0], parts[1]] : null;
}

/** Valeur d'accent valide (couleur unie ou dégradé) ? */
export function isAccent(v: string): boolean {
  return isHex(v) || parseGradient(v) !== null;
}

function toRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

/** Couleur à mi-chemin entre deux couleurs (texte, liens, anneaux d'un dégradé). */
function mixHex(a: string, b: string): string {
  const [r1, g1, b1] = toRgb(a);
  const [r2, g2, b2] = toRgb(b);
  return "#" + [(r1 + r2) / 2, (g1 + g2) / 2, (b1 + b2) / 2].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
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
  const grad = parseGradient(color);
  el.classList.toggle("accent-grad", grad !== null);
  if (grad) {
    el.style.setProperty("--accent-a", grad[0]);
    el.style.setProperty("--accent-b", grad[1]);
  } else {
    el.style.removeProperty("--accent-a");
    el.style.removeProperty("--accent-b");
  }
  const solid = grad ? mixHex(grad[0], grad[1]) : color;
  if (!solid || !isHex(solid)) {
    el.style.removeProperty("--accent");
    el.style.removeProperty("--on-accent");
    return;
  }
  // Dégradé : texte sombre seulement si les DEUX bouts sont clairs.
  const light = grad ? Math.min(luminance(grad[0]), luminance(grad[1])) > 0.55 : luminance(solid) > 0.55;
  el.style.setProperty("--accent", solid);
  el.style.setProperty("--on-accent", light ? "#18181b" : "#ffffff");
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
    if (color && isAccent(color)) localStorage.setItem(KEY, color);
    else localStorage.removeItem(KEY);
  } catch {
    /* stockage indispo : on applique quand même en mémoire pour la session */
  }
  applyAccent(color || null);
}

/** À appeler au démarrage (avant le rendu) pour éviter tout flash de bleu. */
export function initAccent(): void {
  applyAccent(getAccent() || null);
  // Thème mémorisé : posé AVANT le premier rendu (pas de flash blanc).
  applyTheme(resolveTheme(getThemeChoice()));
  // L'ancien réglage « style sombre » (Minuit / Classique) n'existe plus.
  try {
    localStorage.removeItem("ttp:darkStyle");
  } catch {
    /* stockage indispo */
  }
}

// ── Thème mémorisé par appareil : Studio (par défaut), Clair, Verre, Noir, ou Auto (suit l'appareil) ──
const THEME_KEY = "ttp:theme";
export type ThemeChoice = "studio" | "clair" | "verre" | "noir" | "auto";
export type ResolvedTheme = Exclude<ThemeChoice, "auto">;

export const THEME_CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "studio", label: "Studio" },
  { value: "clair", label: "Clair" },
  { value: "verre", label: "Verre" },
  { value: "noir", label: "Noir" },
  { value: "auto", label: "Auto" },
];

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    // « dark » = l'ancien réglage sombre, devenu Noir.
    if (v === "dark" || v === "noir") return "noir";
    if (v === "clair" || v === "verre" || v === "auto") return v;
    // Rien d'enregistré : Studio, le thème de la refonte (2026-10-30).
    return "studio";
  } catch {
    return "studio";
  }
}

/** Auto : Noir si l'appareil est en sombre, Studio sinon. */
export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice !== "auto") return choice;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "noir" : "studio";
  } catch {
    return "studio";
  }
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === "studio") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* stockage indispo : le thème reste valable pour la session */
  }
}

/** Style de barre d'état lu au lancement (iPhone : l'app installée ne le relit qu'au prochain lancement). */
let launchBarStyle: string | null = null;
let relaunchToldFor: string | null = null;
const isStandalone = () =>
  (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true;

/** Pose le thème sur <html> : attribut data-theme, classe .dark (variante Tailwind) et barre d'état. */
export function applyTheme(theme: ResolvedTheme): void {
  const el = document.documentElement;
  const dark = theme === "noir";
  const bar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  launchBarStyle ??= bar?.getAttribute("content") ?? "default";
  const wanted = dark ? "black-translucent" : "default";
  // App installée sur iPhone : passer de clair à noir (ou l'inverse) ne change le haut de
  // l'écran (heure, batterie) qu'au prochain lancement. On le dit une fois, clairement.
  if (wanted !== launchBarStyle && relaunchToldFor !== wanted && isStandalone()) {
    relaunchToldFor = wanted;
    window.setTimeout(() => void import("@/components/ui/toast").then(({ toast }) =>
      toast("Ferme puis rouvre l'app : le haut de l'écran prendra aussi ce thème.", { duration: 7000 })), 300);
  }
  el.dataset.theme = theme;
  el.classList.toggle("dark", dark);
  // Couleur de la barre d'état (iPhone : appliquée au prochain lancement de l'app installée).
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#000000" : theme === "verre" ? "#edf0f7" : theme === "studio" ? "#f1f1f3" : "#f5f5f7");
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute("content", dark ? "black-translucent" : "default");
}
