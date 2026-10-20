/**
 * Onglets de l'espace créateur (logique PURE, testable sous Node).
 *
 * Mobile d'abord : 5 onglets dans la barre du bas (Accueil, Missions, Messages,
 * Gains, Profil). Toutes les autres rubriques restent ouvertes depuis Profil (et
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

/** Toutes les rubriques (principales d'abord, puis celles ouvertes depuis Profil). */
export const CS_ALL_TABS: readonly CsTab[] = [
  ...CS_MAIN_TABS,
  "guide", "evolution", "rapport", "debrief", "roadmap",
  "todo", "ideas", "gifting", "planning",
  "mediakit", "documents", "contacts",
];

/**
 * Anciennes valeurs mémorisées → nouvel onglet. Briefs vit désormais dans Missions
 * (la fiche d'une mission garde statut et script), Facturation dans Gains, et
 * l'ancien écran « Plus » est devenu Profil.
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

/** Onglet du bas allumé pour une rubrique : elle-même si principale, sinon Profil. */
export function ownerTab(tab: CsTab): CsMainTab {
  return (CS_MAIN_TABS as readonly string[]).includes(tab) ? (tab as CsMainTab) : "profil";
}

export function isMainTab(tab: CsTab): tab is CsMainTab {
  return (CS_MAIN_TABS as readonly string[]).includes(tab);
}
