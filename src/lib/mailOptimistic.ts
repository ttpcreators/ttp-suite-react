/*
 * Page Mails : règles de l'affichage « tout de suite » (logique pure, testée).
 *
 * Un clic (lu, non lu, archiver, supprimer) change la liste AVANT la réponse de Gmail :
 * c'est un « changement en attente ». Il est :
 *   - retiré (retour arrière) si Gmail refuse ;
 *   - gardé tant qu'une liste du serveur DEMANDÉE APRÈS la confirmation ne le montre pas
 *     (Gmail met quelques secondes à se mettre à jour : une actualisation partie avant le
 *     clic revient avec l'ancien état) ;
 *   - oublié au bout de 90 s : la liste du serveur fait alors foi (ex. nouveau message).
 *
 * Même principe pour le compte des non lus de chaque boîte (« coup d'œil » du serveur,
 * toutes les minutes) : chaque clic ajoute un écart (-1 lu, +1 non lu), oublié quand un
 * coup d'œil parti assez longtemps après la confirmation le compte déjà.
 */

export type Box = "partnerships" | "talent";
export type Folder = "inbox" | "sent";

/** Ce que l'app a besoin de savoir d'un fil de la liste. */
export type OvRow = {
  threadId: string; box: Box; unread: boolean; ts: number; direction: "in" | "out"; count: number; snippet: string; archived?: boolean;
};

/** Changement affiché avant la confirmation du serveur (retiré s'il n'est pas confirmé). */
export type Override = {
  unread?: boolean; hidden?: "archive" | "trash"; at: number; done?: number;
  /** Réponse envoyée depuis l'app : le fil s'affiche « Répondu » tout de suite, avant que Gmail l'ait indexée. */
  reply?: { ts: number; snippet: string };
};

/** Délai après la confirmation au-delà duquel une liste demandée reflète le changement. */
export const SETTLE_MS = 3_000;
/** Délai après lequel une liste du serveur fait foi, même si elle contredit l'app. */
export const OV_TRUST_MS = 90_000;

export const rowKey = (t: { box: Box; threadId: string }) => `${t.box}:${t.threadId}`;

/** Le fil tel qu'affiché : changement en attente appliqué, ou null s'il est retiré (archivé, supprimé). */
export function applyOverride<T extends OvRow>(t: T, o: Override | undefined): T | null {
  if (!o) return t;
  if (o.hidden) return null;
  let r = o.unread !== undefined && o.unread !== t.unread ? { ...t, unread: o.unread } : t;
  // Notre réponse est plus récente que ce que la liste connaît : elle devient le dernier message.
  // Un message reçu APRÈS notre réponse (t.ts plus récent) reprend la main.
  if (o.reply && t.ts <= o.reply.ts) {
    r = {
      ...r, direction: "out", snippet: o.reply.snippet, ts: o.reply.ts, unread: false,
      count: t.direction === "out" && t.ts >= o.reply.ts - 5_000 ? t.count : t.count + 1,
    };
  }
  return r;
}

/** La liste fraîche du serveur montre-t-elle déjà ce changement ? (`row` absent = fil absent de la liste) */
export function overrideAgrees(o: Override, row: OvRow | undefined, folder: Folder): boolean {
  if (o.reply) return !row || row.ts > o.reply.ts || (row.direction === "out" && row.ts >= o.reply.ts - 120_000);
  if (o.hidden) return !row || (folder === "inbox" && o.hidden === "archive" && row.archived === true);
  return !row || row.unread === o.unread;
}

/**
 * Changements à garder après une liste fraîche demandée à `started`. Renvoie la même Map
 * si rien ne change (pas de rendu inutile). Un changement pas encore confirmé (`done`
 * absent) est toujours gardé : c'est lui qui empêche une actualisation de remontrer
 * l'ancien état pendant l'écriture dans Gmail.
 */
export function pruneOverrides(
  m: Map<string, Override>, fresh: Map<string, OvRow>, folder: Folder, started: number,
): Map<string, Override> {
  let n: Map<string, Override> | null = null;
  for (const [k, o] of m) {
    if (!o.done || started < o.done + SETTLE_MS) continue;
    const row = fresh.get(k);
    if (!row && folder !== "inbox") continue; // fil d'un autre dossier : jugé par sa propre liste
    if (overrideAgrees(o, row, folder) || started > o.done + OV_TRUST_MS) {
      n ??= new Map(m);
      n.delete(k);
    }
  }
  return n ?? m;
}

// ── Compte des non lus par boîte ─────────────────────────────────────────────

/** Écart au compte du serveur dû à un clic, en attendant que le coup d'œil le voie. */
export type UnreadAdj = { box: Box; delta: number; done?: number };

/**
 * Effet d'un changement sur le nombre de non lus de la boîte de réception, d'après l'état
 * affiché avant le clic : -1 (un non lu lu, archivé ou supprimé), +1 (remis non lu), 0 sinon.
 * Fil inconnu ou hors boîte de réception : 0 (le serveur ne le compte pas).
 */
export function unreadDelta(before: { unread: boolean; archived?: boolean } | null | undefined, next: { unread?: boolean; hidden?: string }): -1 | 0 | 1 {
  if (!before || before.archived) return 0;
  if (next.hidden) return before.unread ? -1 : 0;
  if (next.unread === false) return before.unread ? -1 : 0;
  if (next.unread === true) return before.unread ? 0 : 1;
  return 0;
}

/** Compte du serveur corrigé des clics pas encore vus par lui (jamais négatif ; boîtes inconnues absentes). */
export function adjustUnread(server: Partial<Record<Box, number>>, adjs: Iterable<UnreadAdj>): Partial<Record<Box, number>> {
  const out: Partial<Record<Box, number>> = { ...server };
  for (const a of adjs) {
    const v = out[a.box];
    if (v !== undefined) out[a.box] = v + a.delta;
  }
  for (const b of Object.keys(out) as Box[]) out[b] = Math.max(0, out[b] ?? 0);
  return out;
}

/** Écarts encore utiles après un coup d'œil parti à `peekStarted` (même Map si rien ne change). */
export function settleAdjs(adjs: Map<string, UnreadAdj>, peekStarted: number): Map<string, UnreadAdj> {
  let n: Map<string, UnreadAdj> | null = null;
  for (const [k, a] of adjs) {
    if (a.done && peekStarted >= a.done + SETTLE_MS) {
      n ??= new Map(adjs);
      n.delete(k);
    }
  }
  return n ?? adjs;
}

/**
 * « Annuler » réussi : l'écart du clic d'origine disparaît s'il attendait encore ; s'il a
 * déjà été compté par le serveur, un écart inverse (confirmé) prend sa place.
 */
export function revertAdj(adjs: Map<string, UnreadAdj>, id: string, undoId: string, original: UnreadAdj | null, now: number): Map<string, UnreadAdj> {
  const n = new Map(adjs);
  if (n.has(id)) n.delete(id);
  else if (original && original.delta) n.set(undoId, { box: original.box, delta: -original.delta, done: now });
  return n;
}

// ── Textes ───────────────────────────────────────────────────────────────────

const BOX_NAME: Record<Box, string> = { partnerships: "partnerships@", talent: "talent@" };

/** Fenêtre de confirmation avant de supprimer un fil (corbeille Gmail, jamais d'effacement immédiat). */
export function trashConfirmText(box: Box): { title: string; message: string } {
  return {
    title: "Supprimer ce mail ?",
    message: `Il part dans la corbeille de Gmail (boîte ${BOX_NAME[box]}) et sera effacé définitivement par Gmail au bout de 30 jours.`,
  };
}
