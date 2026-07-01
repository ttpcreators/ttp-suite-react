import { createContext, useContext } from "react";

/** Recherche partagée : filtre la vue courante. Le state vit dans App. */
export const SearchContext = createContext<{
  query: string;
  setQuery: (q: string) => void;
}>({ query: "", setQuery: () => {} });

export function useSearch() {
  return useContext(SearchContext);
}

/** true si la requête est vide ou si l'un des champs la contient. */
export function matchQuery(
  q: string,
  ...fields: (string | number | null | undefined)[]
): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return fields.some((f) => String(f ?? "").toLowerCase().includes(s));
}
