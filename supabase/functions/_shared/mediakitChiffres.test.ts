import { describe, expect, it } from "vitest";
import { appliquerChiffres, nombre, pourcentage } from "./mediakitChiffres.ts";

const KIT = {
  bio: "Coach à Lyon",
  brands: [{ name: "Nova" }],
  rates: [{ label: "Reel", price: "800" }],
  platforms: [
    { key: "instagram", followers: "40000", er: "3,10%", ageBracket: "25-34" },
    { key: "tiktok", followers: "12000" },
  ],
};

describe("chiffres du media kit", () => {
  it("lit les nombres et les pourcentages comme les écrit Alfred", () => {
    expect(nombre("12 345")).toBe(12345);
    expect(nombre("12,3k")).toBe(12300);
    expect(nombre("1.2M")).toBe(1200000);
    expect(nombre("beaucoup")).toBeNull();
    expect(pourcentage(4.256)).toBe("4,26%");
    expect(pourcentage("3,5 %")).toBe("3,50%");
    expect(pourcentage("150")).toBeNull();
  });

  it("ne change que les chiffres de la plateforme, le reste du kit reste intact", () => {
    const r = appliquerChiffres(KIT, { plateforme: "Instagram", abonnes: "42 500", engagement: 3.4 });
    if ("error" in r) throw new Error(r.error);
    expect(r.changements).toEqual(["abonnés : 40000 → 42500", "engagement : 3,10% → 3,40%"]);
    expect(r.mediakit.bio).toBe("Coach à Lyon");
    expect(r.mediakit.rates).toEqual(KIT.rates);
    const [ig, tt] = r.mediakit.platforms as Record<string, unknown>[];
    expect(ig).toEqual({ key: "instagram", followers: "42500", er: "3,40%", ageBracket: "25-34" });
    expect(tt).toEqual({ key: "tiktok", followers: "12000" });
    expect(KIT.platforms[0].followers).toBe("40000"); // l'original n'est pas modifié
  });

  it("ajoute la plateforme absente, et ne signale rien quand rien ne change", () => {
    const r = appliquerChiffres(KIT, { plateforme: "youtube", abonnes: 900 });
    if ("error" in r) throw new Error(r.error);
    expect((r.mediakit.platforms as unknown[]).length).toBe(3);
    const pareil = appliquerChiffres(KIT, { plateforme: "tiktok", abonnes: "12000" });
    expect("error" in pareil ? null : pareil.changements).toEqual([]);
  });

  it("refuse une plateforme inconnue ou un chiffre illisible, sans rien écrire", () => {
    expect(appliquerChiffres(KIT, { plateforme: "snapchat", abonnes: 10 })).toHaveProperty("error");
    expect(appliquerChiffres(KIT, { plateforme: "instagram", abonnes: "pas mal" })).toHaveProperty("error");
  });
});
