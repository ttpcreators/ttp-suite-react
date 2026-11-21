// ============================================================================
// haptics.ts : un petit « tic » du téléphone sur les actions qui comptent
// (demande de Marc, 19 nov. 2026) : tâche faite, étape de collab, suppression ou
// archivage, et un double tic sur une erreur. Pas sur tous les boutons.
// ----------------------------------------------------------------------------
// Android : navigator.vibrate. iPhone : Safari n'a pas de vibration pour les pages
// web ; depuis iOS 18, un interrupteur <input type="checkbox" switch> fait le tic
// d'iOS quand on le touche. On en pose un invisible et on le « touche » au moment
// de l'action (il faut être dans le geste de l'utilisateur : appeler haptic() AVANT
// le premier await). Sans iOS 18 ou si Apple retire ce comportement : rien ne se
// passe, sans erreur. Coupable dans Paramètres › Cet appareil › Vibrations.
// Rien sur ordinateur (souris).
// ============================================================================

export type HapticKind = "succes" | "retrait" | "erreur" | "nav";

export const HAPTICS_KEY = "ttp.vibrations";

/** Motifs Android (ms) : un tic net, un tic un peu plus long, un double tic sec. */
export const PATTERNS: Record<HapticKind, number | number[]> = { succes: 12, retrait: 18, erreur: [14, 70, 14], nav: 8 };

/** Deux actions à moins de 150 ms (ex. rond « Fait » puis statut) : un seul tic. */
export const DEDUPE_MS = 150;
/** Écart entre les deux tics d'une erreur sur iPhone. */
export const IOS_GAP_MS = 90;

export type HapticEnv = {
  /** Écran tactile (pas de vibration à la souris). */
  touch: boolean;
  ios: boolean;
  vibrate?: (p: number | number[]) => unknown;
  /** Le tic d'iOS (interrupteur invisible). */
  tick?: () => void;
  enabled: () => boolean;
  now: () => number;
  later: (fn: () => void, ms: number) => void;
};

/** Fonction haptic() pour un environnement donné (testable sans navigateur). */
export function createHaptics(env: HapticEnv): (kind: HapticKind) => boolean {
  let last = -Infinity;
  return (kind) => {
    if (!env.touch || !env.enabled()) return false;
    const t = env.now();
    if (t - last < DEDUPE_MS) return false;
    last = t;
    try {
      if (env.ios) {
        if (!env.tick) return false;
        env.tick();
        if (kind === "erreur") env.later(env.tick, IOS_GAP_MS);
        return true;
      }
      if (!env.vibrate) return false;
      env.vibrate(PATTERNS[kind]);
      return true;
    } catch {
      return false;
    }
  };
}

export function hapticsEnabled(): boolean {
  try {
    return localStorage.getItem(HAPTICS_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setHapticsEnabled(on: boolean): void {
  try {
    if (on) localStorage.removeItem(HAPTICS_KEY);
    else localStorage.setItem(HAPTICS_KEY, "off");
  } catch {
    /* stockage bloqué : réglage non retenu */
  }
}

/** Le tic d'iOS : un interrupteur invisible, touché puis retiré. */
function iosTick(): void {
  const label = document.createElement("label");
  label.setAttribute("aria-hidden", "true");
  label.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  label.appendChild(input);
  document.body.appendChild(label);
  label.click();
  label.remove();
}

let _haptic: ((k: HapticKind) => boolean) | null = null;

function browserEnv(): HapticEnv {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const ua = nav?.userAgent ?? "";
  const ios = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1);
  let touch = false;
  try {
    touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  } catch {
    touch = false;
  }
  return {
    touch,
    ios,
    vibrate: nav && typeof nav.vibrate === "function" ? (p) => nav.vibrate(p) : undefined,
    tick: typeof document !== "undefined" ? iosTick : undefined,
    enabled: hapticsEnabled,
    now: () => Date.now(),
    later: (fn, ms) => void setTimeout(fn, ms),
  };
}

/**
 * Élément de navigation touché (changement de page ou d'onglet), ou null : un bouton de la
 * barre d'onglets ou du menu (`nav`), un onglet (`role="tab"`), ou un élément marqué
 * `data-haptic="nav"` (retour, ligne qui ouvre une page). Rien si c'est déjà la page ou
 * l'onglet affiché, ou si c'est désactivé. Pur sur l'élément : testé par haptics.test.ts.
 */
export function navTarget(el: Element | null): Element | null {
  const t = el?.closest?.('nav button, nav a, [role="tab"], [data-haptic="nav"]') ?? null;
  if (!t) return null;
  if (t.getAttribute("aria-current") === "page" || t.getAttribute("aria-selected") === "true") return null;
  if (t.hasAttribute("disabled") || t.getAttribute("aria-disabled") === "true") return null;
  return t;
}

let navInstalled = false;
/** Un tic léger à chaque changement de page ou d'onglet (une écoute pour toute l'app). */
export function installNavHaptics(): void {
  if (navInstalled || typeof document === "undefined") return;
  navInstalled = true;
  // Phase de capture : le tic part dans le geste, avant que la page change.
  document.addEventListener("click", (e) => {
    if (navTarget(e.target as Element | null)) haptic("nav");
  }, { capture: true });
}

/** Un tic sur l'action en cours. Sans effet hors téléphone ou si c'est coupé. */
export function haptic(kind: HapticKind): void {
  if (typeof window === "undefined") return;
  _haptic ??= createHaptics(browserEnv());
  _haptic(kind);
}
