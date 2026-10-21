/*
 * Adresses mail d'un créateur (section « Mails ») : l'adresse principale (`alias`)
 * et ses adresses en plus (`aliases`, ex. son adresse perso). Règles PURES, testées
 * par mailAddresses.test.ts. Le serveur (creator-mail) et la base (trigger) refont
 * les mêmes contrôles : ici, c'est seulement pour prévenir tout de suite.
 */
import { SHARED_BOXES } from "./mailAvatar";

/** Adresse e-mail normalisée (minuscules, sans espaces autour), "" si invalide. */
export function normAddress(s: string | null | undefined): string {
  const t = String(s ?? "").trim().toLowerCase();
  return /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/.test(t) ? t : "";
}

/** Toutes les adresses d'un créateur : la principale d'abord, puis les autres, sans doublon. */
export function allAddresses(alias: string | null | undefined, aliases?: readonly (string | null | undefined)[] | null): string[] {
  const out: string[] = [];
  for (const a of [alias, ...(aliases ?? [])]) {
    const n = normAddress(a);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Adresses en plus à enregistrer : valides, sans doublon, sans l'adresse principale. */
export function extraAddresses(alias: string | null | undefined, aliases: readonly (string | null | undefined)[] | null | undefined): string[] {
  const main = normAddress(alias);
  return allAddresses(null, aliases).filter((a) => a !== main);
}

/** Message affiché quand une boîte commune est choisie (même texte que pour l'alias). */
export const SHARED_BOX_MESSAGE = "C'est une boîte commune : mets son alias à lui (ex. prenom@ttpcreators.pro)";
export const INVALID_ADDRESS_MESSAGE = "Adresse invalide : il faut une adresse e-mail complète";
export const DUPLICATE_ADDRESS_MESSAGE = "Cette adresse est déjà dans la liste";

/**
 * Contrôle d'une adresse à ajouter : format, boîte commune de l'agence, déjà présente
 * (adresse principale comprise). Renvoie l'adresse normalisée, ou le message d'erreur.
 */
export function checkNewAddress(
  input: string,
  current: { alias?: string | null; aliases?: readonly string[] | null },
): { address: string } | { error: string } {
  const address = normAddress(input);
  if (!address) return { error: INVALID_ADDRESS_MESSAGE };
  if (SHARED_BOXES.test(address)) return { error: SHARED_BOX_MESSAGE };
  if (allAddresses(current.alias, current.aliases).includes(address)) return { error: DUPLICATE_ADDRESS_MESSAGE };
  return { address };
}

/** « a », « a ou b », « a, b ou c » (le mot de liaison est fourni, pour la traduction). */
export function joinWith(list: readonly string[], last: string): string {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} ${last} ${list[list.length - 1]}`;
}

/** Colonne `aliases` absente (SQL des adresses pas encore lancé) ? */
export function aliasesColumnMissing(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "42703" || e.code === "PGRST204" || /aliases/i.test(e.message ?? "");
}
