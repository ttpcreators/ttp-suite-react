// ============================================================================
// _shared/disposDuMoisDb.ts : crée ou met à jour la liste « Dispos de <mois> ».
// ----------------------------------------------------------------------------
// Lit le roster (`creators`) et le blob agence (barème de la page Tarifs, exclusivités),
// calcule la sélection (logique pure : disposDuMois.ts) et la range dans `creator_lists`,
// lien public activé. Une seule liste par mois : on la retrouve par son adresse
// (« dispos-2026-12- » suivi de 20 caractères au hasard) et on la met à jour. La page publique
// la lit par la fonction SQL liste_publique, avec l'adresse exacte. Utilisé par l'app (bouton « Générer les
// dispos du mois », client de l'utilisateur, RLS agence), le connecteur Claude (outil
// `dispos_du_mois`) et la fonction du 1er du mois `dispos-du-mois` (client serveur).
// Avant le SQL 2026-11-22-dispos-du-mois.sql (colonne `dispos`), la liste est enregistrée
// sans prix ni exclusivités (l'ancienne page montre alors les chiffres Instagram), et le
// résultat le dit (`sansDispos`).
// ============================================================================

import { readAppState } from "./appState.ts";
import { disposDuMois, hasardSlug, introDispos, prefixeDispos, slugDispos, titreDispos, type DisposCreatorRow, type DisposResultat } from "./disposDuMois.ts";

// deno-lint-ignore no-explicit-any
type Sb = { from: (table: string) => any };
type DbError = { code?: string; message?: string } | null;

export const DISPOS_SITE = "https://ttpcreators.pro/selection/?l=";
const COLS = "id, name, status, niche, photo_url, instagram, tiktok, sort_order, ig, tt, yt, kit:mediakit->platforms";

const colonneAbsente = (e: DbError) => !!e && (e.code === "42703" || e.code === "PGRST204" || /dispos/.test(e.message ?? ""));
const tableAbsente = (e: DbError) => !!e && (e.code === "42P01" || e.code === "PGRST205");

export type DisposEnregistrees =
  | { ok: true; url: string; slug: string; titre: string; cree: boolean; sansDispos: boolean; resultat: DisposResultat }
  | { ok: false; error: string };

export async function genererDisposDuMois(sb: Sb, mois: string, now = new Date(), hasard = hasardSlug()): Promise<DisposEnregistrees> {
  const { data: rows, error: e1 } = await sb.from("creators").select(COLS).order("sort_order", { ascending: true });
  if (e1) return { ok: false, error: `Roster illisible : ${e1.message}` };
  let blob: Record<string, unknown>;
  try {
    blob = await readAppState(sb);
  } catch (e) {
    return { ok: false, error: `Réglages de l'agence illisibles : ${(e as Error).message}` };
  }
  const resultat = disposDuMois({ creators: (rows ?? []) as DisposCreatorRow[], pricingRates: blob.pricingRates, exclusivites: blob.exclusivites, mois, now });

  const { data: found, error: e2 } = await sb.from("creator_lists").select("id, slug").like("slug", `${prefixeDispos(mois)}%`).order("created_at", { ascending: true }).limit(1);
  if (e2) return { ok: false, error: tableAbsente(e2) ? "Les listes n'existent pas encore : lancer le SQL 2026-11-16-base-createurs.sql." : `Listes illisibles : ${e2.message}` };
  const existing = ((found ?? []) as { id: string; slug: string }[])[0];
  const titre = titreDispos(mois);
  const base = { title: titre, brand: "les agences", intro: introDispos(mois), usernames: resultat.usernames, public: true, updated_at: now.toISOString() };

  const save = async (row: Record<string, unknown>): Promise<{ slug: string; error: DbError }> => {
    if (existing) {
      const { error } = await sb.from("creator_lists").update(row).eq("id", existing.id);
      return { slug: existing.slug, error };
    }
    const slug = slugDispos(mois, hasard);
    const { error } = await sb.from("creator_lists").insert({ ...row, slug });
    return { slug, error };
  };

  let sansDispos = false;
  let r = await save({ ...base, dispos: resultat.selection });
  if (r.error && colonneAbsente(r.error)) {
    sansDispos = true;
    r = await save(base);
  }
  if (r.error) return { ok: false, error: `Liste non enregistrée : ${r.error.message}` };
  return { ok: true, url: DISPOS_SITE + r.slug, slug: r.slug, titre, cree: !existing, sansDispos, resultat };
}
