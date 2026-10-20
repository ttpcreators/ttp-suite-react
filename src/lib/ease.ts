/** Courbes et ressorts d'animation communs aux composants animés (loader, onglets, barres). */
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
/** Glissement doux (onglets qui se déplacent, surface qui suit l'onglet actif). */
export const SPRING_GLIDE = { type: "spring", stiffness: 380, damping: 36, mass: 0.8 } as const;
/** Apparition vive d'un contenu (changement d'onglet). */
export const SPRING_PRESS = { type: "spring", stiffness: 520, damping: 34, mass: 0.6 } as const;
/** Petit élément qui s'ouvre ou se replie (icône d'onglet). */
export const SPRING_SWAP = { type: "spring", stiffness: 480, damping: 34, mass: 0.7 } as const;
