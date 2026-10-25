import { createContext, useCallback, useContext, type ReactNode } from "react";
import { EN } from "./i18n/en";

/**
 * Langue de l'ESPACE CRÉATEUR (un créateur anglophone le voit en anglais ; l'espace
 * agence reste en français). Le texte français sert de clé : t("Mes factures") renvoie
 * la traduction anglaise si elle existe, sinon le français (jamais de trou à l'écran).
 * Variables : t("Bonjour {name}", { name }) ; la traduction garde les mêmes {…}.
 * Hors d'un LangProvider (toute l'app agence), la langue est le français.
 */
export type Lang = "fr" | "en";

const LangContext = createContext<Lang>("fr");

export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext);
}

export type Vars = Record<string, string | number>;

export function translate(lang: Lang, fr: string, vars?: Vars): string {
  // hasOwn : « constructor », « toString »… ne sont ni des traductions ni des variables.
  const s = lang === "en" && Object.hasOwn(EN, fr) ? EN[fr] : fr;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (Object.hasOwn(vars, k) ? String(vars[k]) : m)) : s;
}

/** t(texteFrançais, variables?) dans la langue de l'espace. */
export function useT(): (fr: string, vars?: Vars) => string {
  const lang = useLang();
  return useCallback((fr: string, vars?: Vars) => translate(lang, fr, vars), [lang]);
}

/** Locale des dates et nombres (« 20 octobre » / « 20 October »). */
export function localeOf(lang: Lang): string {
  return lang === "en" ? "en-GB" : "fr-FR";
}
export function useLocale(): string {
  return localeOf(useLang());
}

/** Langue enregistrée sur la fiche créateur (colonne `lang`), français par défaut. */
export function langOf(v: unknown): Lang {
  return v === "en" ? "en" : "fr";
}
