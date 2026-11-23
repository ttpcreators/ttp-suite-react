/*
 * Les étapes qui avancent toutes seules (règles PURES, testées par collabAuto.test.ts).
 * Les règles vivent dans supabase/functions/_shared/collabAuto.ts, partagées avec le
 * connecteur Claude ; ce fichier les reprend et y ajoute les textes affichés dans l'app.
 *   • facture d'une collab passée « payée » → étape 9 « Paiement marque reçu » ;
 *   • versement au créateur qui solde sa facture → étape 10 « Créateur payé » ;
 *   • collab créée ou gagnée → le prospect ouvert de la marque passe « Signé ».
 */
import { collabLabel } from "./collabLinks";
import { stepDef } from "./collabs";

export {
  ETAPE_CREATEUR_PAYE, ETAPE_PAIEMENT_MARQUE, TOLERANCE_EUR, cachetGifting, collabDeFacture, collabsSoldees, etapeAAtteindre,
  memeMarque, prospectASigner, prospectOuvert, type CollabAuto, type LigneDue, type ProspectAuto,
} from "../../supabase/functions/_shared/collabAuto.ts";

/** Toast d'une collab avancée toute seule : « Nike × Léna : étape 9 · Paiement marque ✓ ». */
export function texteAvance(a: { brand: string; creator: string | null; step: number }): string {
  return `${collabLabel(a)} : étape ${a.step} · ${stepDef(a.step).short} ✓`;
}

/** Toast d'un prospect passé « Signé » tout seul. */
export function texteProspectSigne(brand: string): string {
  return `Prospect ${brand.trim() || "de la marque"} passé en « Signée » ✓`;
}
