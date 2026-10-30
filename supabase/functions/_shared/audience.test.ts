import { describe, expect, it } from "vitest";
import { audienceOf, compact, parseCount, perPlatformText } from "./audience.ts";

describe("audience : abonnés tous réseaux", () => {
  it("lit les nombres écrits à la main", () => {
    expect(parseCount("242 363")).toBe(242363);
    expect(parseCount("56,8K")).toBe(56800);
    expect(parseCount("1.2M")).toBe(1200000);
    expect(parseCount("")).toBe(0);
    expect(parseCount(42)).toBe(42);
  });

  it("additionne la dernière mesure de chaque plateforme, Instagram du jour en priorité", () => {
    const hist = [
      { creator: "Zoé Test", platform: "tiktok", followers: "300 000", date: "01/09/2026" },
      { creator: "zoé test", platform: "tiktok", followers: "380 000", date: "01/10/2026" },
      { creator: "Zoé Test", platform: "instagram", followers: "200 000", date: "01/10/2026" },
      { creator: "Autre", platform: "youtube", followers: "9 000", date: "01/10/2026" },
    ];
    const a = audienceOf({ name: "Zoé Test", ig: { followers: 242000 } }, hist);
    expect(a.perPlatform).toEqual({ tiktok: 380000, instagram: 242000 });
    expect(a.total).toBe(622000);
    expect(perPlatformText(a)).toBe("TikTok 380 K · Instagram 242 K");
  });

  it("relevés TikTok / YouTube si aucune mesure, sinon le champ « abonnés » de la fiche", () => {
    expect(audienceOf({ name: "A", tt: { followers: "122638" } }, []).total).toBe(122638);
    expect(audienceOf({ name: "B", followers: "6 100" }, []).total).toBe(6100);
  });

  it("écrit les grands nombres comme l'app", () => {
    expect(compact(634000)).toBe("634 K");
    expect(compact(56800)).toBe("56,8 K");
    expect(compact(0)).toBe("?");
  });
});
