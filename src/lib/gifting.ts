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

/*
 * Page Gifting (agence) : les cadeaux sont rangés en classeur, un onglet par étape.
 * Chaque cadeau tombe dans UN seul groupe (pas de doublon entre onglets) :
 *   attente  contenu attendu et pas encore publié (statut « Contenu en attente », ou
 *            « Reçu » quand la marque attend du contenu) ;
 *   recus    reçu, sans contenu attendu ;
 *   publies  contenu publié ;
 *   clos     clôturé ou refusé.
 * Un statut vide ou inconnu compte comme « Reçu » (comme `giftStatusMeta`).
 */
export const GIFT_TABS = ["tous", "attente", "recus", "publies", "clos"] as const;
export type GiftTab = (typeof GIFT_TABS)[number];
export type GiftGroup = Exclude<GiftTab, "tous">;

export const GIFT_TAB_META: Record<GiftTab, { label: string; short: string }> = {
  tous: { label: "Tous", short: "Tous" },
  attente: { label: "Contenu attendu", short: "Attendu" },
  recus: { label: "Reçus", short: "Reçus" },
  publies: { label: "Publiés", short: "Publiés" },
  clos: { label: "Clôturés", short: "Clôturés" },
};

type GiftState = Pick<Gift, "status" | "content_expected">;

/** Groupe (onglet) d'un cadeau. */
export function giftGroup(g: GiftState): GiftGroup {
  switch (g.status) {
    case "attente":
      return "attente";
    case "publie":
      return "publies";
    case "clos":
    case "refuse":
      return "clos";
    default:
      return g.content_expected ? "attente" : "recus";
  }
}

export const inGiftTab = (g: GiftState, tab: GiftTab): boolean => tab === "tous" || giftGroup(g) === tab;

/** Nombre de cadeaux par onglet (« tous » = total). */
export function giftTabCounts(list: readonly GiftState[]): Record<GiftTab, number> {
  const out: Record<GiftTab, number> = { tous: list.length, attente: 0, recus: 0, publies: 0, clos: 0 };
  for (const g of list) out[giftGroup(g)] += 1;
  return out;
}

/** Clé « aaaa-mm » d'une date ISO (2026-07-31…) ou française (31/07/2026) ; "" si illisible. */
export function giftYearMonth(date: string | null | undefined): string {
  const s = String(date ?? "").trim();
  let m = /^(\d{4})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}`;
  return "";
}

export type GiftKpis = {
  /** Contenus attendus pas encore publiés. */
  attente: number;
  /** Contenus publiés. */
  publies: number;
  /** Part des contenus attendus déjà publiés (0 à 100), null s'il n'y en a aucun. */
  publiesPct: number | null;
  /** Clôturés + refusés, dont refusés. */
  clos: number;
  refuses: number;
  /** Reçus dans le mois `month` (« aaaa-mm »), sur TOUTE la liste `all`. */
  recusMois: number;
};

/**
 * Chiffres du bandeau. `list` = cadeaux de la période affichée ; `all` = tous les cadeaux
 * (« Reçus ce mois » ne dépend pas de la période choisie).
 */
export function giftKpis(list: readonly Gift[], all: readonly Gift[], month: string): GiftKpis {
  const c = giftTabCounts(list);
  const base = c.attente + c.publies;
  return {
    attente: c.attente,
    publies: c.publies,
    publiesPct: base ? Math.round((c.publies / base) * 100) : null,
    clos: c.clos,
    refuses: list.filter((g) => g.status === "refuse").length,
    recusMois: all.filter((g) => giftYearMonth(g.received_on) === month).length,
  };
}

/** Champs fouillés par la recherche de la page (avec `matchWords`). */
export function giftSearchFields(g: Gift): (string | null)[] {
  return [g.brand, g.creator, g.product, g.value, g.contact_name, g.contact_email, g.deliverables, g.note, giftStatusMeta(g.status).label];
}
