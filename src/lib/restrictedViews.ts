import { createContext, useContext } from "react";
import type { ViewId } from "./nav";

/**
 * Pages que le profil connecté ne peut PAS ouvrir (membre d'équipe : Finance, Accès,
 * Agents…). Posé par App ; « Aujourd'hui » et la palette ⌘K s'en servent pour ne
 * jamais proposer une action qui mène à une page fondateur.
 */
export const RestrictedViewsContext = createContext<readonly ViewId[]>([]);
export const useRestrictedViews = () => useContext(RestrictedViewsContext);
