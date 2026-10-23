/*
 * Repères « nouveau » entre l'agence et les créateurs (table `activity_events`, écrite
 * par des déclencheurs SQL : sql/2026-10-23-notifications-nouveautes.sql). Logique PURE,
 * testée par activityEvents.test.ts ; la lecture et le « marquer lu » sont dans
 * useActivityEvents.ts.
 *
 * Un repère = un objet (tâche, idée, brief, fil de mail) qui a reçu du nouveau de
 * l'autre côté. Il reste jusqu'à l'ouverture de l'objet.
 */

export type ActivityObject = "todo" | "idea" | "brief" | "mail";
export type ActivityWhat = "new" | "text" | "description" | "subtask" | "progress" | "update" | "note" | "status";

export type ActivityEvent = {
  id: string;
  updated_at: string;
  target: "creator" | "agency";
  creator: string;
  object_type: ActivityObject;
  object_id: string;
  object_title: string | null;
  what: ActivityWhat | string;
  actor: string | null;
  excerpt: string | null;
  count: number;
};

/** Clé d'un objet (« todo:<id> »). */
export const activityKey = (type: string, id: string) => `${type}:${id}`;

/** Clés des objets qui ont du nouveau (non lus). */
export function unreadKeys(events: readonly Pick<ActivityEvent, "object_type" | "object_id">[]): Set<string> {
  return new Set(events.map((e) => activityKey(e.object_type, e.object_id)));
}

/** Page du menu où vit chaque objet : agence (id de vue) ou créateur (onglet). */
const AGENCY_PAGE: Record<ActivityObject, string> = { todo: "todo", idea: "ideas", brief: "briefs", mail: "mails" };
const CREATOR_TAB: Record<ActivityObject, string> = { todo: "todo", idea: "ideas", brief: "missions", mail: "mails" };

export function activityPage(type: string, side: "agency" | "creator"): string | null {
  const map = side === "agency" ? AGENCY_PAGE : CREATOR_TAB;
  return (map as Record<string, string>)[type] ?? null;
}

/** Nombre d'objets avec du nouveau, par page (un objet compte une fois). */
export function countsByPage(events: readonly Pick<ActivityEvent, "object_type" | "object_id">[], side: "agency" | "creator"): Record<string, number> {
  const seen = new Set<string>();
  const out: Record<string, number> = {};
  for (const e of events) {
    const k = activityKey(e.object_type, e.object_id);
    const page = activityPage(e.object_type, side);
    if (!page || seen.has(k)) continue;
    seen.add(k);
    out[page] = (out[page] ?? 0) + 1;
  }
  return out;
}

/** Ce qui a changé, en mots simples (« Nouvelle sous-tâche »). */
const WHAT_FR: Record<string, string> = {
  new: "Nouveau",
  text: "Texte modifié",
  description: "Description modifiée",
  subtask: "Nouvelle sous-tâche",
  progress: "Nouveau message",
  update: "Mis à jour",
  note: "Nouvelle remarque",
  status: "Statut modifié",
};
export function whatLabel(what: string): string {
  return WHAT_FR[what] ?? "Du nouveau";
}

/**
 * Texte d'une notification push pour un changement fait dans l'app : « Nouvelle
 * sous-tâche · « Tournage Gymshark » » (le titre est coupé à 45 caractères).
 */
export function changeText(what: ActivityWhat, title: string): string {
  const t = title.trim();
  const short = t.length > 45 ? `${t.slice(0, 44).trimEnd()}…` : t;
  return short ? `${whatLabel(what)} · « ${short} »` : whatLabel(what);
}

/**
 * Anti-répétition des push : un même objet et un même changement ne repartent pas
 * avant `windowMs` (10 min). `last` = dernier envoi par clé ; renvoie la nouvelle carte
 * si l'envoi est autorisé, sinon null.
 */
export function throttlePush(last: Record<string, number>, key: string, now: number, windowMs = 10 * 60_000): Record<string, number> | null {
  const prev = last[key];
  if (prev !== undefined && now - prev < windowMs) return null;
  const next: Record<string, number> = {};
  for (const [k, t] of Object.entries(last)) if (now - t < windowMs) next[k] = t;
  next[key] = now;
  return next;
}
