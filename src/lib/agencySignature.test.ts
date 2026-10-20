import { describe, expect, it } from "vitest";
import { scribble, setCurrentSignature, sigImgHtml, validSig } from "./agencySignature";

describe("signature de l'agence", () => {
  it("le gribouillis est valide, et identique pour une même graine", () => {
    const a = scribble(42);
    expect(validSig(a)).not.toBeNull();
    expect(scribble(42)).toEqual(a);
    expect(scribble(43)).not.toEqual(a);
  });

  it("refuse tout ce qui n'est pas un tracé (pas d'injection dans le PDF)", () => {
    expect(validSig({ paths: ['M0 0"/><script>alert(1)</script>'], w: 100, h: 50 })).toBeNull();
    expect(validSig({ paths: [], w: 100, h: 50 })).toBeNull();
    expect(validSig({ paths: ["M0 0 L10 10"], w: 0, h: 50 })).toBeNull();
    expect(validSig(null)).toBeNull();
  });

  it("image posée seulement si une signature active existe", () => {
    setCurrentSignature(null);
    expect(sigImgHtml()).toBe("");
    setCurrentSignature({ ...scribble(1), on: false });
    expect(sigImgHtml()).toBe("");
    setCurrentSignature(scribble(1));
    expect(sigImgHtml()).toContain('<img class="sig"');
    setCurrentSignature(null);
  });
});
