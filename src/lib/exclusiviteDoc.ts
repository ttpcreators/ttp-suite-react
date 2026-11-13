import { supabase } from "@/lib/supabase";
import { titleCase } from "@/lib/utils";

/** Nom du contrat dans Documents : « Contrat · Marque · Créatrice ». */
export const contractDocName = (brand: string, creator: string) =>
  ["Contrat", brand.trim(), creator.trim() ? titleCase(creator.trim()) : ""].filter(Boolean).join(" · ");

/**
 * Le contrat PDF lu dans Exclusivités (déposé à la main ou reçu par mail) est aussi rangé
 * dans Documents, au nom de la créatrice : il apparaît dans Documents (agence) et dans
 * l'onglet Documents de son espace. Une seule ligne par fichier : si elle existe déjà, on
 * la remet au bon nom et à la bonne créatrice (fiche corrigée). Jamais bloquant : la fiche
 * d'exclusivité est déjà enregistrée, on prévient seulement si le rangement a échoué.
 */
export async function fileContractDoc(e: { creator: string; brand: string; docPath?: string | null }): Promise<boolean> {
  const path = e.docPath;
  if (!path) return true;
  const creator = e.creator.trim() || null;
  const name = contractDocName(e.brand, e.creator);
  const { data, error } = await supabase.from("documents").select("id, creator, name, type").eq("path", path).limit(1);
  if (error) return false;
  const found = data?.[0] as { id: string; creator: string | null; name: string; type: string | null } | undefined;
  if (found) {
    // Fichier déjà rangé sous un autre type (le PDF d'un brief, par exemple) : on n'y touche pas.
    if (found.type !== "contract") return true;
    if (found.creator === creator && found.name === name) return true;
    const { error: upErr } = await supabase.from("documents").update({ creator, name }).eq("id", found.id);
    return !upErr;
  }
  const { error: insErr } = await supabase.from("documents").insert({ creator, name, type: "contract", size: null, path, sort_order: 0 });
  return !insErr;
}
