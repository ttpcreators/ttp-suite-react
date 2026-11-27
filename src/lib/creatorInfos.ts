/*
 * Infos que le créateur modifie lui-même (onglet Infos de son espace, saveInfos de
 * CreatorSpace). Logique PURE, testée par creatorInfos.test.ts.
 *
 * Seuls les champs vraiment changés partent en base : la base prévient l'agence en citant
 * les champs modifiés (vague 1, SQL 2026-11-27). Un champ renvoyé tel quel (vide au lieu
 * de rien, espaces en trop, date dans un autre format) ne doit pas passer pour modifié.
 */
import { toISODate } from "./dates";

/** Champs du formulaire envoyés par le créateur (ca, commission, statut : colonnes de l'agence). */
export const CHAMPS_INFOS = ["ville", "phone", "email", "email_pro", "instagram", "tiktok", "address", "siren", "birth", "followers", "er", "reach"] as const;
export type ChampInfos = (typeof CHAMPS_INFOS)[number];
type Valeurs = Partial<Record<ChampInfos, string | null | undefined>>;

/** Ce qui a changé entre la fiche lue et le formulaire (valeurs sans espaces autour). */
export function infosPatch(fiche: Valeurs, form: Valeurs): Partial<Record<ChampInfos, string>> {
  const patch: Partial<Record<ChampInfos, string>> = {};
  for (const k of CHAMPS_INFOS) {
    const next = (form[k] ?? "").trim();
    // La date de naissance s'édite au format ISO : on compare à la même forme. Une ancienne
    // date en texte libre illisible arrive vide dans le formulaire et reste donc telle quelle.
    const before = k === "birth" ? toISODate(fiche.birth) : (fiche[k] ?? "").trim();
    if (next !== before) patch[k] = next;
  }
  return patch;
}
