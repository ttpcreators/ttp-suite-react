/**
 * Contrôle qualité des données (section « À corriger » d'Aujourd'hui).
 * La logique vit dans supabase/functions/_shared/controle.ts : le MÊME code sert à l'app
 * et au connecteur Claude (outil controle_donnees, lu par Alfred chaque matin). Ici,
 * seulement ce qui est propre à la page : ne pas répéter ce qu'Aujourd'hui affiche déjà.
 */
import type { Probleme } from "../../supabase/functions/_shared/controle.ts";

export {
  IGNORES_KEY,
  JOURS_SANS_FACTURE,
  TITRE_MAX,
  controler,
  lectureCachet,
  lireIgnores,
  sansIgnores,
  type ControleInput,
  type Correction,
  type CtrlCollab,
  type CtrlContact,
  type CtrlCreator,
  type CtrlInvoice,
  type CtrlProspect,
  type CtrlStep,
  type CtrlTodo,
  type Gravite,
  type Ignores,
  type Lien,
  type Probleme,
  type RegleId,
} from "../../supabase/functions/_shared/controle.ts";

/**
 * Pas de doublon avec la page : une collab déjà listée dans « Collabs à faire avancer »
 * (bloquée depuis 7 jours) n'est pas répétée par « publiée sans facture », qui dit la même
 * chose (elle n'avance plus après la publication).
 */
export function sansDoublonAujourdhui(list: Probleme[], collabsAffichees: ReadonlySet<string>): Probleme[] {
  return list.filter((p) => !(p.regle === "publiee_sans_facture" && p.lien.item && collabsAffichees.has(p.lien.item)));
}

/** Teinte de la tuile d'une gravité (orange pour ce qui demande un geste, gris sinon). */
export function toneOf(g: Probleme["gravite"]): "wait" | "info" | "closed" {
  return g === "haute" ? "wait" : g === "moyenne" ? "info" : "closed";
}
