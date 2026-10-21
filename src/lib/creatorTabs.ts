/**
 * Onglets de l'espace créateur (logique PURE, testable sous Node).
 *
 * Mobile d'abord : 5 onglets dans la barre du bas (Accueil, Missions, Mail,
 * Gains, Plus). Toutes les autres rubriques sont en tuiles en tête de Plus (et
 * depuis le menu ordinateur). L'onglet choisi est mémorisé (`ttp:cs-tab`) ; les
 * anciennes valeurs (« briefs », « facturation »…) sont ramenées vers le nouvel
 * onglet qui les contient, pour que personne n'atterrisse sur un onglet cassé.
 */

export type CsTab =
  | "accueil" | "missions" | "mails" | "gains" | "profil"
  | "guide" | "evolution" | "rapport" | "debrief" | "roadmap"
  | "todo" | "ideas" | "gifting" | "planning"
  | "mediakit" | "documents" | "contacts";

/** Les 5 onglets de la barre du bas, dans l'ordre de la maquette. */
export const CS_MAIN_TABS = ["accueil", "missions", "mails", "gains", "profil"] as const satisfies readonly CsTab[];
export type CsMainTab = (typeof CS_MAIN_TABS)[number];

/** Toutes les rubriques (principales d'abord, puis celles ouvertes depuis Plus). */
export const CS_ALL_TABS: readonly CsTab[] = [
  ...CS_MAIN_TABS,
  "guide", "evolution", "rapport", "debrief", "roadmap",
  "todo", "ideas", "gifting", "planning",
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

/** Onglet du bas allumé pour une rubrique : elle-même si principale, sinon Plus (id « profil »). */
export function ownerTab(tab: CsTab): CsMainTab {
  return (CS_MAIN_TABS as readonly string[]).includes(tab) ? (tab as CsMainTab) : "profil";
}

export function isMainTab(tab: CsTab): tab is CsMainTab {
  return (CS_MAIN_TABS as readonly string[]).includes(tab);
}

// ── Favoris du créateur : ses rubriques préférées, en tête du menu et sur l'Accueil ──
/** Rubriques qu'on peut mettre en favori (Accueil et Plus sont toujours dans la barre). */
export const CS_FAVORABLE: readonly CsTab[] = CS_ALL_TABS.filter((t) => t !== "accueil" && t !== "profil");

/** Liste gardée (texte JSON) → favoris valides, sans doublon, dans l'ordre d'ajout. */
export function parseCsFavorites(raw: string | null | undefined): CsTab[] {
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

/** Ajoute ou retire une rubrique des favoris. */
export function toggleCsFavorite(favs: CsTab[], tab: CsTab): CsTab[] {
  if (favs.includes(tab)) return favs.filter((t) => t !== tab);
  return (CS_FAVORABLE as readonly string[]).includes(tab) ? [...favs, tab] : favs;
}
