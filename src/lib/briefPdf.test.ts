import { describe, expect, it } from "vitest";
import { briefPdfDoc } from "./briefPdf";

const docs = [
  { id: "d-oct", name: "Brief octobre - @lena.morel x Solvi.pdf", type: "brief", path: "oct.pdf" },
  { id: "d-nov", name: "Brief · Solvi · Léna Morel", type: "brief", path: "briefs/solvi-nov.pdf" },
  { id: "d-prep", name: "Brief · Kora · Léna Morel", type: "brief", path: "briefs/kora.pdf" },
  { id: "d-old", name: "Brief Nova.pdf", type: "brief", path: "nova.pdf" },
];

describe("briefPdfDoc", () => {
  it("suit le lien exact du brief, même avec deux briefs de la même marque", () => {
    const oct = { id: "b1", brand: "Solvi", pdf: { docId: "d-oct", path: "oct.pdf" } };
    const nov = { id: "b2", brand: "Solvi", pdf: { docId: "d-nov", path: "briefs/solvi-nov.pdf" } };
    expect(briefPdfDoc(oct, [oct, nov], docs)?.id).toBe("d-oct");
    expect(briefPdfDoc(nov, [oct, nov], docs)?.id).toBe("d-nov");
  });

  it("trouve un PDF dont le nom ne contient pas la marque", () => {
    const b = { id: "b3", brand: "Kora", pdf: { name: "Briefing_Influencer.pdf", docId: "d-prep", path: "briefs/kora.pdf" } };
    expect(briefPdfDoc(b, [b], docs)?.id).toBe("d-prep");
  });

  it("retombe sur le chemin, puis sur le fichier seul si la ligne Documents manque", () => {
    const byPath = { id: "b4", brand: "X", pdf: { docId: "inconnu", path: "briefs/kora.pdf" } };
    expect(briefPdfDoc(byPath, [byPath], docs)?.id).toBe("d-prep");
    const fileOnly = { id: "b5", brand: "X", pdf: { name: "Brief X.pdf", path: "briefs/x.pdf" } };
    expect(briefPdfDoc(fileOnly, [fileOnly], docs)).toEqual({ id: "briefs/x.pdf", name: "Brief X.pdf", type: "brief", path: "briefs/x.pdf" });
  });

  it("sans PDF joint : nom de marque seulement si c'est le seul brief de cette marque", () => {
    const nova = { id: "b6", brand: "Nova", pdf: null };
    expect(briefPdfDoc(nova, [nova], docs)?.id).toBe("d-old");
    const a = { id: "b7", brand: "Solvi", pdf: null };
    const b = { id: "b8", brand: "Solvi", pdf: null };
    expect(briefPdfDoc(a, [a, b], docs)).toBeNull();
    expect(briefPdfDoc({ id: "b9", brand: "Inconnue" }, [], docs)).toBeNull();
  });
});
