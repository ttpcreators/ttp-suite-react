/**
 * Adresse publique du media kit d'un créateur (ttpcreators.pro/mediakit/<slug>/),
 * calculée EXACTEMENT comme le build du site (websitettpcreators/mediakit/
 * _build_mediakits.py, main) : le champ « Lien » (mediakit.slug) sinon le prénom,
 * passé en minuscules sans accents ; en cas de doublon, -2, -3… dans l'ordre du roster
 * (sort_order). Sans ce calcul, l'app devinait le prénom seul et pouvait ouvrir le kit
 * d'un autre créateur du même prénom.
 */
export type MkRow = { name: string | null; mediakit?: { slug?: string | null } | null };

/** slugify() du build : NFD, ASCII seul, minuscules, tout le reste devient « - ». */
export function siteSlugify(s: string | null | undefined): string {
  const out = (s ?? "")
    .normalize("NFD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out || "createur";
}

/** Nom réel → slug, pour la liste triée par sort_order (comme public_mediakit?order=sort_order). */
export function siteSlugs(rows: MkRow[]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const c of rows) {
    const name = c.name ?? "";
    const first = name.trim().split(/\s+/)[0] ?? "";
    const base = siteSlugify(c.mediakit?.slug || siteSlugify(first));
    let slug = base;
    for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
    used.add(slug);
    out.set(name, slug);
  }
  return out;
}
