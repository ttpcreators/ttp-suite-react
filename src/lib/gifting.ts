import type { StatusOption } from "@/components/ui/status-select";

/** Une ligne de gifting (cadeau/dotation reçu par un créateur). */
export type Gift = {
  id: string;
  creator: string | null;
  brand: string | null;
  product: string | null;
  value: string | null;
  contact_name: string | null;
  contact_email: string | null;
  received_on: string | null;
  content_expected: boolean | null;
  deliverables: string | null;
  status: string | null;
  mentions: string | null;
  note: string | null;
  source: string | null;
  sort_order: number | null;
};

/** Colonnes lues (identiques agence / créateur). */
export const GIFT_COLS =
  "id, creator, brand, product, value, contact_name, contact_email, received_on, content_expected, deliverables, status, mentions, note, source, sort_order";

/**
 * Mention par défaut rappelée au créateur. Un cadeau reste une contrepartie : dès qu'il
 * y a mise en avant, le contenu doit être signalé comme communication commerciale
 * (loi n° 2023-451 du 9 juin 2023). « Cadeau »/« Produit offert » sont les formulations
 * usuelles reconnues par l'ARPP.
 */
export const DEFAULT_MENTIONS =
  "À publier avec une mention claire et lisible : « Produit offert » ou « Cadeau » (partenariat non rémunéré), conformément à la loi n° 2023-451.";

export const GIFT_STATUS: StatusOption[] = [
  { value: "recu", label: "Reçu", dot: "bg-progress" },
  { value: "attente", label: "Contenu en attente", dot: "bg-wait" },
  { value: "publie", label: "Contenu publié", dot: "bg-ok" },
  { value: "refuse", label: "Refusé", dot: "bg-closed" },
  { value: "clos", label: "Clôturé", dot: "bg-closed" },
];

export const giftStatusMeta = (v: string | null | undefined): StatusOption =>
  GIFT_STATUS.find((s) => s.value === v) ?? GIFT_STATUS[0];

/** Prénom lisible (« LÉNA PASQUALE » → « Léna »). */
export function firstNameOf(name: string | null | undefined): string {
  const w = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : "";
}

/** Compteurs de l'onglet Gifting : reçus, contenus attendus, en attente, publiés. */
export function giftCounts(list: readonly Pick<Gift, "status" | "content_expected">[]): { total: number; expected: number; waiting: number; published: number } {
  const expected = list.filter((g) => g.content_expected).length;
  const waiting = list.filter((g) => g.content_expected && g.status !== "publie" && g.status !== "clos" && g.status !== "refuse").length;
  const published = list.filter((g) => g.status === "publie").length;
  return { total: list.length, expected, waiting, published };
}
