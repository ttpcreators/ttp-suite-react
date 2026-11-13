/**
 * Le PDF complet d'un brief, côté créatrice.
 *
 * Quand l'agence joint un PDF à un brief, il est aussi rangé dans Documents (type
 * « brief ») et le brief garde le lien exact (`pdf.docId` + `pdf.path`). On suit ce lien,
 * jamais le nom du fichier : deux briefs de la même marque (octobre, novembre) ouvraient
 * sinon le même PDF, et un fichier nommé « Briefing_Influencer.pdf » n'était pas trouvé.
 *
 * Brief sans PDF joint (ancien brief, PDF déposé à la main dans Documents) : on retombe sur
 * le nom de la marque, mais seulement si la créatrice n'a qu'UN brief de cette marque,
 * pour ne jamais ouvrir le brief d'un autre mois.
 */
export type BriefPdfLink = { name?: string; path?: string; docId?: string } | null | undefined;
export type BriefForPdf = { id: string; brand: string | null; pdf?: BriefPdfLink };
export type DocForPdf = { id: string; name: string; type: string | null; path: string | null };

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export function briefPdfDoc<D extends DocForPdf>(brief: BriefForPdf, allBriefs: BriefForPdf[], docs: D[]): D | { id: string; name: string; type: "brief"; path: string } | null {
  const link = brief.pdf;
  if (link && (link.docId || link.path)) {
    const byId = link.docId ? docs.find((d) => d.id === link.docId && d.path) : undefined;
    if (byId) return byId;
    const byPath = link.path ? docs.find((d) => d.path === link.path) : undefined;
    if (byPath) return byPath;
    // Lien présent mais la ligne Documents n'est pas (encore) chargée : le fichier, lui, existe.
    return link.path ? { id: link.docId ?? link.path, name: link.name ?? "Brief", type: "brief", path: link.path } : null;
  }
  const brand = norm(brief.brand);
  if (!brand) return null;
  const sameBrand = allBriefs.filter((b) => norm(b.brand) === brand);
  if (sameBrand.length !== 1) return null;
  const matches = docs.filter((d) => d.type === "brief" && d.path && norm(d.name).includes(brand));
  return matches.length === 1 ? matches[0] : null;
}
