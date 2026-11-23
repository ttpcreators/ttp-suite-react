/**
 * Créateur en exclusivité avec l'agence (interrupteur « Créateur en exclusivité » de la fiche).
 * Deux traces : la colonne `creators.exclu` (défaut false, lue par le serveur et le connecteur
 * Claude) et la clé de blob `creatorExclusive` (nom en minuscules → oui / non), la plus
 * ancienne. La colonne n'en est la copie que depuis peu : un créateur exclusif dans l'une OU
 * l'autre est exclusif (jamais d'exclusivité perdue en silence). Les deux sont réécrites
 * ensemble quand on change l'interrupteur ; sql/2026-11-23-exclu-rattrapage.sql recopie le
 * blob dans la colonne. Les exclusivités de MARQUE (dates, concurrents, contrat) sont une
 * autre chose : clé `exclusivites`, page Exclusivités.
 */
export const EXCLU_BLOB_KEY = "creatorExclusive";

/** Clé du créateur dans la copie du blob. */
export const excluKey = (name: string) => name.trim().toLowerCase();

/** La fiche lue (`select *`) porte-t-elle la colonne ? Sinon (SQL pas lancé), seule la copie est écrite. */
export function hasExcluColumn(row: object | null | undefined): boolean {
  return !!row && "exclu" in row;
}

/** Exclusif : la colonne OU la clé du blob dit oui. */
export function estExclusif(row: { exclu?: boolean | null } | null | undefined, blob: Record<string, boolean> | null | undefined, name: string): boolean {
  return row?.exclu === true || blob?.[excluKey(name)] === true;
}

/**
 * Ce qu'il faut écrire à l'enregistrement de la fiche : rien si l'interrupteur n'a pas été
 * touché (un enregistrement des coordonnées n'efface jamais une exclusivité), sinon la
 * même valeur dans la colonne (si elle existe) et dans le blob.
 */
export function excluAEcrire(touched: boolean, value: boolean, withColumn: boolean): { column: boolean | null; blob: boolean | null } {
  if (!touched) return { column: null, blob: null };
  return { column: withColumn ? value : null, blob: value };
}
