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
  { value: "recu", label: "Reçu", dot: "bg-sky-500" },
  { value: "attente", label: "Contenu en attente", dot: "bg-amber-500" },
  { value: "publie", label: "Contenu publié", dot: "bg-emerald-500" },
  { value: "refuse", label: "Refusé", dot: "bg-rose-500" },
  { value: "clos", label: "Clôturé", dot: "bg-zinc-400" },
];

export const giftStatusMeta = (v: string | null | undefined): StatusOption =>
  GIFT_STATUS.find((s) => s.value === v) ?? GIFT_STATUS[0];
