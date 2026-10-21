import { describe, expect, it } from "vitest";
import { photoMapFrom, requestedEmails } from "./peoplePhotos.ts";

describe("photos Google des correspondants", () => {
  it("garde les vraies photos, pas l'avatar par défaut", () => {
    const m = photoMapFrom([
      { emailAddresses: [{ value: "Anna@Nike.com" }], photos: [{ url: "https://lh3.googleusercontent.com/a/x=s100", default: false }] },
      { emailAddresses: [{ value: "bob@gmail.com" }], photos: [{ url: "https://lh3.googleusercontent.com/a/def=s100", default: true }] },
      { emailAddresses: [{ value: "c@d.fr" }, { value: "c2@d.fr" }], photos: [{ url: "https://lh3.googleusercontent.com/c" }] },
    ]);
    expect(m.get("anna@nike.com")).toBe("https://lh3.googleusercontent.com/a/x=s96");
    expect(m.has("bob@gmail.com")).toBe(false);
    expect(m.get("c2@d.fr")).toBe("https://lh3.googleusercontent.com/c");
  });
  it("adresses demandées propres", () => {
    expect(requestedEmails(["A@B.co", "a@b.co", "pas une adresse", 3])).toEqual(["a@b.co"]);
    expect(requestedEmails("x")).toEqual([]);
  });
});
