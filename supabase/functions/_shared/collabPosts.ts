// ============================================================================
// _shared/collabPosts.ts : un post de la créatrice cite-t-il la marque de la collab ?
// (ig-sync, publications rattachées aux collabs, qui préremplissent Debrief).
// ----------------------------------------------------------------------------
// Meta retire les @ des légendes : « @yade.paris » arrive « yade.paris ». On reconnaît :
//   - le compte de la marque noté dans ses fiches contact (avec ou sans . et _) ;
//   - le nom de la marque collé (« Prison Island » → « prisonisland ») ;
//   - le nom de la marque en mot entier (4 lettres et plus) ;
//   - (audit du 22/11/2026) un compte qui COMMENCE par le nom de la marque, suivi d'un
//     suffixe court (« yade.paris », « kosbioticfr », « nutripure_officiel ») : la plupart
//     des marques n'ont pas leur compte noté dans le carnet.
// Règle PURE, testée par collabPosts.test.ts.
// ============================================================================

import { citesHandle } from "./mentions.ts";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Suffixes de compte courants après le nom de la marque. */
const SUFFIXE = "(?:[._]?(?:fr|france|paris|officiel|official|offi?|store|shop|app|co|club|world|lab|beauty|sport|sports|running|nutrition|cosmetics|skincare|eu|europe|hq|team|[a-z]{2}))?";

export function brandMatcher(brand: string, handles: readonly string[]): (caption: string) => boolean {
  const words = new Set<string>();
  for (const h of handles) {
    words.add(h.toLowerCase());
    words.add(h.toLowerCase().replace(/[._]/g, ""));
  }
  const flat = norm(brand).replace(/[^a-z0-9]/g, "");
  if (flat.length >= 3) words.add(flat);
  const word = norm(brand).trim();
  const re = word.length >= 4 ? new RegExp(`(^|[^a-z0-9@#])${esc(word)}($|[^a-z0-9])`) : null;
  // Compte qui commence par le nom de la marque (4 lettres et plus) : « yade.paris ».
  const prefixe = flat.length >= 4 ? new RegExp(`(^|[^a-z0-9._])${esc(flat)}${SUFFIXE}($|[^a-z0-9._]|\\.(?![a-z0-9]))`) : null;
  return (caption) => {
    const c = norm(caption);
    for (const w of words) if (citesHandle(c, w)) return true;
    if (re && re.test(c)) return true;
    return prefixe ? prefixe.test(c) : false;
  };
}
