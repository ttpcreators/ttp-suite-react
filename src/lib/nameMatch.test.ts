import { describe, it, expect } from "vitest";
import { namePattern, sameName } from "./nameMatch";

describe("nom d'un créateur sans majuscules ni accents", () => {
  it("le motif ILIKE couvre toutes les graphies", () => {
    expect(namePattern("Léna Pasquale")).toBe("L___ P_sq__l_");
    expect(namePattern("LENA PASQUALE")).toBe("L___ P_SQ__L_");
    expect(namePattern(" 100%_x ")).toBe("100\\%\\_x");
  });
  it("le filtre exact écarte les faux positifs", () => {
    expect(sameName("LÉNA PASQUALE", "Léna Pasquale")).toBe(true);
    expect(sameName("Lena  Pasquale", "Léna Pasquale")).toBe(true);
    expect(sameName("Lina Pasquale", "Léna Pasquale")).toBe(false);
    expect(sameName("", "")).toBe(false);
  });
});
