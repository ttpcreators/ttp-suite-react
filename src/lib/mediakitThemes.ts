/**
 * Thèmes de couleurs des media kits publics (site vitrine, mediakit.css).
 * Les ids DOIVENT rester identiques à MK_THEMES côté site (mediakit.js,
 * mediakit-agence.js, mediakit-ugc.js et _build_mediakits.py). « minuit » = défaut.
 * Les couleurs ci-dessous ne servent qu'à l'aperçu dans l'app (bandeau, feuille, accent).
 */
export type MkThemeId = "minuit" | "ivoire" | "blanc" | "bordeaux" | "sauge";

export const MK_THEMES: { id: MkThemeId; label: string; hint: string; deep: string; paper: string; accent: string }[] = [
  { id: "minuit", label: "Minuit", hint: "Noir profond, par défaut", deep: "#000000", paper: "#0a0a0a", accent: "#fafafa" },
  { id: "ivoire", label: "Ivoire", hint: "Clair et chaud", deep: "#1c1917", paper: "#faf8f4", accent: "#8a6d4b" },
  { id: "blanc", label: "Blanc", hint: "Clair et épuré", deep: "#111113", paper: "#ffffff", accent: "#2b7fff" },
  { id: "bordeaux", label: "Bordeaux", hint: "La DA historique TTP", deep: "#3d0000", paper: "#fbf6f1", accent: "#b5525b" },
  { id: "sauge", label: "Sauge", hint: "Vert doux et naturel", deep: "#1f2a22", paper: "#f6f7f2", accent: "#6f8f64" },
];

export function mkTheme(id: string | null | undefined): MkThemeId {
  return MK_THEMES.some((t) => t.id === id) ? (id as MkThemeId) : "minuit";
}

/**
 * Media kits CRÉATEURS (direction « Éditorial », kit-editorial.css côté site, 2026-10-05) :
 * page blanche + encre ; le thème change l'encre (nom en italique, grands chiffres) ou le
 * papier. « blanc » = défaut. Le deck agence garde MK_THEMES ci-dessus.
 */
export const CREATOR_THEMES: { id: MkThemeId; label: string; hint: string; paper: string; ink: string; accent: string }[] = [
  { id: "blanc", label: "Blanc", hint: "Page blanche, encre noire (défaut)", paper: "#fcfcfb", ink: "#121212", accent: "#121212" },
  { id: "bordeaux", label: "Bordeaux", hint: "Touches bordeaux TTP", paper: "#fcfcfb", ink: "#121212", accent: "#4a0a0e" },
  { id: "sauge", label: "Sauge", hint: "Touches vert sauge", paper: "#fbfcf9", ink: "#121212", accent: "#2f4a36" },
  { id: "ivoire", label: "Ivoire", hint: "Papier ivoire", paper: "#f7f3ec", ink: "#121212", accent: "#121212" },
  { id: "minuit", label: "Minuit", hint: "Page noire, encre blanche", paper: "#0d0d0d", ink: "#f1f1ee", accent: "#f1f1ee" },
];

export function mkCreatorTheme(id: string | null | undefined): MkThemeId {
  return CREATOR_THEMES.some((t) => t.id === id) ? (id as MkThemeId) : "blanc";
}
