import { describe, expect, it } from "vitest";
import { chiffresAnciens, derniersChiffres, kitEtat } from "./mediakitRoster";

describe("kitEtat", () => {
  it("vide quand rien n'est saisi", () => {
    expect(kitEtat(null)).toBe("vide");
    expect(kitEtat({})).toBe("vide");
    expect(kitEtat({ bio: "  ", platforms: [], photos: { hero: null } })).toBe("vide");
  });
  it("rempli avec une bio et des abonnés", () => {
    expect(kitEtat({ bio: "Créatrice lifestyle à Lyon.", platforms: [{ key: "instagram", followers: "12,5 K" }] })).toBe("rempli");
  });
  it("à compléter quand il manque la bio ou les abonnés", () => {
    expect(kitEtat({ bio: "Créatrice lifestyle à Lyon." })).toBe("incomplet");
    expect(kitEtat({ platforms: [{ key: "tiktok", followers: "40K" }] })).toBe("incomplet");
    expect(kitEtat({ photos: { hero: "https://exemple.test/photo.jpg" } })).toBe("incomplet");
  });
});

describe("derniersChiffres", () => {
  it("prend le chiffre réel le plus récent, relevé ou mesure", () => {
    const c = { name: "Lina Test", ig: { followers: 1200, ok: "2026-10-02T08:00:00Z" } };
    const mesures = [
      { creator: "lina test", platform: "tiktok", followers: "3 400", date: "15/10/2026" },
      { creator: "Autre", platform: "tiktok", followers: "9 999", date: "20/11/2026" },
    ];
    expect(derniersChiffres(c, mesures)).toBe("2026-10-15");
  });
  it("null sans aucun chiffre réel", () => {
    expect(derniersChiffres({ name: "Lina Test" }, [])).toBeNull();
  });
});

describe("chiffresAnciens", () => {
  const now = new Date("2026-11-24T12:00:00Z");
  it("signale les chiffres de plus de deux mois", () => {
    expect(chiffresAnciens("2026-09-01", now)).toBe(true);
    expect(chiffresAnciens("2026-11-01", now)).toBe(false);
    expect(chiffresAnciens(null, now)).toBe(false);
  });
});
