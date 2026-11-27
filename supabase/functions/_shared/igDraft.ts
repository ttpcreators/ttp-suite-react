/**
 * Brouillon de post Instagram du compte de l'agence, déposé par Claude (outil
 * brouillon_post_instagram, Alfred) dans Planning › Posts Instagram (table ig_planned).
 * Toujours en statut « brouillon » : ig-publish ne publie que les posts « programme »,
 * c'est Marc qui ajoute la photo ou la vidéo et clique sur Programmer ou Publier.
 * Logique pure, testée par igDraft.test.ts.
 */

import { couper, texteSur } from "./texteSur.ts";

export const CREE_PAR_CLAUDE = "Claude (Alfred)";
export const KINDS = ["post", "carrousel", "reel", "story"] as const;
export type DraftKind = (typeof KINDS)[number];

export type DraftRow = {
  kind: DraftKind;
  caption: string;
  collaborators: string[];
  ref: { creator?: string; brand?: string; collab_id?: string } | null;
  scheduled_at: string | null;
  status: "brouillon";
};

/** « 2026-11-20 » + « 18:30 » à l'heure de Paris → instant ISO (UTC), heure d'été comprise. */
export function parisVersUtc(date: string, heure: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const h = /^(\d{1,2})[:h](\d{2})$/.exec(heure.trim());
  if (!d || !h) return null;
  const [y, mo, da, hh, mi] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(h[1]), Number(h[2])];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || hh > 23 || mi > 59) return null;
  const naif = Date.UTC(y, mo - 1, da, hh, mi);
  if (new Date(naif).getUTCDate() !== da) return null; // 31 février, 31 avril…
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const vuParis = (t: number) => {
    const parts = fmt.formatToParts(new Date(t));
    const v = (k: string) => Number(parts.find((p) => p.type === k)?.value);
    return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"));
  };
  // Décalage de Paris à cet instant (1 h en hiver, 2 h en été).
  const utc = naif - (vuParis(naif) - naif);
  // Relu à l'heure de Paris, on doit retrouver l'heure demandée (sinon : 31 février, heure sautée).
  return vuParis(utc) === naif ? new Date(utc).toISOString() : null;
}

/** Les @ invités en collaboration : 3 au plus, sans « @ », format Instagram. */
export function collaborateurs(v: unknown): string[] | null {
  const list = (Array.isArray(v) ? v : String(v ?? "").split(/[,;\s]+/))
    .map((x) => String(x).trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);
  if (!list.every((x) => /^[a-z0-9._]{1,30}$/.test(x))) return null;
  return [...new Set(list)].slice(0, 3);
}

/** Vérifie et prépare la ligne d'un brouillon. `maintenant` pour les tests. */
export function preparerBrouillonPost(a: Record<string, unknown>, maintenant = Date.now()): { row: DraftRow } | { error: string } {
  const kind = (String(a.type ?? "post").toLowerCase() || "post") as DraftKind;
  if (!KINDS.includes(kind)) return { error: "Type inconnu : post, carrousel, reel ou story." };
  // Pas de tiret long ni de demi tiret dans ce qui est publié (règle de Marc). Textes gardés
  // en base : sans caractère nul ni moitié d'emoji (_shared/texteSur.ts).
  const caption = texteSur(String(a.legende ?? "")).replace(/\s*[—–]\s*/g, ", ").trim();
  if (kind !== "story" && !caption) return { error: "Il manque la légende." };
  if (caption.length > 2200) return { error: `Légende trop longue : ${caption.length} caractères pour 2 200 au plus.` };
  const collab = kind === "story" ? [] : collaborateurs(a.collaborateurs);
  if (!collab) return { error: "Compte en collaboration invalide (@ Instagram, 3 au plus)." };
  let scheduled_at: string | null = null;
  if (String(a.date ?? "").trim()) {
    scheduled_at = parisVersUtc(String(a.date), String(a.heure ?? "18:00"));
    if (!scheduled_at) return { error: "Date ou heure illisible : date AAAA-MM-JJ, heure HH:MM (heure de Paris)." };
    if (Date.parse(scheduled_at) < maintenant + 15 * 60_000) return { error: "La date proposée est déjà passée (ou dans moins de 15 minutes)." };
  }
  const ref = {
    ...(String(a.createur ?? "").trim() ? { creator: couper(String(a.createur).trim(), 80) } : {}),
    ...(String(a.marque ?? "").trim() ? { brand: couper(String(a.marque).trim(), 80) } : {}),
    ...(String(a.collab ?? "").trim() ? { collab_id: couper(String(a.collab).trim(), 64) } : {}),
  };
  return { row: { kind, caption, collaborators: collab, ref: Object.keys(ref).length ? ref : null, scheduled_at, status: "brouillon" } };
}
