import { describe, it, expect } from "vitest";
import { namePattern, sameName } from "./nameMatch";

describe("nom d'un créateur sans majuscules ni accents", () => {
  it("le motif ILIKE couvre toutes les graphies", () => {
    expect(namePattern("Léna Morel")).toBe("L___ M_r_l");
    expect(namePattern("LENA MOREL")).toBe("L___ M_R_L");
    expect(namePattern(" 100%_x ")).toBe("100\\%\\_x");
  });
  it("le filtre exact écarte les faux positifs", () => {
    expect(sameName("LÉNA MOREL", "Léna Morel")).toBe(true);
    expect(sameName("Lena  Morel", "Léna Morel")).toBe(true);
    expect(sameName("Lina Morel", "Léna Morel")).toBe(false);
    expect(sameName("", "")).toBe(false);
  });
});
