/**
 * Posts programmés sur le compte Instagram de TTP (Planning → Posts Instagram).
 * Table `ig_planned`, publiés par la fonction ig-publish à l'heure prévue.
 * Ici : types, règles d'Instagram (formats, limites) et modèles de légende.
 */

export type PlanKind = "post" | "carrousel" | "reel" | "story";
export type PlanStatus = "brouillon" | "programme" | "en_cours" | "publie" | "erreur";
export type PlanMedia = { url: string; path: string; type: "image" | "video"; w?: number; h?: number; dur?: number };
export type Planned = {
  id: string;
  kind: PlanKind;
  caption: string;
  media: PlanMedia[];
  cover_url: string | null;
  collaborators: string[];
  share_to_feed: boolean;
  template: string | null;
  ref: { creator?: string; collab_id?: string; brand?: string } | null;
  scheduled_at: string | null;
  status: PlanStatus;
  permalink: string | null;
  error: string | null;
  attempts: number;
  created_by: string | null;
  created_at: string;
  published_at: string | null;
};

export const KIND_LABEL: Record<PlanKind, string> = { post: "Post", carrousel: "Carrousel", reel: "Reel", story: "Story" };
export const KIND_HELP: Record<PlanKind, string> = {
  post: "Une photo dans la grille.",
  carrousel: "2 à 10 photos ou vidéos à faire défiler.",
  reel: "Une vidéo verticale (3 s à 15 min).",
  story: "Une photo ou une vidéo de 60 s max, visible 24 h.",
};
export const STATUS_LABEL: Record<PlanStatus, string> = {
  brouillon: "Brouillon",
  programme: "Programmé",
  en_cours: "En cours d'envoi",
  publie: "Publié",
  erreur: "À corriger",
};

/** Limites d'Instagram (API de publication). */
export const LIMITS = { caption: 2200, hashtags: 30, mentions: 20, collaborators: 3, carouselMin: 2, carouselMax: 10, ratioMin: 0.8, ratioMax: 1.91 };

export const countHashtags = (s: string) => (s.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
export const countMentions = (s: string) => (s.match(/(^|[^\w.])@[A-Za-z0-9._]{1,30}/g) ?? []).length;
/** « @Lea.Fit », « instagram.com/lea.fit » → « lea.fit » (ou "" si invalide). */
export function cleanHandle(raw: string): string {
  const u = raw.trim().replace(/^@/, "").replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(u) ? u : "";
}

/** Ce qui empêche de programmer (vide = prêt). Phrases à afficher telles quelles. */
export function planProblems(d: { kind: PlanKind; caption: string; media: PlanMedia[]; collaborators: string[] }): string[] {
  const out: string[] = [];
  const imgs = d.media.filter((m) => m.type === "image");
  const vids = d.media.filter((m) => m.type === "video");
  if (!d.media.length) out.push(d.kind === "reel" ? "Ajoute la vidéo du reel." : "Ajoute une photo ou une vidéo.");
  else if (d.kind === "post" && (d.media.length > 1 || vids.length)) out.push(vids.length ? "Une vidéo se publie en Reel (choisis « Reel »)." : "Un post = une photo. Plusieurs photos : choisis « Carrousel ».");
  else if (d.kind === "carrousel" && (d.media.length < LIMITS.carouselMin || d.media.length > LIMITS.carouselMax)) out.push("Un carrousel compte de 2 à 10 photos ou vidéos.");
  else if (d.kind === "reel" && (d.media.length !== 1 || !vids.length)) out.push("Un reel = une seule vidéo.");
  else if (d.kind === "story" && d.media.length !== 1) out.push("Une story = une seule photo ou vidéo.");
  if (d.kind === "post" || d.kind === "carrousel") {
    const bad = imgs.find((m) => m.w && m.h && (m.w / m.h < LIMITS.ratioMin - 0.01 || m.w / m.h > LIMITS.ratioMax + 0.01));
    if (bad) out.push("Format de photo refusé par Instagram : entre 4:5 (portrait) et 1,91:1 (paysage).");
  }
  const reelVid = d.kind === "reel" ? vids[0] : undefined;
  if (reelVid?.dur != null && (reelVid.dur < 3 || reelVid.dur > 900)) out.push("Un reel dure de 3 secondes à 15 minutes.");
  if (d.kind === "story" && vids[0]?.dur != null && vids[0].dur > 60) out.push("Une story vidéo dure 60 secondes maximum.");
  if (d.caption.length > LIMITS.caption) out.push(`Légende trop longue (${d.caption.length} / ${LIMITS.caption} caractères).`);
  if (countHashtags(d.caption) > LIMITS.hashtags) out.push(`Trop de hashtags (${countHashtags(d.caption)} / ${LIMITS.hashtags}).`);
  if (countMentions(d.caption) > LIMITS.mentions) out.push(`Trop de @ dans la légende (${countMentions(d.caption)} / ${LIMITS.mentions}).`);
  if (d.collaborators.length > LIMITS.collaborators) out.push("3 collaborateurs maximum.");
  if (d.collaborators.some((c) => !cleanHandle(c))) out.push("Un @ collaborateur n'est pas valide.");
  return out;
}

/**
 * Format à appliquer à une photo avant envoi (largeur / hauteur), ou null pour la
 * garder telle quelle. Post et carrousel : ramené entre 4:5 et 1,91:1 (règle
 * d'Instagram) ; un carrousel prend le format de la 1re photo (Instagram recadre
 * sinon). Story : gardée telle quelle.
 */
export function targetRatio(kind: PlanKind, w: number, h: number, first?: number): number | null {
  if (kind === "story" || kind === "reel" || !w || !h) return null;
  if (kind === "carrousel" && first) return first;
  const r = w / h;
  if (r < LIMITS.ratioMin) return LIMITS.ratioMin;
  if (r > LIMITS.ratioMax) return LIMITS.ratioMax;
  return null;
}

/** Zone source à garder pour un recadrage centré au format `ratio` (largeur / hauteur). */
export function cropBox(w: number, h: number, ratio: number): { sx: number; sy: number; sw: number; sh: number } {
  if (w / h > ratio) {
    const sw = Math.round(h * ratio);
    return { sx: Math.round((w - sw) / 2), sy: 0, sw, sh: h };
  }
  const sh = Math.round(w / ratio);
  return { sx: 0, sy: Math.round((h - sh) / 2), sw: w, sh };
}

const first = (name: string) => {
  const f = name.trim().split(/\s+/)[0] ?? "";
  return f.charAt(0).toUpperCase() + f.slice(1);
};

/** Légende « Nouvelle créatrice signée ». */
export function signatureCaption(name: string, handle: string): string {
  const at = handle ? `@${handle}` : name;
  return [
    `Bienvenue dans la famille TTP Creators, ${first(name) || at} ✨`,
    "",
    `On est très fiers d'accueillir ${at} dans notre roster. Son univers, sa créativité et sa communauté nous ont conquis dès le premier échange.`,
    "",
    "Hâte de vous montrer tout ce qu'on va construire ensemble 🤍",
    "",
    "#TTPCreators #NouvelleCréatrice #Influence",
  ].join("\n");
}

/** Légende « Collab réussie ». */
export function collabCaption(creatorName: string, creatorHandle: string, brandName: string, brandHandle: string): string {
  const c = creatorHandle ? `@${creatorHandle}` : creatorName;
  const b = brandHandle ? `@${brandHandle}` : brandName;
  return [
    "Retour sur une collaboration qu'on a adorée 🤍",
    "",
    `${c} × ${b}`,
    "",
    `Merci à ${brandName || b} pour sa confiance, et bravo à ${first(creatorName) || c} pour ce contenu ✨`,
    "",
    "Envie de travailler avec nos créatrices ? Écris-nous en message privé ou à partnerships@ttpcreators.pro",
    "",
    "#TTPCreators #Collaboration #MarketingDInfluence",
  ].join("\n");
}

/** Date locale « YYYY-MM-DDTHH:mm » (champ datetime-local) ↔ ISO. */
export function toLocalInput(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Prochain créneau conseillé : demain 18 h (heure locale), ou aujourd'hui 18 h s'il est avant 16 h. */
export function nextSlot(now = new Date()): string {
  const d = new Date(now);
  if (d.getHours() >= 16) d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  return d.toISOString();
}
