import { describe, expect, it } from "vitest";
import { isAvatarImage, safeImgSrc } from "./safeUrl";

describe("safeImgSrc", () => {
  it("garde une adresse d'image normale", () => {
    expect(safeImgSrc("https://x.supabase.co/storage/v1/object/public/avatars/a.jpg")).toBe("https://x.supabase.co/storage/v1/object/public/avatars/a.jpg");
    expect(safeImgSrc("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  });
  it("échappe les guillemets qui sortiraient de l'attribut", () => {
    expect(safeImgSrc('https://a.fr/x.jpg" onerror="alert(1)')).toBe("https://a.fr/x.jpg&quot; onerror=&quot;alert(1)");
  });
  it("refuse les autres schémas", () => {
    expect(safeImgSrc("javascript:alert(1)")).toBe("");
    expect(safeImgSrc("data:text/html;base64,PHNjcmlwdD4=")).toBe("");
    expect(safeImgSrc("data:image/svg+xml;base64,PHN2Zz4=")).toBe("");
    expect(safeImgSrc(null)).toBe("");
  });
});

describe("isAvatarImage", () => {
  it("accepte les photos et refuse le SVG", () => {
    expect(isAvatarImage({ type: "image/jpeg" })).toBe(true);
    expect(isAvatarImage({ type: "image/webp" })).toBe(true);
    expect(isAvatarImage({ type: "image/svg+xml" })).toBe(false);
    expect(isAvatarImage({ type: "text/html" })).toBe(false);
    expect(isAvatarImage({ type: "" })).toBe(false);
  });
});
