import { describe, expect, it } from "vitest";
import { cleDuCreateur, dateVersement, versementEnDouble } from "./versement.ts";

describe("versement", () => {
  it("range le versement sous la graphie déjà utilisée, sinon celle du roster", () => {
    expect(cleDuCreateur("léna pasquale", { "LÉNA PASQUALE": [{ amount: 280 }] }, ["Léna Pasquale"])).toBe("LÉNA PASQUALE");
    expect(cleDuCreateur("Léna Pasquale", {}, ["Léna Pasquale"])).toBe("Léna Pasquale");
    expect(cleDuCreateur("Inconnu", {}, ["Léna Pasquale"])).toBeNull();
  });

  it("repère un versement déjà noté (même montant, 5 jours près)", () => {
    const liste = [{ id: "a", date: "2026-11-11", amount: 280 }];
    expect(versementEnDouble(liste, 280, "2026-11-14")?.id).toBe("a");
    expect(versementEnDouble(liste, 280, "2026-11-20")).toBeNull();
    expect(versementEnDouble(liste, 400, "2026-11-11")).toBeNull();
  });

  it("date du jour par défaut, jamais dans le futur", () => {
    expect(dateVersement("", "2026-11-17")).toBe("2026-11-17");
    expect(dateVersement("2026-11-16", "2026-11-17")).toBe("2026-11-16");
    expect(dateVersement("2026-11-30", "2026-11-17")).toBeNull();
    expect(dateVersement("16/11", "2026-11-17")).toBeNull();
  });
});
