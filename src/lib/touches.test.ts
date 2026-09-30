import { describe, it, expect } from "vitest";
import { waLink, igHandle } from "./touches";
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
