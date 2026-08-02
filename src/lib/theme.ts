import { createContext, useContext } from "react";

/**
 * Accès partagé au thème (clair/sombre). L'état vit dans App ; ce contexte permet
 * à des vues profondes (ex : Paramètres) de le lire/basculer sans faire redescendre
 * les props partout. Sur mobile, l'icône thème sort du bandeau du haut (gain de
 * place) et le réglage se fait dans Paramètres → Apparence.
 */
export const ThemeContext = createContext<{ dark: boolean; toggle: () => void }>({
  dark: false,
  toggle: () => {},
});

export const useTheme = () => useContext(ThemeContext);
