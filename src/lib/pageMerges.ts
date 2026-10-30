import type { ViewId } from "./nav";

/**
 * Pages devenues des onglets d'une autre page (refonte du menu, 2026-10-30). L'id de la page
 * absorbée ne change pas : un raccourci, un onglet enregistré, une notification ou un lien
 * qui l'ouvre arrive sur la page hôte, sur le bon onglet (`sub`).
 */
export const PAGE_MERGES: Partial<Record<ViewId, { view: ViewId; sub: string }>> = {
  relances: { view: "facturation", sub: "relances" },
  objectifs: { view: "stats", sub: "objectifs" },
  whatsapp: { view: "contacts", sub: "whatsapp" },
  messages: { view: "mails", sub: "messages" },
  suivi: { view: "roster", sub: "suivi" },
  engagement: { view: "roster", sub: "engagement" },
  echeances: { view: "contrats", sub: "echeances" },
  exclusivites: { view: "contrats", sub: "exclusivites" },
};

/** Page hôte et onglet d'une page absorbée, sinon null. */
export function pageMerge(id: string): { view: ViewId; sub: string } | null {
  return PAGE_MERGES[id as ViewId] ?? null;
}
