import { describe, expect, it } from "vitest";
import { cheminAvatar, estPdf, extensionImage, genreFichier, lienContrat, retirerApostrophe, sansFormule } from "./fichierSur";

const SIGN = "https://zizvggziggswhrbuyhuo.supabase.co/storage/v1/object/sign/documents";

describe("lienContrat", () => {
  it("accepte un contrat HTML de l'agence", () => {
    const url = `${SIGN}/contracts/nina-roux-1793000000000.html?token=abc.def`;
    expect(lienContrat(url)).toBe(url);
  });

  it("refuse les autres dossiers, même cachés derrière « .. » ou un encodage", () => {
    for (const url of [
      `${SIGN}/creator-uploads/u1/facture.html?token=a`,
      `${SIGN}/contracts/../creator-uploads/u1/facture.html?token=a`,
      `${SIGN}/contracts/%2e%2e/creator-uploads/u1/facture.html?token=a`,
      `${SIGN}/contracts/..%2fcreator-uploads%2fu1%2ffacture.html?token=a`,
      `${SIGN}/contracts/x/../../../public/avatars/faux.html`,
      `${SIGN}/../../public/avatars/faux.html`,
      `${SIGN}/contracts/sous/dossier.html?token=a`,
      `${SIGN}/contracts/contrat.pdf?token=a`,
      "https://zizvggziggswhrbuyhuo.supabase.co.exemple.test/storage/v1/object/sign/documents/contracts/a.html",
      "https://user@zizvggziggswhrbuyhuo.supabase.co/storage/v1/object/sign/documents/contracts/a.html",
      "http://zizvggziggswhrbuyhuo.supabase.co/storage/v1/object/sign/documents/contracts/a.html",
      "pas une adresse",
    ]) {
      expect(lienContrat(url)).toBeNull();
    }
  });
});

describe("genreFichier", () => {
  it("lit l'extension du chemin, pas le nom affiché", () => {
    expect(genreFichier("creator-uploads/u1/1-facture.svg")).toBe("other");
    expect(genreFichier("creator-uploads/u1/1-facture.pdf")).toBe("pdf");
    expect(genreFichier("x/photo.JPG")).toBe("image");
    expect(genreFichier("contracts/a.html")).toBe("html");
    expect(genreFichier("sans-extension")).toBe("other");
  });
});

describe("estPdf", () => {
  it("reconnaît la signature d'un PDF", () => {
    expect(estPdf(new TextEncoder().encode("%PDF-1.7\n"))).toBe(true);
    expect(estPdf(new TextEncoder().encode("<svg onload=x>"))).toBe(false);
    expect(estPdf(new Uint8Array())).toBe(false);
  });
});

describe("sansFormule", () => {
  it("neutralise une cellule qui commence comme une formule", () => {
    for (const v of ["=HYPERLINK(\"x\")", "+1", "-2", "@cmd", "\tA", "\rB"]) expect(sansFormule(v)).toBe(`'${v}`);
  });
  it("laisse le reste tel quel", () => {
    expect(sansFormule("Marque fictive")).toBe("Marque fictive");
    expect(sansFormule(12)).toBe("12");
    expect(sansFormule(null)).toBe("");
  });
});

describe("retirerApostrophe", () => {
  it("rend la valeur d'origine d'une cellule exportée", () => {
    for (const v of ["+33 6 00 00 00 00", "=1+1", "@marque"]) expect(retirerApostrophe(sansFormule(v))).toBe(v);
    expect(retirerApostrophe("'texte")).toBe("'texte");
  });
});

describe("cheminAvatar", () => {
  it("range le fichier dans le dossier du compte", () => {
    const uid = "0b7a3c52-1111-4222-8333-944455556666";
    expect(cheminAvatar(uid, "mediakit/nina/hero-1.jpg")).toBe(`creators/${uid}/mediakit/nina/hero-1.jpg`);
  });
  it("sans compte connu, garde le chemin", () => {
    expect(cheminAvatar(null, "nina/1.jpg")).toBe("nina/1.jpg");
    expect(cheminAvatar("pas-un-id", "nina/1.jpg")).toBe("nina/1.jpg");
  });
});

describe("extensionImage", () => {
  it("garde une extension de photo, sinon la tire du type", () => {
    expect(extensionImage({ name: "Photo.PNG", type: "image/png" })).toBe("png");
    expect(extensionImage({ name: "photo", type: "image/webp" })).toBe("webp");
    expect(extensionImage({ name: "photo.bmp", type: "image/bmp" })).toBe("jpg");
  });
});
