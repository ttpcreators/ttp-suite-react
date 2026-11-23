/**
 * Brief lu et concept proposé par le créateur (logique PURE, testée). Colonnes de
 * `briefs` ajoutées par sql/2026-11-23-espace-createur-collab.sql : `read_at` (« J'ai
 * lu »), `concept`, `concept_link`, `concept_at`, `concept_status` (« propose » ou
 * « valide »), `concept_validated_at`. Le créateur propose ; seule l'agence valide, et
 * c'est la validation qui fait passer la collab à l'étape 3 « Concept validé ».
 */
import { normalizeLink } from "./collabPosts";

export type BriefConcept = {
  id: string;
  read_at: string | null;
  concept: string | null;
  concept_link: string | null;
  concept_at: string | null;
  concept_status: string | null;
  concept_validated_at: string | null;
};

export const CONCEPT_COLS = "id,read_at,concept,concept_link,concept_at,concept_status,concept_validated_at";

/** Longueur maximale d'un concept (texte court). */
export const CONCEPT_MAX = 600;

export type ConceptState = "aucun" | "propose" | "valide";

export function conceptState(c: Pick<BriefConcept, "concept" | "concept_status"> | null | undefined): ConceptState {
  if (!c || !String(c.concept ?? "").trim()) return "aucun";
  return c.concept_status === "valide" ? "valide" : "propose";
}

/** Colonnes pas encore créées en prod (SQL pas lancé). */
export function conceptColumnsMissing(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false;
  if (e.code === "42703" || e.code === "PGRST204") return true;
  return /(read_at|concept)/i.test(e.message ?? "") && /column|schema cache|does not exist/i.test(e.message ?? "");
}

/** Texte et lien saisis → valeurs à enregistrer, ou l'erreur à afficher. */
export function cleanConcept(text: string, link: string): { concept: string; link: string | null } | { error: "vide" | "long" | "lien" } {
  const concept = text.trim();
  if (!concept) return { error: "vide" };
  if (concept.length > CONCEPT_MAX) return { error: "long" };
  if (!link.trim()) return { concept, link: null };
  const l = normalizeLink(link);
  return l ? { concept, link: l } : { error: "lien" };
}

type BriefLike = { id: string; brand?: string | null; creator?: string | null; collab_id?: string | null; created_at?: string | null };
const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

/**
 * Le brief d'une collab : celui que la collab désigne (`brief_id`), sinon celui relié à
 * elle (`collab_id`), sinon le plus récent du même créateur pour la même marque.
 */
export function briefForCollab<B extends BriefLike>(
  collab: { id: string; brief_id?: string | null; brand: string; creator: string | null },
  briefs: B[],
): B | null {
  if (collab.brief_id) {
    const b = briefs.find((x) => x.id === collab.brief_id);
    if (b) return b;
  }
  const linked = briefs.find((x) => x.collab_id === collab.id);
  if (linked) return linked;
  const same = briefs
    .filter((x) => !x.collab_id && norm(x.brand) !== "" && norm(x.brand) === norm(collab.brand) && norm(x.creator) === norm(collab.creator))
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  return same[0] ?? null;
}
