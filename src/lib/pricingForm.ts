/*
 * Page Tarifs : textes et lignes dérivés du calcul (règles PURES, testées par
 * pricingForm.test.ts). Le calcul des prix lui-même vit dans pricing.ts.
 */
import { formatEuro } from "./money";
import type { PlatKey } from "./pricing";

/**
 * Fourchette : « 800 – 1 100 € HT », ou « 950 € HT » si les deux bornes sont égales.
 * `ht` faux : sans « HT » (lignes du détail).
 */
export function priceRange(min: number, max: number, ht = true): string {
  const end = ht ? " HT" : "";
  if (min === max) return `${formatEuro(min)}${end}`;
  return `${formatEuro(min).replace(/\s€$/, "")} – ${formatEuro(max)}${end}`;
}

/** Ce qui manque pour chiffrer : « Il manque les abonnés Instagram et TikTok ». null si rien. */
export function missingAudienceText(labels: readonly string[]): string | null {
  const l = [...new Set(labels)];
  if (!l.length) return null;
  const list = l.length === 1 ? l[0] : `${l.slice(0, -1).join(", ")} et ${l[l.length - 1]}`;
  return `Il manque les abonnés ${list}`;
}

/** Noms des formats dans le texte des livrables d'une collab (singulier, pluriel). */
const FORMAT_NOUN: Record<string, [string, string]> = {
  "instagram.reel": ["reel", "reels"],
  "instagram.post": ["post", "posts"],
  "instagram.carrousel": ["carrousel", "carrousels"],
  "instagram.story": ["série de stories", "séries de stories"],
  "tiktok.video": ["vidéo", "vidéos"],
  "tiktok.story": ["story", "stories"],
  "youtube.integration": ["intégration", "intégrations"],
  "youtube.dedicated": ["vidéo dédiée", "vidéos dédiées"],
  "youtube.short": ["short", "shorts"],
  "snapchat.story": ["série de stories", "séries de stories"],
  "x.post": ["post", "posts"],
};
const PLATFORM_LABEL: Record<PlatKey, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", snapchat: "Snapchat", x: "X" };

/**
 * Livrables écrits dans la fiche d'une collab : « 2 reels Instagram, 1 vidéo TikTok ».
 * Même forme que celle que lit la page Collabs pour compter les publications attendues.
 * Les lignes identiques (plateforme et format) sont additionnées.
 */
export function deliverablesText(items: readonly { platform: PlatKey; format: string; qty: number }[]): string {
  const sums = new Map<string, { platform: PlatKey; format: string; qty: number }>();
  for (const it of items) {
    const key = `${it.platform}.${it.format}`;
    const cur = sums.get(key);
    const qty = Math.max(1, Math.round(it.qty || 1));
    if (cur) cur.qty += qty;
    else sums.set(key, { platform: it.platform, format: it.format, qty });
  }
  return [...sums.entries()]
    .map(([key, it]) => {
      const noun = FORMAT_NOUN[key] ?? [it.format, it.format];
      return `${it.qty} ${it.qty > 1 ? noun[1] : noun[0]} ${PLATFORM_LABEL[it.platform]}`;
    })
    .join(", ");
}

/** Livrables UGC dans la fiche d'une collab : « UGC : 2 × Vidéo courte, 1 × Photo ». */
export function ugcDeliverablesText(items: readonly { label: string; qty: number }[]): string {
  return items.length ? `UGC : ${items.map((i) => `${Math.max(1, Math.round(i.qty || 1))} × ${i.label}`).join(", ")}` : "";
}

/** Ligne de facture préparée depuis Tarifs (montant HT, quantité 1). */
export type QuoteLine = { label: string; unit: number };

/**
 * Lignes de la facture en brouillon (« Créer le devis ») : un livrable par ligne au prix
 * cible, puis les majorations, puis la remise en négatif. Somme = prix cible du total.
 */
export function quoteInvoiceLines(
  lines: readonly { label: string; mid: number }[],
  options: { pct: number; mid: number },
  discount: { pct: number; mid: number },
): QuoteLine[] {
  const out: QuoteLine[] = lines.filter((l) => l.mid > 0).map((l) => ({ label: l.label, unit: l.mid }));
  if (options.mid > 0) out.push({ label: `Majorations +${options.pct} %`, unit: options.mid });
  if (discount.mid > 0) out.push({ label: `Remise pack −${discount.pct} %`, unit: -discount.mid });
  return out;
}
