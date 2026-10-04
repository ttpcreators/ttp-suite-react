import { createContext, useContext } from "react";
import { useIsPhone } from "@/lib/iosUi";

/*
 * Bouton « + » de la barre de titre (affichage iPhone) : l'action principale d'une
 * page (« + Contact », « + Tâche »…) monte en haut à droite, comme dans les apps iOS.
 *   - NavActionSlotContext : l'emplacement dans la barre de titre (posé par la coque) ;
 *   - InPageHeaderContext  : vrai dans l'en-tête d'une page (PageHeaderRow) → les
 *     boutons « + » qui s'y trouvent montent d'eux-mêmes.
 */
export const NavActionSlotContext = createContext<HTMLElement | null>(null);
export const InPageHeaderContext = createContext(false);

/**
 * Emplacement où rendre le « + » (ou null : le bouton reste à sa place).
 * `navBar` : true = toujours monter, false = jamais, absent = seulement dans l'en-tête de page.
 */
export function useNavActionSlot(navBar?: boolean): HTMLElement | null {
  const slot = useContext(NavActionSlotContext);
  const inHeader = useContext(InPageHeaderContext);
  const phone = useIsPhone();
  if (!phone || navBar === false) return null;
  return navBar || inHeader ? slot : null;
}
