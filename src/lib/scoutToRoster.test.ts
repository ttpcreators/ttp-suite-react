import { describe, expect, it } from "vitest";
import { handleKey, inRoster, platformOf, rosterRow } from "./scoutToRoster";

describe("scouting → roster", () => {
  it("compare les @ et les noms", () => {
    expect(handleKey("https://www.instagram.com/Lena.Mrchd/?hl=fr")).toBe("lena.mrchd");
    expect(handleKey("@lena.mrchd")).toBe("lena.mrchd");
    const roster = [{ name: "Léna Marchand", handle: "@lena.mrchd" }];
    expect(inRoster(roster, { name: "Autre", handle: "instagram.com/lena.mrchd" })).toBe(true);
    expect(inRoster(roster, { name: "LENA MARCHAND", handle: null })).toBe(true);
    expect(inRoster(roster, { name: "Camille", handle: "@camille" })).toBe(false);
  });
  it("plateforme du @", () => {
    expect(platformOf("https://youtube.com/@chaine")).toBe("YouTube");
    expect(platformOf("@lena")).toBe("Instagram");
  });
  it("reprend les stats connues du scouting", () => {
    const row = rosterRow({ name: " Léna Marchand ", handle: "instagram.com/lena.mrchd", email: "", tag: "" }, { followers: 22600, er: 3.456, niche: "Mode" }, 9);
    expect(row).toMatchObject({ name: "Léna Marchand", handle: "@lena.mrchd", email: null, niche: "Mode", platform: "Instagram", er: "3,46", status: "actif", sort_order: 9 });
    expect(String(row.followers)).toMatch(/^22,6\s?K$/);
    expect(rosterRow({ name: "X", handle: null, email: null, tag: "Sport" }, { followers: null, er: null, niche: null }, 1)).toMatchObject({ handle: null, niche: "Sport", followers: null, er: null });
  });
});
