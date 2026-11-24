// ============================================================================
// _shared/alfredPont.ts : la logique pure du pont entre l'iMac d'Alfred et l'app
// (testée par alfredPont.test.ts). Demande de Marc, 17 novembre 2026.
// ============================================================================

export type Reglages = {
  heures: { matin: number; soir: number; veille: number[]; vigie: number; contenu: number; bilan_soir: number };
  sonner: { points: boolean; valider: boolean };
};

/** Les réglages d'origine : ceux d'alfred.sh avant la page Réglages. */
export const REGLAGES_DE_BASE: Reglages = {
  heures: { matin: 9, soir: 17, veille: [11, 13, 15], vigie: 6, contenu: 16, bilan_soir: 20 },
  sonner: { points: true, valider: true },
};

const heure = (v: unknown, base: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : base;
};

/** Réglages lus (ou envoyés par l'app), complétés et bornés : jamais une heure hors 0 à 23. */
export function reglagesPropres(v: unknown): Reglages {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, any>;
  const h = (o.heures ?? {}) as Record<string, unknown>;
  const b = REGLAGES_DE_BASE.heures;
  const veille = Array.isArray(h.veille) ? [...new Set((h.veille as unknown[]).map((x) => heure(x, -1)).filter((x) => x >= 0))].sort((x, y) => x - y).slice(0, 6) : b.veille;
  const s = (o.sonner ?? {}) as Record<string, unknown>;
  return {
    heures: { matin: heure(h.matin, b.matin), soir: heure(h.soir, b.soir), veille, vigie: heure(h.vigie, b.vigie), contenu: heure(h.contenu, b.contenu), bilan_soir: heure(h.bilan_soir, b.bilan_soir) },
    sonner: { points: s.points !== false, valider: s.valider !== false },
  };
}

/**
 * Les commandes « / » : la version la plus récente gagne, entre celle de l'iMac (Marc les
 * change sur Telegram) et celle de l'app (page Réglages d'Alfred).
 */
export function commandesGagnantes(
  imac: { texte?: string; maj_le?: string } | undefined,
  app: { texte?: string; maj_le?: string } | undefined,
): { texte: string; maj_le: string; source: "imac" | "app" | "aucune" } {
  const ti = Date.parse(String(imac?.maj_le ?? "")) || 0;
  const ta = Date.parse(String(app?.maj_le ?? "")) || 0;
  if (imac?.texte && ti >= ta) return { texte: imac.texte, maj_le: new Date(ti).toISOString(), source: "imac" };
  if (app?.texte) return { texte: app.texte, maj_le: new Date(ta).toISOString(), source: "app" };
  return { texte: "", maj_le: "", source: "aucune" };
}

/** Alfred se tait depuis plus de 15 minutes, entre 7 h et 23 h à Paris : alerte (une par panne). */
export function alfredHorsLigne(now: Date, vuLe: string | null, alerteLe: string | null): { alerte: boolean; minutes: number } {
  if (!vuLe) return { alerte: false, minutes: 0 };
  const minutes = Math.floor((now.getTime() - Date.parse(vuLe)) / 60_000);
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(now));
  const dejaDit = !!alerteLe && Date.parse(alerteLe) > Date.parse(vuLe);
  return { alerte: minutes >= 15 && h >= 7 && h < 23 && !dejaDit, minutes };
}

/**
 * Où ranger une photo qu'Alfred téléverse sur l'app (demande de Marc, 24 novembre 2026) :
 *   « createur:<id> »          → la photo de profil du créateur (creators.photo_url) ;
 *   « mediakit:<id>:<cle> »    → une photo de son media kit (mediakit.photos[cle] : hero, contact,
 *                                ou la capture d'une plateforme : instagram, tiktok…) ;
 *   vide                        → seulement l'adresse de la photo, sans rien changer dans l'app.
 * null : cible illisible (refusée).
 */
export type CiblePhoto = { kind: "aucune" } | { kind: "createur"; id: string } | { kind: "mediakit"; id: string; cle: string };
export function cibleDePhoto(cible: unknown): CiblePhoto | null {
  const c = String(cible ?? "").trim().toLowerCase();
  if (!c) return { kind: "aucune" };
  const uuid = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
  let m = c.match(new RegExp(`^createur:${uuid}$`));
  if (m) return { kind: "createur", id: m[1] };
  m = c.match(new RegExp(`^mediakit:${uuid}:([a-z0-9_-]{1,30})$`));
  if (m) return { kind: "mediakit", id: m[1], cle: m[2] };
  return null;
}

/** Une photo seulement (jpg, png, webp, heic), 10 Mo au plus. */
export function typePhoto(nom: string): string | null {
  const ext = String(nom).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" } as Record<string, string>)[ext] ?? null;
}
