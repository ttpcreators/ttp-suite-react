/**
 * Ce que montre chaque onglet du panneau de notifications.
 *
 * Une notification lue a fini son travail : elle ne s'affiche plus (ni dans
 * « Non lues », ni dans « À traiter »). Seules les archivées restent
 * consultables, dans leur onglet.
 */
export type NotifTab = "unread" | "todo" | "archived";

export type NotifTabItem = { unread?: boolean; archived?: boolean; actionable?: boolean };

export function notifsVisibles<T extends NotifTabItem>(items: readonly T[], tab: NotifTab): T[] {
  switch (tab) {
    case "archived":
      return items.filter((n) => n.archived);
    case "todo":
      return items.filter((n) => !n.archived && n.unread && n.actionable);
    default:
      return items.filter((n) => !n.archived && n.unread);
  }
}
