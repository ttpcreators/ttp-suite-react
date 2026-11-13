import { describe, expect, it } from "vitest";
import { briefPdfDoc } from "./briefPdf";

const docs = [
  { id: "d-oct", name: "Brief octobre - @lena.psl x Nutripure.pdf", type: "brief", path: "oct.pdf" },
  { id: "d-nov", name: "Brief · Nutripure · Léna Pasquale", type: "brief", path: "briefs/nutripure-nov.pdf" },
  { id: "d-prep", name: "Brief · Prepmymeal · Léna Pasquale", type: "brief", path: "briefs/prepmymeal.pdf" },
  { id: "d-old", name: "Brief Yade.pdf", type: "brief", path: "yade.pdf" },
];

describe("briefPdfDoc", () => {
  it("suit le lien exact du brief, même avec deux briefs de la même marque", () => {
    const oct = { id: "b1", brand: "Nutripure", pdf: { docId: "d-oct", path: "oct.pdf" } };
    const nov = { id: "b2", brand: "Nutripure", pdf: { docId: "d-nov", path: "briefs/nutripure-nov.pdf" } };
    expect(briefPdfDoc(oct, [oct, nov], docs)?.id).toBe("d-oct");
    expect(briefPdfDoc(nov, [oct, nov], docs)?.id).toBe("d-nov");
  });

  it("trouve un PDF dont le nom ne contient pas la marque", () => {
    const b = { id: "b3", brand: "Prepmymeal", pdf: { name: "Briefing_Influencer.pdf", docId: "d-prep", path: "briefs/prepmymeal.pdf" } };
    expect(briefPdfDoc(b, [b], docs)?.id).toBe("d-prep");
  });

  it("retombe sur le chemin, puis sur le fichier seul si la ligne Documents manque", () => {
    const byPath = { id: "b4", brand: "X", pdf: { docId: "inconnu", path: "briefs/prepmymeal.pdf" } };
    expect(briefPdfDoc(byPath, [byPath], docs)?.id).toBe("d-prep");
    const fileOnly = { id: "b5", brand: "X", pdf: { name: "Brief X.pdf", path: "briefs/x.pdf" } };
    expect(briefPdfDoc(fileOnly, [fileOnly], docs)).toEqual({ id: "briefs/x.pdf", name: "Brief X.pdf", type: "brief", path: "briefs/x.pdf" });
  });

  it("sans PDF joint : nom de marque seulement si c'est le seul brief de cette marque", () => {
    const yade = { id: "b6", brand: "Yade", pdf: null };
    expect(briefPdfDoc(yade, [yade], docs)?.id).toBe("d-old");
    const a = { id: "b7", brand: "Nutripure", pdf: null };
    const b = { id: "b8", brand: "Nutripure", pdf: null };
    expect(briefPdfDoc(a, [a, b], docs)).toBeNull();
    expect(briefPdfDoc({ id: "b9", brand: "Inconnue" }, [], docs)).toBeNull();
  });
});
