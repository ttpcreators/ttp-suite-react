import { describe, expect, it } from "vitest";
import { contratsSignes, ficheCompletude, mediakitRempli } from "./ficheComplete";

const full = {
  name: "LÉNA TEST", email: "lena@example.com", phone: "06 00 00 00 00", photo_url: "https://x/y.jpg",
  platform: "Instagram", commission: "20", mediakit: { bio: "Sport et voyages" },
};
const repr = (creator: string, status?: string) => ({ id: creator, path: "documents/x.pdf", config: {}, creator, ...(status ? { status } : {}) });

describe("contratsSignes", () => {
  it("garde les contrats de représentation signés seulement", () => {
    const s = contratsSignes([], [repr("LÉNA TEST", "signed"), repr("Paul Essai")]);
    expect(s.has("lena test")).toBe(true);
    expect(s.has("paul essai")).toBe(false);
  });
});

describe("ficheCompletude", () => {
  it("fiche complète : 100 %, rien ne manque", () => {
    const r = ficheCompletude(full, new Set(["lena test"]));
    expect(r).toEqual({ pct: 100, manque: [], total: 7 });
  });
  it("liste ce qui manque, dans l'ordre", () => {
    const r = ficheCompletude({ name: "Paul Essai", email_pro: "paul@example.com", commission: "abc", platform: "—" }, new Set());
    expect(r.manque.map((m) => m.key)).toEqual(["phone", "photo", "platform", "commission", "contrat", "mediakit"]);
    expect(r.pct).toBe(14);
  });
  it("contrats pas encore lus : critère laissé de côté", () => {
    const r = ficheCompletude(full, null);
    expect(r.total).toBe(6);
    expect(r.pct).toBe(100);
  });
  it("commission « 20 % » et media kit avec un réseau comptent", () => {
    expect(ficheCompletude({ ...full, commission: "20 %", mediakit: { platforms: [{ key: "instagram" }] } }, null).pct).toBe(100);
    expect(mediakitRempli({ slug: "x" })).toBe(false);
    expect(mediakitRempli(null)).toBe(false);
  });
});
