/*
 * Checklist reliée aux Collabs (règles PURES, testées par checklistCollab.test.ts) :
 *   • chaque collab en cours (ou gagnée) a sa checklist, créée d'office (« Marque × Créateur ») ;
 *   • une ancienne checklist dont le nom désigne la collab (« JNPR X LÉNA ») lui est reliée ;
 *   • les étapes de la checklist se cochent toutes seules quand la collab atteint l'étape
 *     correspondante (page Collabs, 11 étapes). Les autres se cochent toujours à la main.
 */

/** Une checklist enregistrée : `done` = étapes cochées À LA MAIN ; `collabId` = collab reliée. */
export type SavedChecklist = { id: string; name: string; done: Record<string, boolean>; collabId?: string };

export type CollabLite = { id: string; brand: string | null; creator: string | null; step: number; status: string };

/** Checklist affichée : coches à la main + coches venues de la collab. */
export type ShownChecklist = SavedChecklist & {
  /** Collab reliée (étape et statut à jour). */
  collab?: CollabLite;
  /** Pas encore enregistrée : créée d'office pour la collab, écrite au premier changement. */
  virtual?: boolean;
};

/**
 * Étape de la collab (1 à 11) à partir de laquelle chaque étape de la checklist est faite.
 * 2 Brief transmis · 4 Tournage · 5 Validation marque · 6 Publication · 7 Stats à 7 jours ·
 * 8 Facture envoyée · 9 Paiement marque reçu · 10 Créateur payé.
 */
export const AUTO_FROM_STEP: Record<string, number> = {
  "brief-1": 2,
  "brief-2": 2,
  "brief-3": 2,
  "prod-1": 4,
  "prod-2": 5,
  "prod-3": 5,
  "valid-1": 5,
  "valid-2": 5,
  "pub-1": 6,
  "pub-2": 6,
  "pub-3": 7,
  "fact-1": 8,
  "fact-2": 9,
  "fact-3": 10,
};

/** Étape de la checklist cochée par la collab (étape courante `step`) ? */
export function autoChecked(stepId: string, collabStep: number | undefined): boolean {
  const from = AUTO_FROM_STEP[stepId];
  return collabStep != null && from != null && collabStep >= from;
}

/** Cochée, à la main ou par la collab. */
export function isChecked(ck: ShownChecklist, stepId: string): boolean {
  return !!ck.done[stepId] || autoChecked(stepId, ck.collab?.step);
}

/** Collabs qui ont une checklist : en cours ou gagnées (pas perdues ni archivées). */
const LISTED = new Set(["active", "gagnee"]);

const fold = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const firstWord = (s: string | null | undefined) => fold(s).split(" ")[0] ?? "";
const cap = (s: string) => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());

/** Nom d'une checklist créée d'office : « JNPR × Léna ». */
export function collabChecklistName(c: CollabLite): string {
  const who = cap((c.creator ?? "").trim().split(/\s+/)[0] ?? "");
  return [c.brand?.trim(), who].filter(Boolean).join(" × ") || "Collab";
}

/** Le nom désigne-t-il cette collab ? « JNPR X LÉNA », « jnpr × Léna », « Léna x JNPR ». */
export function nameMatchesCollab(name: string, c: CollabLite): boolean {
  const parts = fold(name).split(/\s+(?:x|×)\s+|\s*×\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return false;
  const brand = fold(c.brand);
  const who = firstWord(c.creator);
  if (!brand || !who) return false;
  const isWho = (p: string) => p === who || p.split(" ")[0] === who;
  return (parts[0] === brand && isWho(parts[1])) || (parts[1] === brand && isWho(parts[0]));
}

/**
 * Liste affichée : les checklists enregistrées (reliées à leur collab si elles en désignent
 * une), puis une checklist créée d'office pour chaque collab listée qui n'en a pas encore.
 * Une collab n'est reliée qu'à une checklist.
 */
export function mergeChecklists(saved: readonly SavedChecklist[], collabs: readonly CollabLite[]): ShownChecklist[] {
  const byId = new Map(collabs.map((c) => [c.id, c]));
  const used = new Set<string>();
  const out: ShownChecklist[] = saved.map((ck) => {
    const linked = ck.collabId ? byId.get(ck.collabId) : undefined;
    if (linked) {
      used.add(linked.id);
      return { ...ck, collab: linked };
    }
    return { ...ck };
  });
  // Anciennes checklists sans lien : reliées par le nom, à une collab encore libre.
  for (const ck of out) {
    if (ck.collab || ck.collabId) continue;
    const c = collabs.find((x) => !used.has(x.id) && nameMatchesCollab(ck.name, x));
    if (c) {
      used.add(c.id);
      ck.collab = c;
    }
  }
  for (const c of collabs) {
    if (used.has(c.id) || !LISTED.has(c.status)) continue;
    out.push({ id: `collab:${c.id}`, name: collabChecklistName(c), done: {}, collabId: c.id, collab: c, virtual: true });
  }
  return out;
}

/** Ce qui s'enregistre d'une checklist affichée (sans la collab chargée ni le drapeau). */
export function toSaved(ck: ShownChecklist): SavedChecklist {
  const collabId = ck.collab?.id ?? ck.collabId;
  return { id: ck.id, name: ck.name, done: ck.done, ...(collabId ? { collabId } : {}) };
}
