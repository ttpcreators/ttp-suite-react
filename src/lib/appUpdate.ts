import { isChunkError, recoverStaleApp } from "@/components/ErrorBoundary";

/**
 * Mises en ligne sans écran d'erreur. Chaque mise en ligne remplace les fichiers de
 * l'app : une page restée ouverte qui ouvre ensuite une autre page demandait un
 * ancien fichier (supprimé) → écran « Mise à jour » ou d'erreur une fraction de
 * seconde, puis rechargement. Désormais :
 *   1. l'app regarde régulièrement (retour sur l'onglet, toutes les 5 min, à chaque
 *      changement de page) si une nouvelle version est en ligne (`version.json`) ;
 *   2. si oui, la page suivante s'ouvre en rechargeant l'app (sur la bonne page,
 *      mémorisée), au lieu de demander un fichier qui n'existe plus ;
 *   3. si un fichier manque quand même, on recharge en silence (écran de chargement) ;
 *   4. (22 nov. 2026, demande de Marc) sur téléphone, l'app installée reste en mémoire :
 *      la nouvelle version s'installe toute seule quand on revient dans l'app ou pendant
 *      qu'elle est en arrière-plan, sans la fermer. Jamais pendant une saisie, une
 *      fenêtre ouverte, un envoi en attente ou une modif non enregistrée (holdUpdate).
 */
declare const __APP_VERSION__: string;
const CURRENT = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
const GAP = 60_000;

let stale = false;
let remote = "";
let lastCheck = 0;
const RELOADED_KEY = "ttp:update-reloaded";
const DONE_KEY = "ttp:update-done";

// ── Rechargement automatique (règle pure, testée par appUpdate.test.ts) ──────
export type ReloadState = { stale: boolean; editing: boolean; dialog: boolean; holds: number };

/** Recharger maintenant ? Nouvelle version connue, et rien en cours qu'on perdrait. */
export function shouldReloadNow(s: ReloadState): boolean {
  return s.stale && !s.editing && !s.dialog && s.holds === 0;
}

const holds = new Set<symbol>();
/**
 * Empêche le rechargement automatique tant que quelque chose est en cours (envoi en
 * attente, modif non enregistrée). Renvoie la fonction qui lève le blocage.
 */
export function holdUpdate(): () => void {
  const k = Symbol("hold");
  holds.add(k);
  return () => void holds.delete(k);
}

function currentState(): ReloadState {
  const a = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
  const editing = !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  const dialog = typeof document !== "undefined" && !!document.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"]');
  return { stale, editing, dialog, holds: holds.size };
}

/** Le service worker aussi : la nouvelle version de sw.js est cherchée au même moment. */
function updateServiceWorker(): void {
  try {
    void navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
  } catch {
    /* pas de service worker : rien à faire */
  }
}

/** Nouvelle version en ligne et rien en cours : on recharge (une fois par version). */
async function autoReload(force: boolean): Promise<void> {
  await checkForUpdate(force);
  if (!shouldReloadNow(currentState())) return;
  try {
    sessionStorage.setItem(DONE_KEY, remote);
  } catch {
    /* stockage bloqué : pas de message après le rechargement */
  }
  reloadOnce();
}
const never = <T,>() => new Promise<T>(() => {});

export async function checkForUpdate(force = false): Promise<boolean> {
  if (CURRENT === "dev" || stale) return stale;
  if (!force && Date.now() - lastCheck < GAP) return stale;
  lastCheck = Date.now();
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: "no-store" });
    if (r.ok) {
      const j = (await r.json()) as { v?: string };
      if (j?.v && j.v !== CURRENT) {
        stale = true;
        remote = j.v;
      }
    }
  } catch {
    /* hors ligne : on réessaiera */
  }
  return stale;
}

/** À appeler une fois au démarrage. */
export function startUpdateWatch(): void {
  if (CURRENT === "dev") return;
  // Retour dans l'app (téléphone ou onglet) : on vérifie tout de suite et on installe.
  // Départ en arrière-plan : si une version est déjà connue, on installe sans qu'on le voie.
  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      updateServiceWorker();
      void autoReload(true);
    } else if (stale) void autoReload(false);
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", () => void checkForUpdate());
  window.addEventListener("pageshow", (e) => { if ((e as PageTransitionEvent).persisted) void autoReload(true); });
  // Toutes les 5 minutes : si l'app est en arrière-plan, la nouvelle version s'installe.
  window.setInterval(() => void checkForUpdate(true).then(() => { if (document.visibilityState === "hidden") void autoReload(false); }), 5 * 60_000);
}

/** Après un rechargement automatique : la version installée (pour un petit message). */
export function takeUpdateDone(): boolean {
  try {
    const v = sessionStorage.getItem(DONE_KEY);
    if (!v) return false;
    sessionStorage.removeItem(DONE_KEY);
    return v === CURRENT;
  } catch {
    return false;
  }
}

/**
 * Recharge pour la nouvelle version, UNE fois par version : si le navigateur ressert
 * encore l'ancienne page quelques minutes (cache de GitHub Pages), on ne boucle pas.
 */
function reloadOnce(): boolean {
  try {
    if (sessionStorage.getItem(RELOADED_KEY) === remote) return false;
    sessionStorage.setItem(RELOADED_KEY, remote);
  } catch {
    return false;
  }
  location.reload();
  return true;
}

/**
 * Enveloppe d'un import de page (React.lazy) : nouvelle version connue → on recharge
 * au lieu d'importer ; fichier introuvable → rechargement silencieux (le chargement
 * reste affiché, jamais un message d'erreur).
 */
export function lazyImport<T>(load: () => Promise<T>): () => Promise<T> {
  return () => {
    void checkForUpdate();
    if (stale && reloadOnce()) return never<T>();
    return load().catch((e: unknown) => {
      if (isChunkError(e) && recoverStaleApp()) return never<T>();
      throw e;
    });
  };
}
