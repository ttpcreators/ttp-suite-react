import { useEffect } from "react";

/**
 * Pastille sur l'icône de l'app (écran d'accueil, Dock) et notifications déjà
 * affichées, comme les grandes apps :
 *   • la pastille suit le compteur de l'app (cloche côté agence, mails non vus côté
 *     créateur) ; le service worker l'augmente à chaque push reçu app fermée, et
 *     l'app la remet au bon chiffre dès qu'elle revient au premier plan ;
 *   • ouvrir Mails retire les notifications de mails déjà lues à l'écran.
 */

type BadgeNav = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

/** Nombre affiché sur l'icône (0 = pas de pastille), transmis aussi au service worker. */
export function setAppBadgeCount(n: number): void {
  if (typeof navigator === "undefined") return;
  const count = Math.max(0, Math.floor(n || 0));
  const nav = navigator as BadgeNav;
  try {
    if (nav.setAppBadge) (count ? nav.setAppBadge(count) : nav.clearAppBadge?.())?.catch(() => {});
    navigator.serviceWorker?.controller?.postMessage({ type: "ttp-badge", count });
  } catch {
    /* pastille non prise en charge */
  }
}

/** Garde la pastille égale à `count`, et la remet à jour quand l'app revient au premier plan. */
export function useAppBadge(count: number, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    setAppBadgeCount(count);
    const onShow = () => {
      if (document.visibilityState === "visible") setAppBadgeCount(count);
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [count, enabled]);
}

/** Ferme les notifications de mails affichées (tag « mail:… »). */
export async function closeMailNotifications(): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const list = (await reg?.getNotifications()) ?? [];
    for (const n of list) if (n.tag.startsWith("mail:")) n.close();
  } catch {
    /* notifications non prises en charge */
  }
}

/** Tant que `active` (page Mails affichée) : retire les notifications de mails, à l'ouverture et au retour au premier plan. */
export function useCloseMailNotifications(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const run = () => {
      if (document.visibilityState === "visible") void closeMailNotifications();
    };
    run();
    document.addEventListener("visibilitychange", run);
    return () => document.removeEventListener("visibilitychange", run);
  }, [active]);
}
