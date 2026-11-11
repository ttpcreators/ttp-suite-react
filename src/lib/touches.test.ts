import { describe, it, expect } from "vitest";
import { waLink, igHandle, typeHandle, type Touch } from "./touches";
import { applyTouchChange } from "./touchesDb";

describe("waLink", () => {
  it("numéro FR avec 0 initial", () => {
    expect(waLink("06 12 34 56 78")).toBe("https://wa.me/33612345678");
  });
  it("+33 (0)6 : le (0) est retiré", () => {
    expect(waLink("+33 (0)6 12 34 56 78")).toBe("https://wa.me/33612345678");
    expect(waLink("+33(0)612345678")).toBe("https://wa.me/33612345678");
  });
  it("9 chiffres sans 0 initial → indicatif 33", () => {
    expect(waLink("6 12 34 56 78")).toBe("https://wa.me/33612345678");
  });
  it("international (+ ou 00) conservé", () => {
    expect(waLink("+44 7911 123456")).toBe("https://wa.me/447911123456");
    expect(waLink("0033 6 12 34 56 78")).toBe("https://wa.me/33612345678");
  });
  it("illisible → null", () => {
    expect(waLink("")).toBeNull();
    expect(waLink("123")).toBeNull();
  });
});

describe("igHandle", () => {
  it("pseudo ou URL complète", () => {
    expect(igHandle("@marque")).toBe("marque");
    expect(igHandle("https://www.instagram.com/marque/?hl=fr")).toBe("marque");
    expect(igHandle("instagram.com/marque")).toBe("marque");
  });
});

describe("applyTouchChange", () => {
  const a = { id: "a", date: "2026-01-01", canal: "email" as const, kind: "contact" as const };
  const b = { id: "gm1", date: "2026-02-01", canal: "email" as const, kind: "relance" as const };
  it("ajout en tête, conserve les touches concurrentes", () => {
    expect(applyTouchChange([b], { add: a }).map((t) => t.id)).toEqual(["a", "gm1"]);
  });
  it("suppression par id", () => {
    expect(applyTouchChange([a, b], { remove: "a" }).map((t) => t.id)).toEqual(["gm1"]);
  });
});

describe("typeHandle (champ @)", () => {
  it("colle le pseudo au @ et nettoie les liens", () => {
    expect(typeHandle("@ lamarque")).toBe("@lamarque");
    expect(typeHandle("@  la marque ")).toBe("@lamarque");
    expect(typeHandle("@@lamarque")).toBe("@lamarque");
    expect(typeHandle("@")).toBe("@");
    expect(typeHandle("lamarque")).toBe("lamarque");
    expect(typeHandle("@https://www.instagram.com/la.marque/?hl=fr")).toBe("@la.marque");
    expect(typeHandle("https://www.tiktok.com/@lamarque")).toBe("@lamarque");
  });
});

describe("touche supprimée (audit 2026-11-11)", () => {
  const t = (id: string, date: string): Touch => ({ id, date, canal: "whatsapp", kind: "contact" });
  it("« dernier contact » redescend quand il venait de la touche retirée", async () => {
    const { buildTouchesPatch } = await import("./touches");
    const a = t("a", "2026-11-11T09:00:00.000Z");
    const b = t("b", "2026-10-01T09:00:00.000Z");
    expect(buildTouchesPatch([], a.date, [a]).last_contacted).toBeNull();
    expect(buildTouchesPatch([b], a.date, [a, b]).last_contacted).toBe(b.date);
  });
  it("une date venue d'ailleurs (mail plus récent) ne bouge pas", async () => {
    const { buildTouchesPatch } = await import("./touches");
    const a = t("a", "2026-11-01T09:00:00.000Z");
    expect("last_contacted" in buildTouchesPatch([], "2026-11-10T08:00:00.000Z", [a])).toBe(false);
  });
});
