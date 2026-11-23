import { parseCommissionPct } from "./commission";
import { buildRows } from "./contractRegistry";

/**
 * Fiche créateur « complète à X % » (fiche et roster) : ce qu'il faut pour travailler sans
 * chercher (écrire, appeler, facturer juste, proposer à une marque). Règles PURES.
 *   • email (perso ou pro), téléphone, photo, plateforme principale ;
 *   • commission lisible (« 20 », « 20 % ») ;
 *   • contrat de représentation SIGNÉ (page Contrats, blob `contractHistory`) ;
 *   • media kit rempli (bio ou au moins un réseau, colonne `creators.mediakit`).
 */
export type ChampFiche = "email" | "phone" | "photo" | "platform" | "commission" | "contrat" | "mediakit";

export const CHAMPS_FICHE: { key: ChampFiche; label: string }[] = [
  { key: "email", label: "Email" },
  { key: "phone", label: "Téléphone" },
  { key: "photo", label: "Photo" },
  { key: "platform", label: "Plateforme" },
  { key: "commission", label: "Commission" },
  { key: "contrat", label: "Contrat signé" },
  { key: "mediakit", label: "Media kit" },
];

/** Sous ce pourcentage, la fiche est signalée (orange « à compléter », jamais rouge). */
export const SEUIL_FICHE = 60;

export type FicheLite = {
  name: string;
  email?: string | null;
  email_pro?: string | null;
  phone?: string | null;
  photo_url?: string | null;
  platform?: string | null;
  commission?: string | null;
  mediakit?: unknown;
};

export type Completude = { pct: number; manque: { key: ChampFiche; label: string }[]; total: number };

const fold = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const filled = (s: string | null | undefined) => !!(s ?? "").trim() && !/^[—–-]+$/.test((s ?? "").trim());

/** Créateurs (noms repliés) qui ont un contrat de représentation signé. */
export function contratsSignes(brandHist: unknown, reprHist: unknown): Set<string> {
  const out = new Set<string>();
  for (const r of buildRows(brandHist, reprHist)) {
    if (r.type !== "repr" || r.status !== "signed") continue;
    for (const n of [r.creator, r.creatorLabel]) if (n) out.add(fold(n));
  }
  return out;
}

/** Media kit rempli : une bio ou au moins un réseau. */
export function mediakitRempli(mk: unknown): boolean {
  if (!mk || typeof mk !== "object") return false;
  const m = mk as { bio?: unknown; platforms?: unknown };
  return (typeof m.bio === "string" && !!m.bio.trim()) || (Array.isArray(m.platforms) && m.platforms.length > 0);
}

/**
 * Pourcentage rempli et liste de ce qui manque (dans l'ordre de CHAMPS_FICHE).
 * `signes` null = contrats pas encore lus : le critère est laissé de côté.
 */
export function ficheCompletude(c: FicheLite, signes: ReadonlySet<string> | null): Completude {
  const ok: Record<ChampFiche, boolean | null> = {
    email: filled(c.email) || filled(c.email_pro),
    phone: filled(c.phone),
    photo: filled(c.photo_url),
    platform: filled(c.platform),
    commission: parseCommissionPct(c.commission) != null,
    contrat: signes ? signes.has(fold(c.name)) : null,
    mediakit: mediakitRempli(c.mediakit),
  };
  const counted = CHAMPS_FICHE.filter((f) => ok[f.key] !== null);
  const manque = counted.filter((f) => ok[f.key] === false);
  const total = counted.length;
  return { pct: total ? Math.round(((total - manque.length) / total) * 100) : 100, manque, total };
}
