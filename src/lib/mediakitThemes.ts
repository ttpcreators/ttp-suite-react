/**
 * Thèmes de couleurs des media kits publics (site vitrine). Les ids DOIVENT rester
 * identiques à MK_THEMES côté site (mediakit.js, mediakit-agence.js, mediakit-ugc.js et
 * _build_mediakits.py). Les couleurs ci-dessous ne servent qu'à l'aperçu dans l'app.
 */
export type MkThemeId = "minuit" | "ivoire" | "blanc" | "bordeaux" | "sauge";

/**
 * Media kits CRÉATEURS (direction « Éditorial », kit-editorial.css côté site, 2026-10-05) :
 * page blanche + encre ; le thème change l'encre (nom en italique, grands chiffres) ou le
 * papier. « blanc » = défaut. Le deck AGENCE utilise aussi ces thèmes depuis 2026-10-05
 * (agence-editorial.js). Les kits UGC gardent l'ancienne palette « Minuit » côté site (mêmes ids,
 * la page UGC suit mediakit.theme) ; plus aucun sélecteur de l'app ne l'affiche.
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
