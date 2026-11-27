/*
 * Page Collabs à trois onglets (classeur) : « Payées » (les collabs), « Gifting » (les
 * cadeaux reçus) et « Négociations » (les futures collabs, table `prospects`). Les
 * anciennes pages Gifting et Pipeline restent des ids valides (favoris, liens, onglets
 * ouverts) : le menu et les liens les ouvrent désormais dans Collabs, sur le bon onglet.
 * Côté créateur, Missions a aussi trois onglets ; « Gifting » du menu créateur ouvre
 * Missions › Gifting. Logique PURE, testée par collabTabs.test.ts.
 */
import { parseAmount } from "./money";

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

/**
 * Étape d'un prospect ramenée à sa valeur enregistrée (Prospection, Contact, Négociation, Signé,
 * Perdu), qu'elle soit écrite en valeur ou en libellé affiché (« Repérée », « Contactée »,
 * « En négociation », « Signée », « Perdue » : le connecteur a écrit des libellés). Sans tenir
 * compte de la casse ni des espaces. Inconnue ou vide : null.
 */
const STADE_ENREGISTRE: Record<string, string> = {
  prospection: "Prospection", "repérée": "Prospection",
  contact: "Contact", "contactée": "Contact",
  "négociation": "Négociation", "ennégociation": "Négociation",
  "signé": "Signé", "signée": "Signé",
  perdu: "Perdu", perdue: "Perdu",
};
export function stageEnregistre(stage: string | null | undefined): string | null {
  return STADE_ENREGISTRE[String(stage ?? "").toLocaleLowerCase("fr").replace(/\s+/g, "")] ?? null;
}

/** Stades montrés au créateur (même liste que la fonction SQL creator_discussions) : jamais Prospection, Perdu, vide ou inconnu. */
const STADES_CREATEUR = new Set(["Contact", "Négociation", "Signé"]);

/**
 * Négociations montrées au créateur, la plus avancée d'abord puis la plus récente. Avant le SQL
 * du 27/11, la fonction creator_discussions renvoie tout : on ne garde ici que Contact,
 * Négociation et Signé (pas une marque seulement repérée, ni une piste perdue), et l'étape est
 * ramenée à sa valeur enregistrée pour que discussionStage et la pastille la lisent.
 */
export function sortDiscussions(list: readonly CreatorDiscussion[]): CreatorDiscussion[] {
  const rank = (s: string | null) => ({ Signé: 0, Négociation: 1, Contact: 2 })[(s ?? "") as "Signé"] ?? 3;
  return list
    .flatMap((d) => {
      const stage = stageEnregistre(d.stage);
      return stage && STADES_CREATEUR.has(stage) ? [{ ...d, stage }] : [];
    })
    .sort((a, b) => rank(a.stage) - rank(b.stage) || String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
}

/**
 * Compteurs de l'onglet Négociations : pistes ouvertes (pas signées : repérées, contactées ou en
 * négociation), dont chaque stade, signées, valeur proposée. « En négociation » est un SOUS-ENSEMBLE
 * des pistes ouvertes : la page l'écrit « dont en négociation » (avant : « Négociations en cours :
 * 21 » à côté de « En négociation : 0 » se contredisaient). Une piste perdue ne compte nulle part
 * (ni ouverte, ni repérée, ni dans la valeur proposée). Valeurs ou libellés, comme stageEnregistre.
 */
export function negotiationCounts(list: readonly { stage: string | null; proposal?: { target?: number } | null; value?: string | null }[]): { open: number; spotted: number; contacted: number; negotiating: number; signed: number; proposed: number } {
  let proposed = 0;
  const st = (r: { stage: string | null }) => stageEnregistre(r.stage) ?? r.stage;
  const live = list.filter((r) => st(r) !== "Perdu");
  for (const r of live) {
    if (st(r) === "Signé") continue;
    const t = Number(r.proposal?.target);
    if (Number.isFinite(t) && t > 0) proposed += t;
    // Sans proposition calculée : le montant saisi à la main (« 1 000 € », haut d'une fourchette).
    else proposed += Math.max(0, ...(String(r.value ?? "").match(/\d[\d\s.,]*/g) ?? []).map((a) => parseAmount(a)));
  }
  return {
    open: live.filter((r) => st(r) !== "Signé").length,
    // Stade inconnu ou vide : compté comme repéré (premier stade), pour que les trois fassent le total.
    spotted: live.filter((r) => st(r) !== "Signé" && st(r) !== "Contact" && st(r) !== "Négociation").length,
    contacted: live.filter((r) => st(r) === "Contact").length,
    negotiating: live.filter((r) => st(r) === "Négociation").length,
    signed: live.filter((r) => st(r) === "Signé").length,
    proposed: Math.round(proposed),
  };
}
