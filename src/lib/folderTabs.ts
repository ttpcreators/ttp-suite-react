/*
 * Onglets « dossier » (cadre sombre, onglet actif fondu dans le panneau clair, comme la
 * page Agents) : logique PURE partagée par les pages qui les utilisent (liste dans
 * FOLDER_PAGES, plus bas). Testable sous Node ; l'affichage vit dans
 * src/components/ui/folder-tabs.tsx.
 */

/** Libellé d'un onglet avec son compteur : « Agents · 2 ». Zéro ou absent = libellé seul. */
export function tabLabel(label: string, count?: number | null): string {
  return count ? `${label} · ${count}` : label;
}

/** Range les onglets dans l'ordre enregistré ; les inconnus (nouveaux onglets) gardent leur place à la fin. */
export function sortByOrder<T extends { value: string }>(items: readonly T[], order: readonly string[]): T[] {
  const pos = (v: string) => {
    const k = order.indexOf(v);
    return k < 0 ? order.length + items.findIndex((x) => x.value === v) : k;
  };
  return [...items].sort((a, b) => pos(a.value) - pos(b.value));
}

/** Ordre gardé sur l'appareil (JSON d'une liste d'ids) ; illisible ou absent = liste vide. */
export function parseTabOrder(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Sous-page de nav (sidebar) → onglet de la page ; inconnue ou absente = `fallback`. */
export function tabFromSub<T extends string>(sub: string | null | undefined, allowed: readonly T[], fallback: T): T {
  return sub != null && (allowed as readonly string[]).includes(sub) ? (sub as T) : fallback;
}

/*
 * Contrats : « Tous » = la page d'arrivée (sous-page nulle), puis un onglet par
 * générateur, mêmes ids que les sous-pages de la sidebar (Marque × Créateur,
 * Représentation, Contrat UGC), puis Fins de contrat et Exclusivités (anciennes pages,
 * mêmes ids : src/lib/pageMerges.ts).
 */
export const CONTRATS_TABS = ["tous", "marque", "repr", "ugc", "echeances", "exclusivites"] as const;
export type ContratsTab = (typeof CONTRATS_TABS)[number];

export const contratsTabFromSub = (sub: string | null | undefined): ContratsTab => tabFromSub(sub, CONTRATS_TABS, "tous");
export const contratsSubFromTab = (tab: ContratsTab): string | null => (tab === "tous" ? null : tab);

/** Onglets déjà ouverts (montés une fois, puis gardés) : on ajoute l'onglet courant. */
export function withVisited<T extends string>(visited: readonly T[], current: T): readonly T[] {
  return visited.includes(current) ? visited : [...visited, current];
}

/*
 * Code couleur des classeurs : chaque onglet porte une couleur (pastille avant le
 * libellé, filet en haut de l'onglet actif), comme les intercalaires d'un classeur.
 * Couleurs = jetons des graphiques (`--chart-*` de src/index.css), lisibles sur le
 * rail sombre comme sur le panneau clair, dans les trois thèmes. La couleur d'un onglet
 * dépend de son id, jamais de sa place : réordonner les onglets ne change rien.
 * Priorité : choix de l'équipe (Paramètres, blob `folderTabTones`) > couleur par défaut
 * de la page > couleur automatique.
 */
export const FOLDER_TONES = ["blue", "teal", "green", "orange", "purple", "pink", "grey"] as const;
export type FolderTone = (typeof FOLDER_TONES)[number];

/** Couleur CSS (jeton) de chaque teinte. */
export const TONE_VAR: Record<FolderTone, string> = {
  blue: "var(--chart-1)",
  teal: "var(--chart-2)",
  green: "var(--chart-3)",
  orange: "var(--chart-4)",
  purple: "var(--chart-5)",
  pink: "var(--chart-7)",
  grey: "var(--chart-6)",
};

export const TONE_LABEL: Record<FolderTone, string> = {
  blue: "Bleu",
  teal: "Turquoise",
  green: "Vert",
  orange: "Orange",
  purple: "Violet",
  pink: "Rose",
  grey: "Gris",
};

/** Teintes tirées automatiquement (sans rose ni gris, gardés pour un choix exprès). */
const AUTO_TONES: readonly FolderTone[] = ["blue", "teal", "green", "orange", "purple"];

export const isFolderTone = (v: unknown): v is FolderTone => typeof v === "string" && (FOLDER_TONES as readonly string[]).includes(v);

/** Empreinte stable d'un id d'onglet (djb2). */
export function tabHash(value: string): number {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) h = ((h * 33) ^ value.charCodeAt(i)) >>> 0;
  return h;
}

/** Choix d'une page lus du blob : seules les teintes connues restent, le reste est ignoré. */
export function sanitizePageTones(raw: unknown): Record<string, FolderTone> {
  const out: Record<string, FolderTone> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isFolderTone(v)) out[k] = v;
  return out;
}

/** Clé du blob agence : { [page]: { [onglet]: teinte } }. */
export const FOLDER_TONES_KEY = "folderTabTones";
export type FolderToneMap = Record<string, Record<string, FolderTone>>;

/** Tout le réglage lu du blob, nettoyé (pages vides retirées). */
export function sanitizeToneMap(raw: unknown): FolderToneMap {
  const out: FolderToneMap = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [page, tones] of Object.entries(raw as Record<string, unknown>)) {
    const clean = sanitizePageTones(tones);
    if (Object.keys(clean).length) out[page] = clean;
  }
  return out;
}

/**
 * Teinte de chaque onglet. Choix de l'équipe, sinon défaut de la page, sinon une teinte
 * automatique tirée de l'id (empreinte), en évitant celles déjà prises sur la page. Les
 * onglets automatiques sont servis dans l'ordre de leurs ids (pas de leur place) : le
 * résultat ne dépend pas de l'ordre d'affichage.
 */
export function resolveTabTones(
  values: readonly string[],
  defaults: Readonly<Record<string, FolderTone | undefined>> = {},
  custom?: unknown,
): Record<string, FolderTone> {
  const chosen = sanitizePageTones(custom);
  const out: Record<string, FolderTone> = {};
  const used = new Set<FolderTone>();
  for (const v of values) {
    const d = defaults[v];
    const t = chosen[v] ?? (isFolderTone(d) ? d : undefined);
    if (t) {
      out[v] = t;
      used.add(t);
    }
  }
  const rest = [...new Set(values)].filter((v) => !out[v]).sort();
  for (const v of rest) {
    const start = tabHash(v) % AUTO_TONES.length;
    let pick = AUTO_TONES[start];
    for (let k = 0; k < AUTO_TONES.length; k += 1) {
      const t = AUTO_TONES[(start + k) % AUTO_TONES.length];
      if (!used.has(t)) {
        pick = t;
        break;
      }
    }
    out[v] = pick;
    used.add(pick);
  }
  return out;
}

/** Choix d'une page après un clic dans Paramètres : `null` = « Automatique » (défaut de la page). */
export function withTabTone(current: unknown, tab: string, tone: FolderTone | null): Record<string, FolderTone> {
  const next = sanitizePageTones(current);
  if (tone) next[tab] = tone;
  else delete next[tab];
  return next;
}

/*
 * Les pages en classeur, leurs onglets et leurs couleurs par défaut (id de page =
 * `orderKey` de FolderTabs). Sert à FolderTabs (défauts) et à la carte « Couleurs des
 * classeurs » de Paramètres. Les couleurs reprennent un sens déjà présent dans l'app
 * (types de contrat, Accompagnement en vert, Instagram en rose…) ; gris = vue d'ensemble.
 */
export type FolderPage = { id: string; label: string; tabs: { value: string; label: string; tone?: FolderTone }[] };
export const FOLDER_PAGES: readonly FolderPage[] = [
  {
    id: "fiche-createur",
    label: "Fiche créateur",
    tabs: [
      { value: "suivi", label: "Accompagnement", tone: "green" },
      { value: "infos", label: "Infos", tone: "grey" },
      { value: "activite", label: "Activité", tone: "orange" },
      { value: "mails", label: "Mails", tone: "blue" },
    ],
  },
  {
    id: "roster",
    label: "Roster",
    tabs: [
      { value: "roster", label: "Liste", tone: "blue" },
      { value: "suivi", label: "Accompagnement", tone: "green" },
    ],
  },
  {
    id: "vivier",
    label: "Scouting",
    tabs: [
      { value: "createurs", label: "Créateurs", tone: "blue" },
      { value: "sportifs", label: "Sportifs", tone: "green" },
    ],
  },
  {
    id: "mediakit",
    label: "Media kit",
    tabs: [
      { value: "creatrices", label: "Créateurs", tone: "blue" },
      { value: "agence", label: "Agence", tone: "purple" },
      { value: "files", label: "Fichiers", tone: "grey" },
    ],
  },
  {
    id: "collabs",
    label: "Collabs",
    tabs: [
      { value: "payees", label: "Payées", tone: "blue" },
      { value: "gifting", label: "Gifting", tone: "pink" },
      { value: "negociations", label: "Négociations", tone: "orange" },
    ],
  },
  {
    id: "sourcing",
    label: "Sourcing",
    tabs: [
      { value: "createurs", label: "Trouver des créateurs", tone: "blue" },
      { value: "radar", label: "Radar à marques", tone: "green" },
      { value: "concurrents", label: "Agences concurrentes", tone: "orange" },
    ],
  },
  {
    id: "contrats",
    label: "Contrats",
    tabs: [
      { value: "tous", label: "Tous", tone: "grey" },
      { value: "marque", label: "Marque × Créateur", tone: "blue" },
      { value: "repr", label: "Représentation", tone: "green" },
      { value: "ugc", label: "Contrat UGC", tone: "teal" },
    ],
  },
  {
    id: "planning",
    label: "Planning",
    tabs: [
      { value: "agenda", label: "Agenda", tone: "blue" },
      { value: "instagram", label: "Posts Instagram", tone: "pink" },
    ],
  },
  {
    id: "acces",
    label: "Accès",
    tabs: [
      { value: "comptes", label: "Comptes app", tone: "blue" },
      { value: "emails", label: "Identifiants des créateurs", tone: "teal" },
    ],
  },
  {
    id: "parametres",
    label: "Paramètres",
    tabs: [
      { value: "general", label: "Général", tone: "blue" },
      { value: "notifications", label: "Notifications", tone: "orange" },
      { value: "prospection-et-claude", label: "Prospection et Claude", tone: "purple" },
      { value: "compte", label: "Compte", tone: "grey" },
    ],
  },
];

/** Couleurs par défaut d'une page (vide si la page n'est pas listée : tout est automatique). */
export function pageDefaultTones(pageId: string): Record<string, FolderTone> {
  const out: Record<string, FolderTone> = {};
  for (const t of FOLDER_PAGES.find((p) => p.id === pageId)?.tabs ?? []) if (t.tone) out[t.value] = t.tone;
  return out;
}

// ── Couleur du cadre des classeurs (Paramètres → Couleurs des classeurs) ───────
/**
 * Blob agence `folderFrameColors` = { [page]: "#rrggbb" }, et « * » = tous les classeurs.
 * Une page sans choix prend « * », sinon le noir d'origine. Réglage d'équipe.
 */
export const FOLDER_FRAMES_KEY = "folderFrameColors";
export const ALL_FRAMES = "*";
export type FrameMap = Record<string, string>;

export const FRAME_PRESETS: { color: string; label: string }[] = [
  { color: "#292929", label: "Noir" },
  { color: "#1f2a44", label: "Bleu nuit" },
  { color: "#49060e", label: "Bordeaux TTP" },
  { color: "#1f3b2d", label: "Vert forêt" },
  { color: "#3b2547", label: "Prune" },
  { color: "#5b4636", label: "Brun" },
  { color: "#d6d6dc", label: "Gris clair" },
  { color: "#ebe4d8", label: "Sable" },
];

const HEX = /^#[0-9a-f]{6}$/i;
export function sanitizeFrameMap(raw: unknown): FrameMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: FrameMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k.length <= 40 && typeof v === "string" && HEX.test(v)) out[k] = v.toLowerCase();
  }
  return out;
}

/** Couleur du cadre d'une page : son choix, sinon celui de tous les classeurs, sinon rien (d'origine). */
export function frameColorFor(map: FrameMap | null | undefined, page: string): string | null {
  return map?.[page] ?? map?.[ALL_FRAMES] ?? null;
}

/** Cadre clair (texte foncé dessus) ? Luminance relative WCAG. */
export function isLightColor(hex: string): boolean {
  if (!HEX.test(hex)) return false;
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2] > 0.45;
}
