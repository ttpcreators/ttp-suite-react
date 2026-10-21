import { scoreMatch } from "./commandPalette";

/*
 * Paramètres : logique PURE de la colonne de gauche (entrées groupées, recherche
 * « Chercher un réglage », ancres). Testable sous Node ; la vue (views/Parametres.tsx)
 * ne fait qu'afficher.
 */

/** Une carte de réglages (ex : « Résumé du matin »), retrouvable par son titre ou ses mots-clés. */
export type SettingsSection = { title: string; keywords?: readonly string[] };

/** Une entrée de la colonne de gauche : un volet de droite qui regroupe une ou plusieurs cartes. */
export type SettingsEntry = {
  id: string;
  label: string;
  group: string;
  keywords?: readonly string[];
  sections: readonly SettingsSection[];
};

/** Résultat de recherche : l'entrée, et la carte qui a fait mouche (null = l'entrée elle-même). */
export type SettingsHit<E extends SettingsEntry = SettingsEntry> = { entry: E; section: SettingsSection | null; score: number };

/** Ancre d'une carte à partir de son titre (« Résumé du matin » → « reglage-resume-du-matin »). */
export const sectionAnchor = (title: string) =>
  "reglage-" + title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Entrées qui correspondent à la requête, dans l'ordre d'origine (pour garder les
 * groupes). Requête vide = tout, sans carte ciblée. Une carte n'est retenue que si
 * elle correspond MIEUX que l'entrée elle-même (« matin » → Résumés › Résumé du matin).
 */
export function searchSettings<E extends SettingsEntry>(entries: readonly E[], query: string): SettingsHit<E>[] {
  const q = query.trim();
  if (!q) return entries.map((entry) => ({ entry, section: null, score: 1 }));
  const hits: SettingsHit<E>[] = [];
  for (const entry of entries) {
    const own = scoreMatch(q, entry.label, entry.keywords);
    let best: SettingsSection | null = null;
    let bestScore = 0;
    for (const s of entry.sections) {
      const sc = scoreMatch(q, s.title, s.keywords);
      if (sc > bestScore) {
        best = s;
        bestScore = sc;
      }
    }
    const score = Math.max(own, bestScore);
    if (score <= 0) continue;
    hits.push({ entry, section: bestScore > own ? best : null, score });
  }
  return hits;
}

/** Meilleur résultat (Entrée dans le champ de recherche) : plus haut score, premier à égalité. */
export function bestHit<E extends SettingsEntry>(hits: readonly SettingsHit<E>[]): SettingsHit<E> | null {
  let best: SettingsHit<E> | null = null;
  for (const h of hits) if (!best || h.score > best.score) best = h;
  return best;
}

/** Regroupe les résultats sous leur en-tête (« Général », « Notifications »…), ordre d'apparition. */
export function groupHits<E extends SettingsEntry>(hits: readonly SettingsHit<E>[]): { group: string; hits: SettingsHit<E>[] }[] {
  const out: { group: string; hits: SettingsHit<E>[] }[] = [];
  for (const h of hits) {
    const g = out.find((x) => x.group === h.entry.group);
    if (g) g.hits.push(h);
    else out.push({ group: h.entry.group, hits: [h] });
  }
  return out;
}

/**
 * Entrée à ouvrir pour une cible venue d'ailleurs (sous-page de navigation, ancienne
 * ancre « reglage-… ») : id d'entrée, ancre d'une carte, ou titre de carte. Sinon null.
 */
export function entryForTarget<E extends SettingsEntry>(entries: readonly E[], target: string | null | undefined): E | null {
  const t = (target ?? "").trim().replace(/^#/, "");
  if (!t) return null;
  const byId = entries.find((e) => e.id === t);
  if (byId) return byId;
  const anchor = t.startsWith("reglage-") ? t : sectionAnchor(t);
  return entries.find((e) => sectionAnchor(e.label) === anchor || e.sections.some((s) => sectionAnchor(s.title) === anchor)) ?? null;
}

/*
 * Onglets « dossier » de Paramètres : un onglet par groupe (« Général », « Notifications »…),
 * qui empile ses entrées. Chaque entrée a son ancre de bloc (« reglage-volet-<id> »), à côté
 * des ancres de cartes (« reglage-<titre> »).
 */

/** Id stable d'un onglet à partir du nom de groupe (« Prospection et Claude » → « prospection-et-claude »). */
export const groupTabId = (group: string) => sectionAnchor(group).replace(/^reglage-/, "");

/** Ancre du bloc d'une entrée dans son onglet. */
export const entryAnchor = (entryId: string) => `reglage-volet-${entryId}`;

/** Les onglets, un par groupe, dans l'ordre d'apparition des entrées. */
export function settingsTabs(entries: readonly SettingsEntry[]): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const e of entries) {
    const value = groupTabId(e.group);
    if (!out.some((t) => t.value === value)) out.push({ value, label: e.group });
  }
  return out;
}

/** Entrées d'un onglet, dans leur ordre. */
export function entriesOfTab<E extends SettingsEntry>(entries: readonly E[], tab: string): E[] {
  return entries.filter((e) => groupTabId(e.group) === tab);
}

/**
 * Où aller pour ouvrir une entrée (et éventuellement une de ses cartes) : l'onglet de son
 * groupe et l'ancre jusqu'où défiler. Ancre nulle = rester en haut de l'onglet (première
 * entrée du groupe, sans carte visée). Entrée inconnue = null.
 */
export function settingsTarget(entries: readonly SettingsEntry[], entryId: string, sectionTitle?: string | null): { tab: string; anchor: string | null } | null {
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return null;
  const tab = groupTabId(entry.group);
  if (sectionTitle) return { tab, anchor: sectionAnchor(sectionTitle) };
  const first = entriesOfTab(entries, tab)[0];
  return { tab, anchor: first?.id === entry.id ? null : entryAnchor(entry.id) };
}

/**
 * Cible venue d'ailleurs (sous-page de nav, ancre « #reglage-… ») → onglet et ancre. Une
 * ancre de carte est gardée telle quelle ; un id d'entrée vise le bloc de l'entrée.
 */
export function settingsTargetFor(entries: readonly SettingsEntry[], target: string | null | undefined): { tab: string; anchor: string | null } | null {
  const e = entryForTarget(entries, target);
  if (!e) return null;
  const t = (target ?? "").trim().replace(/^#/, "");
  const res = settingsTarget(entries, e.id);
  if (!res) return null;
  return t.startsWith("reglage-") ? { tab: res.tab, anchor: t } : res;
}

/** Compteur « 31 sur 33 visibles » de « Pages affichées » (pages rangées = masquées). */
export function pagesVisibility(ids: readonly string[], parked: readonly string[]): { visible: number; total: number } {
  const hidden = new Set(parked);
  return { visible: ids.filter((id) => !hidden.has(id)).length, total: ids.length };
}
