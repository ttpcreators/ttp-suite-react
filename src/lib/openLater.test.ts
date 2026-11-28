import { beforeEach, describe, expect, it, vi } from "vitest";
import { viewableUrl } from "./openLater";

const SIGN = "https://zizvggziggswhrbuyhuo.supabase.co/storage/v1/object/sign/documents";

describe("viewableUrl", () => {
  beforeEach(() => vi.stubGlobal("window", { location: { origin: "https://app.ttpcreators.pro" } }));

  it("fait passer un contrat .html du stockage par la page de lecture", () => {
    const url = `${SIGN}/contracts/nina-roux-1.html?token=abc.def`;
    expect(viewableUrl(url)).toBe(`https://app.ttpcreators.pro/document/#${encodeURIComponent(url)}`);
  });

  it("laisse les autres fichiers et les liens externes tels quels", () => {
    for (const url of [`${SIGN}/briefs/x.pdf?token=a`, `${SIGN}/creator-uploads/u1/facture.html?token=a`, `${SIGN}/contracts/../creator-uploads/u1/f.html?token=a`, "https://drive.google.com/file/d/x.html", "https://canva.com/design/x"]) {
      expect(viewableUrl(url)).toBe(url);
    }
  });
});
