/**
 * Créateur en exclusivité avec l'agence (interrupteur « Créateur en exclusivité » de la fiche).
 * Source : la colonne `creators.exclu`, lue aussi par le serveur et le connecteur Claude.
 * La clé de blob `creatorExclusive` (nom en minuscules → oui / non) n'est qu'une copie,
 * réécrite à chaque enregistrement ; elle sert de repli si la colonne manque (ligne lue
 * sans elle, valeur jamais posée). Les exclusivités de MARQUE (dates, concurrents,
 * contrat) sont une autre chose : clé `exclusivites`, page Exclusivités.
 */
export const EXCLU_BLOB_KEY = "creatorExclusive";

/** Clé du créateur dans la copie du blob. */
export const excluKey = (name: string) => name.trim().toLowerCase();

/** La fiche lue (`select *`) porte-t-elle la colonne ? Sinon (SQL pas lancé), seule la copie est écrite. */
export function hasExcluColumn(row: object | null | undefined): boolean {
  return !!row && "exclu" in row;
}

/** Exclusif ou non : la colonne d'abord, la copie du blob en repli. */
export function estExclusif(row: { exclu?: boolean | null } | null | undefined, blob: Record<string, boolean> | null | undefined, name: string): boolean {
  if (row && typeof row.exclu === "boolean") return row.exclu;
  return blob?.[excluKey(name)] === true;
}
