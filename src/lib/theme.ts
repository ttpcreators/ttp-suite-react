import { createContext, useContext } from "react";
import type { ThemeChoice } from "@/lib/accent";

/**
 * Accès partagé au thème. `theme` = le choix (Clair, Verre, Noir, Auto) ; `dark` =
 * le résultat est-il sombre ; `toggle` bascule clair ↔ noir (icône soleil/lune). L'état vit dans App ; ce contexte permet
 * à des vues profondes (ex : Paramètres) de le lire/basculer sans faire redescendre
 * les props partout. Sur mobile, l'icône thème sort du bandeau du haut (gain de
 * place) et le réglage se fait dans Paramètres → Apparence.
 */
export const ThemeContext = createContext<{ dark: boolean; toggle: () => void; theme: ThemeChoice; setTheme: (t: ThemeChoice) => void }>({
  dark: false,
  toggle: () => {},
  theme: "clair",
  setTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);
