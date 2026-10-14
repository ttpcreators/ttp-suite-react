import { describe, expect, it } from "vitest";
import { brandKey, groupByBrand, tiktokUser, type TtContent } from "./ttRadar";

const c = (id: string, creator: string, brands: string[], created = "2026-10-10"): TtContent => ({ id, created, label: "Paid partnership", brands, creator, video_url: null, cover: null });

describe("groupByBrand", () => {
  it("regroupe par marque, même écrite différemment", () => {
    const out = groupByBrand([c("1", "lea", ["Sézane"]), c("2", "ines", ["sezane"]), c("3", "lea", ["Nike", "Sézane"])]);
    expect(out[0].key).toBe("sezane");
    expect(out[0].name).toBe("Sézane");
    expect(out[0].creators).toEqual(["lea", "ines"]);
    expect(out[0].contents).toHaveLength(3);
    expect(out[1].name).toBe("Nike");
  });
  it("classe d'abord les marques qui paient le plus de créatrices", () => {
    const out = groupByBrand([c("1", "a", ["Solo"]), c("2", "a", ["Solo"]), c("3", "b", ["Duo"]), c("4", "c", ["Duo"])]);
    expect(out.map((b) => b.name)).toEqual(["Duo", "Solo"]);
  });
  it("filtre par période", () => {
    const out = groupByBrand([c("1", "a", ["Old"], "2026-01-01"), c("2", "b", ["New"], "2026-10-12")], "2026-10-01");
    expect(out.map((b) => b.name)).toEqual(["New"]);
  });
});

describe("outils", () => {
  it("clé de marque", () => {
    expect(brandKey("L'Oréal Paris")).toBe("l oreal paris");
  });
  it("@ TikTok", () => {
    expect(tiktokUser("https://www.tiktok.com/@Lea.Fit?lang=fr")).toBe("lea.fit");
    expect(tiktokUser("@lea_fit")).toBe("lea_fit");
    expect(tiktokUser("pas un @ valide !")).toBe("");
  });
});
