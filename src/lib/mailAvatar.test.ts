import { describe, expect, it } from "vitest";
import { avatarCandidates, emailOf, isWebmail, letterColor, logoUrl } from "./mailAvatar";
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
