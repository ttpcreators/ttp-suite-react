/**
 * Dictionnaire anglais de l'espace créateur, découpé par zone pour être tenu à jour
 * sans conflit : composants partagés, espace créateur, pages annexes (mails, guide,
 * feuille de route, rapport, évolution).
 */
import { EN_SHARED } from "./en-shared";
import { EN_CREATORSPACE } from "./en-creatorSpace";
import { EN_CREATORPAGES } from "./en-creatorPages";

export const EN: Record<string, string> = { ...EN_SHARED, ...EN_CREATORSPACE, ...EN_CREATORPAGES };
