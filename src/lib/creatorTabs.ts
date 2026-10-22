/**
 * Onglets de l'espace créateur (logique PURE, testable sous Node).
 *
 * Mobile d'abord : 4 onglets dans la barre du bas (Accueil, Missions, Gains,
 * Mail ; demande de Marc, 2026-10-22). Toutes les autres rubriques (À faire,
 * Idées, documents, profil, réglages…) sont dans le Menu, ouvert par l'avatar en
 * haut à droite (id « profil »), et dans le menu ordinateur. L'onglet choisi est mémorisé (`ttp:cs-tab`) ; les
 * anciennes valeurs (« briefs », « facturation »…) sont ramenées vers le nouvel
 * onglet qui les contient, pour que personne n'atterrisse sur un onglet cassé.
 */

export type CsTab =
  | "accueil" | "missions" | "mails" | "gains" | "profil"
  | "guide" | "evolution" | "rapport" | "debrief" | "roadmap"
  | "aujourdhui" | "todo" | "ideas" | "gifting" | "planning"
  | "mediakit" | "documents" | "contacts";

/** Les 4 onglets de la barre du bas. */
export const CS_MAIN_TABS = ["accueil", "missions", "gains", "mails"] as const satisfies readonly CsTab[];
export type CsMainTab = (typeof CS_MAIN_TABS)[number];

/** Le Menu (avatar en haut à droite) : profil, réglages et toutes les autres rubriques. */
export const CS_MENU_TAB = "profil" as const satisfies CsTab;

/** Toutes les rubriques (principales d'abord, puis le Menu et celles qu'il ouvre). */
export const CS_ALL_TABS: readonly CsTab[] = [
  ...CS_MAIN_TABS,
  CS_MENU_TAB,
  "guide", "evolution", "rapport", "debrief", "roadmap",
  "aujourdhui", "todo", "ideas", "gifting", "planning",
  "mediakit", "documents", "contacts",
];

/**
 * Anciennes valeurs mémorisées → nouvel onglet. Briefs vit désormais dans Missions
 * (la fiche d'une mission garde statut et script), Facturation dans Gains, et
 * l'onglet « profil » s'affiche « Plus » (rubriques + profil).
 */
export const CS_TAB_ALIASES: Record<string, CsTab> = {
  briefs: "missions",
  facturation: "gains",
  __more: "profil",
  messages: "mails",
};

/** Valeur lue dans le stockage → onglet valide (Accueil par défaut). */
export function normalizeCsTab(saved: string | null | undefined): CsTab {
  const v = String(saved ?? "").trim();
  if (!v) return "accueil";
  if (v in CS_TAB_ALIASES) return CS_TAB_ALIASES[v];
  return (CS_ALL_TABS as readonly string[]).includes(v) ? (v as CsTab) : "accueil";
}

/** Onglet du bas allumé pour une rubrique : elle-même si principale, sinon aucun (rubrique du Menu). */
export function ownerTab(tab: CsTab): CsMainTab | null {
  return (CS_MAIN_TABS as readonly string[]).includes(tab) ? (tab as CsMainTab) : null;
}

export function isMainTab(tab: CsTab): tab is CsMainTab {
  return (CS_MAIN_TABS as readonly string[]).includes(tab);
}

// ── Favoris du créateur : ses rubriques préférées, en tête du menu et sur l'Accueil ──
/**
 * Favoris d'office de CHAQUE créateur (demande de Marc, 2026-10-22) : toujours en tête,
 * on ne peut pas les retirer. Les favoris choisis par le créateur viennent après.
 */
export const CS_FIXED_FAVORITES: readonly CsTab[] = ["accueil", "todo", "ideas", "mails"];

/** Rubriques qu'on peut ajouter ou retirer des favoris (ni Plus, ni les favoris d'office). */
export const CS_FAVORABLE: readonly CsTab[] = CS_ALL_TABS.filter((t) => t !== "profil" && !CS_FIXED_FAVORITES.includes(t));

/** Favoris choisis d'office pour un créateur qui n'a encore rien choisi (en plus des fixes). */
export const CS_DEFAULT_FAVORITES: readonly CsTab[] = [];

/**
 * Liste gardée (texte JSON) → favoris CHOISIS valides, sans doublon, dans l'ordre d'ajout
 * (les favoris d'office n'y sont jamais : voir `csFavoritesShown`). Rien de gardé →
 * `CS_DEFAULT_FAVORITES`.
 */
export function parseCsFavorites(raw: string | null | undefined): CsTab[] {
  if (raw == null) return [...CS_DEFAULT_FAVORITES];
  try {
    const arr = JSON.parse(raw ?? "[]");
    if (!Array.isArray(arr)) return [];
    const out: CsTab[] = [];
    for (const v of arr) {
      const t = typeof v === "string" ? (v in CS_TAB_ALIASES ? CS_TAB_ALIASES[v] : v) : "";
      if ((CS_FAVORABLE as readonly string[]).includes(t) && !out.includes(t as CsTab)) out.push(t as CsTab);
    }
    return out;
  } catch {
    return [];
  }
}

/** Favoris affichés : ceux d'office d'abord, puis ceux choisis par le créateur. */
export function csFavoritesShown(chosen: readonly CsTab[]): CsTab[] {
  return [...CS_FIXED_FAVORITES, ...chosen.filter((t) => !CS_FIXED_FAVORITES.includes(t))];
}

/** Ajoute ou retire une rubrique des favoris choisis (sans effet sur ceux d'office). */
export function toggleCsFavorite(favs: CsTab[], tab: CsTab): CsTab[] {
  if (favs.includes(tab)) return favs.filter((t) => t !== tab);
  return (CS_FAVORABLE as readonly string[]).includes(tab) ? [...favs, tab] : favs;
}
