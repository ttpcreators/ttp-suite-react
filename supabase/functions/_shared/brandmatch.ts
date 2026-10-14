// ============================================================================
// _shared/brandmatch.ts : une publication cite-t-elle la marque d'une collab ?
// Partagé par tt-sync (vidéos TikTok) et yt-sync (vidéos YouTube).
// ============================================================================

/** Minuscules sans accents. */
export const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Le texte cite-t-il la marque ? (@ ou # du compte de la marque, ou son nom). */
export function brandMatcher(brand: string, handles: string[]): (text: string) => boolean {
  const words = new Set<string>();
  for (const h of handles) {
    words.add(h.toLowerCase());
    words.add(h.toLowerCase().replace(/[._]/g, ""));
  }
  const flat = norm(brand).replace(/[^a-z0-9]/g, "");
  if (flat.length >= 3) words.add(flat);
  const spaced = norm(brand).trim();
  return (text: string) => {
    const t = ` ${norm(text)} `;
    for (const w of words) {
      const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(^|[^a-z0-9._])[@#]?${esc}([^a-z0-9_]|$)`).test(t)) return true;
    }
    return spaced.length >= 4 && spaced.includes(" ") && t.includes(spaced);
  };
}
