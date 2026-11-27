// ============================================================================
// _shared/ecritureLot.ts : écrire des lignes par paquets sans perdre tout le paquet.
// ----------------------------------------------------------------------------
// Une seule ligne refusée par Postgres (texte illisible, valeur trop longue…) fait refuser
// tout le paquet écrit avec elle : 200 marques du radar perdues d'un coup, sans bruit
// (bug du 27/11/2026). Ici, un paquet refusé pour ses DONNÉES est réécrit ligne par ligne :
// seule la mauvaise ligne est perdue, et l'appelant sait lesquelles (diagnostic, journal).
// Une panne (réseau, table absente, délai dépassé) n'est pas réessayée ligne par ligne :
// chaque ligne échouerait pareil, en autant de requêtes. De même, si les 10 premières lignes
// réessayées sont toutes refusées (colonne obligatoire ajoutée, contrainte qui touche tout le
// paquet), le reste du paquet est compté refusé sans être réessayé.
// Sans dépendance (l'appelant passe l'écriture). Partagé par les fonctions et par l'app.
// Testé par ecritureLot.test.ts.
// ============================================================================

export type ErreurBase = { code?: string; message: string };

/** La base refuse les données elles-mêmes (codes Postgres 22… et 23…), pas une panne. */
export function refusDeDonnees(e: { code?: string } | null | undefined): boolean {
  const code = e?.code ?? "";
  return /^2[23]/.test(code) || code === "PGRST102";
}

/** Lignes refusées (vide si tout est écrit) et le premier message d'erreur de la base. */
export type BilanLots<T> = { refusees: T[]; erreur: string | null };

/**
 * Écrit `lignes` par paquets de `taille` avec `ecrire` (un upsert ou un insert Supabase).
 * Un paquet refusé pour ses données est réécrit ligne par ligne, sauf si ses 10 premières
 * lignes sont toutes refusées : le reste du paquet est alors compté refusé sans requête.
 */
export async function ecrireParLots<T>(
  lignes: readonly T[],
  taille: number,
  ecrire: (lot: T[]) => PromiseLike<{ error: ErreurBase | null }>,
): Promise<BilanLots<T>> {
  const refusees: T[] = [];
  let erreur: string | null = null;
  const pas = Math.max(1, Math.floor(taille) || 1);
  for (let i = 0; i < lignes.length; i += pas) {
    const lot = lignes.slice(i, i + pas);
    const { error } = await ecrire(lot);
    if (!error) continue;
    erreur ??= error.message;
    if (lot.length === 1 || !refusDeDonnees(error)) {
      refusees.push(...lot);
      continue;
    }
    let ecrites = 0;
    let refusesSeules = 0;
    for (const ligne of lot) {
      // Les 10 premières refusées et aucune écrite : la cause touche tout le paquet, inutile d'insister.
      if (!ecrites && refusesSeules >= 10) {
        refusees.push(ligne);
        continue;
      }
      const seule = await ecrire([ligne]);
      if (seule.error) {
        refusees.push(ligne);
        refusesSeules++;
      } else ecrites++;
    }
  }
  return { refusees, erreur };
}
