import { createContext, useContext } from "react";

/**
 * Sous-onglet demandé pour la vue active (3e niveau de nav : ex. Media kit → « Agence »,
 * Contrats → « Représentation »). `null` = onglet par défaut de la vue. Fourni par App
 * autour de la vue primaire ; les vues concernées le lisent via `useNavSub()` et calent
 * leur onglet dessus.
 */
export const NavSubContext = createContext<string | null>(null);
export const useNavSub = () => useContext(NavSubContext);
