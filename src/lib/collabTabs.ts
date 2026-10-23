/*
 * Page Collabs à trois onglets (classeur) : « Payées » (les collabs), « Gifting » (les
 * cadeaux reçus) et « Négociations » (les futures collabs, table `prospects`). Les
 * anciennes pages Gifting et Pipeline restent des ids valides (favoris, liens, onglets
 * ouverts) : le menu et les liens les ouvrent désormais dans Collabs, sur le bon onglet.
 * Côté créateur, Missions a aussi trois onglets ; « Gifting » du menu créateur ouvre
 * Missions › Gifting. Logique PURE, testée par collabTabs.test.ts.
 */

export const COLLAB_TABS = ["payees", "gifting", "negociations"] as const;
export type CollabTab = (typeof COLLAB_TABS)[number];

/** Vue de l'agence qui vit maintenant dans un onglet de Collabs, ou null. */
export function collabTabRedirect(view: string): { view: "collabs"; tab: CollabTab } | null {
  if (view === "gifting") return { view: "collabs", tab: "gifting" };
  if (view === "prospection") return { view: "collabs", tab: "negociations" };
  return null;
}

/** Valeur lue (lien, stockage) → onglet valide. */
export function normalizeCollabTab(v: string | null | undefined): CollabTab {
  return (COLLAB_TABS as readonly string[]).includes(v ?? "") ? (v as CollabTab) : "payees";
}

export const MISSION_TABS = ["missions", "gifting", "discussions"] as const;
export type MissionTab = (typeof MISSION_TABS)[number];

export function normalizeMissionTab(v: string | null | undefined): MissionTab {
  return (MISSION_TABS as readonly string[]).includes(v ?? "") ? (v as MissionTab) : "missions";
}

/** Étape d'une négociation, en mots de créatrice (jamais « prospect » ni « pipeline »). */
export function discussionStage(stage: string | null | undefined): string {
  switch ((stage ?? "").trim()) {
    case "Prospection":
    case "Contact":
      return "Premier contact";
    case "Négociation":
      return "En discussion";
    case "Signé":
      return "Signée bientôt";
    default:
      return "En discussion";
  }
}

/** Négociation vue par la créatrice : seulement des champs non sensibles. */
export type CreatorDiscussion = { id: string; brand: string; deliverables: string | null; stage: string | null; created_at: string | null };

/** Ordre d'affichage : la plus avancée d'abord, puis la plus récente. */
export function sortDiscussions(list: readonly CreatorDiscussion[]): CreatorDiscussion[] {
  const rank = (s: string | null) => ({ Signé: 0, Négociation: 1, Contact: 2, Prospection: 3 })[(s ?? "") as "Signé"] ?? 4;
  return [...list].sort((a, b) => rank(a.stage) - rank(b.stage) || String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
}

/** Compteurs de l'onglet Négociations : en cours (pas signées), en négociation, signées, valeur proposée. */
export function negotiationCounts(list: readonly { stage: string | null; proposal?: { target?: number } | null; value?: string | null }[]): { open: number; negotiating: number; signed: number; proposed: number } {
  let proposed = 0;
  for (const r of list) {
    if (r.stage === "Signé") continue;
    const t = Number(r.proposal?.target);
    if (Number.isFinite(t) && t > 0) proposed += t;
  }
  return {
    open: list.filter((r) => r.stage !== "Signé").length,
    negotiating: list.filter((r) => r.stage === "Négociation").length,
    signed: list.filter((r) => r.stage === "Signé").length,
    proposed: Math.round(proposed),
  };
}
