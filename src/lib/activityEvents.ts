/*
 * Repères « nouveau » entre l'agence et les créateurs (table `activity_events`, écrite
 * par des déclencheurs SQL : sql/2026-10-23-notifications-nouveautes.sql). Logique PURE,
 * testée par activityEvents.test.ts ; la lecture et le « marquer lu » sont dans
 * useActivityEvents.ts.
 *
 * Un repère = un objet (tâche, idée, brief, fil de mail) qui a reçu du nouveau de
 * l'autre côté. Il reste jusqu'à l'ouverture de l'objet.
 *
 * Vague 1 (SQL 2026-11-27, pas encore lancé : rien de neuf n'arrive avant) : côté agence,
 * « document » = un dépôt du créateur (contenu, facture, stats), « creator » = ses infos
 * modifiées (le détail ne cite que les noms des champs), « done » = il a terminé une tâche
 * que l'agence lui demande.
 */

export type ActivityObject = "todo" | "idea" | "brief" | "mail" | "document" | "creator";
export type ActivityWhat = "new" | "text" | "description" | "subtask" | "progress" | "update" | "note" | "status" | "done";

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

/**
 * Retire les repères qu'on vient de marquer lus sur cet appareil (clé → heure du « lu »).
 * Une lecture partie AVANT le « marquer lu » peut encore les renvoyer : sans ce filtre, le
 * point « nouveau » réapparaît. Un repère mis à jour APRÈS (nouveau changement) reste.
 */
export function dropReadLocally<T extends Pick<ActivityEvent, "object_type" | "object_id" | "updated_at">>(events: readonly T[], readAt: ReadonlyMap<string, number>): T[] {
  if (!readAt.size) return [...events];
  return events.filter((e) => {
    const at = readAt.get(activityKey(e.object_type, e.object_id));
    if (at === undefined) return true;
    const t = Date.parse(e.updated_at);
    return Number.isFinite(t) && t > at;
  });
}

/** Page du menu où vit chaque objet : agence (id de vue) ou créateur (onglet). */
const AGENCY_PAGE: Record<ActivityObject, string> = { todo: "todo", idea: "ideas", brief: "briefs", mail: "mails", document: "documents", creator: "roster" };
const CREATOR_TAB: Record<ActivityObject, string> = { todo: "todo", idea: "ideas", brief: "missions", mail: "mails", document: "documents", creator: "infos" };

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

/**
 * Objets encore ouverts, par type (ids) : une tâche pas faite, un brief pas terminé, une
 * idée qui existe. Un type absent de la carte n'est pas filtré (fils de mail…).
 */
export type OpenObjects = Partial<Record<ActivityObject, ReadonlySet<string>>>;

/**
 * Garde les repères dont l'objet est encore ouvert. Sans ce filtre, la pastille compte une
 * tâche faite ou un brief terminé que la liste ne montre pas par défaut : une pastille sans
 * rien à voir. `open` null (listes pas encore lues) : tout est gardé.
 */
export function keepOpen<T extends Pick<ActivityEvent, "object_type" | "object_id">>(events: readonly T[], open: OpenObjects | null): T[] {
  if (!open) return [...events];
  return events.filter((e) => {
    const ids = (open as Record<string, ReadonlySet<string> | undefined>)[e.object_type];
    return !ids || ids.has(e.object_id);
  });
}

/** Mêmes objets ouverts (évite un nouveau rendu quand une tâche change sans s'ouvrir ni se fermer). */
export function sameOpenObjects(a: OpenObjects | null, b: OpenObjects | null): boolean {
  if (!a || !b) return a === b;
  const types = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<ActivityObject>;
  for (const k of types) {
    const x = a[k];
    const y = b[k];
    if (!x || !y) {
      if (x !== y) return false;
      continue;
    }
    if (x.size !== y.size) return false;
    for (const id of x) if (!y.has(id)) return false;
  }
  return true;
}

/** Repères « infos modifiées » d'un créateur (côté agence), retrouvés par son nom ou l'id de sa fiche. */
export function infosEvents<T extends Pick<ActivityEvent, "object_type" | "object_id" | "creator">>(events: readonly T[], name: string, id?: string | null): T[] {
  const key = name.trim().toLowerCase();
  return events.filter((e) => e.object_type === "creator" && ((!!id && e.object_id === id) || (e.creator ?? "").trim().toLowerCase() === key));
}

/** Noms lisibles des infos modifiées (le repère ne garde que les noms des champs, jamais les valeurs). */
const CHAMP_FR: Record<string, string> = {
  address: "adresse",
  ville: "ville",
  siren: "SIREN",
  email: "email",
  email_pro: "email pro",
  phone: "téléphone",
  birth: "date de naissance",
  instagram: "Instagram",
  tiktok: "TikTok",
};
export function champsModifies(excerpts: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const ex of excerpts) {
    for (const raw of (ex ?? "").split(/[,;\n]/)) {
      const k = raw.trim();
      if (!k) continue;
      const label = CHAMP_FR[k.toLowerCase()] ?? k;
      if (!out.includes(label)) out.push(label);
    }
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
  done: "Terminée",
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
