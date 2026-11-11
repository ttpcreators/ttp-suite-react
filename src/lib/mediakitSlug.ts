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

/** Adresse publique d'UN créateur telle que le site la publiera, avec le « Lien » en cours
 *  de saisie à la place de celui enregistré. undefined s'il n'est pas dans la liste publiée.
 *  Sert aussi à l'enregistrement : le « Lien » rangé est celui que le site donne vraiment
 *  (un créateur sans lien occupe déjà son prénom ; sans ça deux « Lena » partageaient la
 *  même adresse dans l'éditeur, et l'agence envoyait à la marque le media kit de l'autre). */
export function siteSlugFor(rows: MkRow[], name: string, editedSlug: string | null | undefined): string | undefined {
  if (!rows.some((r) => r.name === name)) return undefined;
  return siteSlugs(rows.map((r) => (r.name === name ? { ...r, mediakit: { ...(r.mediakit ?? {}), slug: (editedSlug ?? "").trim() || null } } : r))).get(name);
}
