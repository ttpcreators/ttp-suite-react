import { describe, expect, it } from "vitest";
import { avatarCandidates, brandDomainFrom, buildBrandDomains, brandKey, emailOf, hostOf, isGenericBrand, isWebmail, letterColor, logoUrl, parentDomain } from "./mailAvatar";
import { brandAddressOf, type GMessageLite } from "../../supabase/functions/creator-mail/logic.ts";

describe("photos de profil des mails", () => {
  it("extrait l'adresse d'un en-tête", () => {
    expect(emailOf('"Clara" <Clara@FourSeasons.com>')).toBe("clara@fourseasons.com");
    expect(emailOf("pas d'adresse")).toBe("");
  });

  it("agence : logo TTP, sauf l'alias d'une créatrice qui garde sa photo", () => {
    expect(avatarCandidates("talent@ttpcreators.pro").map((c) => c.url)).toEqual(["/logo.png"]);
    expect(avatarCandidates("", { agency: true }).map((c) => c.url)).toEqual(["/logo.png"]);
    const chloe = avatarCandidates("chloe@ttpcreators.pro", { creatorPhoto: "https://x/chloe.jpg" });
    expect(chloe[0]).toMatchObject({ url: "https://x/chloe.jpg", kind: "photo", probe: false });
  });

  it("marque : photo Gravatar puis logo du site", () => {
    const c = avatarCandidates("julie@gymshark.com", { hash: "abc" });
    expect(c.map((x) => x.kind)).toEqual(["photo", "logo"]);
    expect(c[0].url).toContain("gravatar.com/avatar/abc");
    expect(c[1].url).toBe(logoUrl("gymshark.com"));
  });

  it("messagerie grand public : jamais le logo de Gmail ou Hotmail", () => {
    expect(isWebmail("gmail.com")).toBe(true);
    expect(avatarCandidates("lea@gmail.com", { hash: "abc" }).map((x) => x.kind)).toEqual(["photo"]);
  });

  it("la couleur de la lettre est stable pour une même adresse", () => {
    expect(letterColor("julie@nike.com")).toBe(letterColor("JULIE@nike.com"));
    expect(letterColor("a")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("adresse de la marque d'un fil (pour son logo)", () => {
    const m = (h: Record<string, string>): GMessageLite => ({ labelIds: ["INBOX"], headers: Object.entries(h).map(([name, value]) => ({ name, value })) });
    expect(brandAddressOf([m({ From: "TTP <talent@ttpcreators.pro>", To: "Julie <julie@nike.com>" })], "ttpcreators.pro")).toBe("julie@nike.com");
    expect(brandAddressOf([m({ From: "Julie <julie@nike.com>" })], "ttpcreators.pro")).toBe("julie@nike.com");
    expect(brandAddressOf([m({ From: "talent@ttpcreators.pro", To: "lea@ttpcreators.pro" })], "ttpcreators.pro")).toBe("");
  });
});

describe("boîtes communes de l'agence", () => {
  it("talent@ et partnerships@ ne sont jamais l'adresse d'une créatrice", async () => {
    const { SHARED_BOXES } = await import("./mailAvatar");
    expect(SHARED_BOXES.test("talent@ttpcreators.pro")).toBe(true);
    expect(SHARED_BOXES.test("Partnerships@ttpcreators.pro")).toBe(true);
    expect(SHARED_BOXES.test("chloedifranscesco@ttpcreators.pro")).toBe(false);
  });
});

describe("plus de logos de marques", () => {
  it("domaine principal d'un sous-domaine", () => {
    expect(parentDomain("fr.loreal.com")).toBe("loreal.com");
    expect(parentDomain("mail.marque.co.uk")).toBe("marque.co.uk");
    expect(parentDomain("marque.co.uk")).toBe("");
    expect(parentDomain("sephora.fr")).toBe("");
    const c = avatarCandidates("julie@fr.loreal.com").map((x) => x.url);
    expect(c).toEqual([logoUrl("fr.loreal.com"), logoUrl("loreal.com")]);
  });

  it("une marque en gmail prend le site d'un autre contact de la même marque", () => {
    const rows = [
      { brand: "Sephora", email: "netty@gmail.com" },
      { brand: "SEPHORA ", email: "Julie <julie@sephora.fr>" },
      { brand: "Sephora", email: "paul@sephora.fr" },
      { brand: "Sephora", email: "x@agence-rp.com" },
      { brand: "Freelance", email: "a@freelance-studio.com" },
    ];
    const m = buildBrandDomains(rows);
    expect(m.get(brandKey("Séphora"))).toBe("sephora.fr");
    expect(m.has(brandKey("Freelance"))).toBe(false);
    expect(brandDomainFrom(rows, "sephora")).toBe("sephora.fr");
    const c = avatarCandidates("netty@gmail.com", { brandDomain: "sephora.fr" });
    expect(c.map((x) => x.url)).toEqual([logoUrl("sephora.fr")]);
    // Jamais deux fois le même logo.
    expect(avatarCandidates("julie@sephora.fr", { brandDomain: "sephora.fr" })).toHaveLength(1);
  });

  it("noms génériques : aucun logo cherché", () => {
    expect(isGenericBrand("Freelance")).toBe(true);
    expect(isGenericBrand("—")).toBe(true);
    expect(isGenericBrand("Agence RP")).toBe(true);
    expect(isGenericBrand("Aroma-Zone")).toBe(false);
  });

  it("site officiel → domaine", () => {
    expect(hostOf("https://www.sephora.fr/")).toBe("sephora.fr");
    expect(hostOf("pas un site")).toBe("");
  });
});
