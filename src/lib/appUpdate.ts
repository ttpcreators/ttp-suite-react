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
 *   3. si un fichier manque quand même, on recharge en silence (écran de chargement).
 */
declare const __APP_VERSION__: string;
const CURRENT = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
const GAP = 60_000;

let stale = false;
let remote = "";
let lastCheck = 0;
const RELOADED_KEY = "ttp:update-reloaded";
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
  const onVisible = () => { if (document.visibilityState === "visible") void checkForUpdate(); };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  window.setInterval(() => void checkForUpdate(true), 5 * 60_000);
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
