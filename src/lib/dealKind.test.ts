import { describe, expect, it } from "vitest";
import { briefDealKind, dealKind } from "./dealKind";

describe("dealKind", () => {
  it("rémunéré dès qu'il y a un montant", () => {
    expect(dealKind("4000 €")).toBe("paid");
    expect(dealKind("1 500€ HT")).toBe("paid");
    expect(dealKind("300 € + produits offerts")).toBe("paid");
    expect(dealKind("$800")).toBe("paid");
  });
  it("gifting", () => {
    expect(dealKind("Gifting")).toBe("gifting");
    expect(dealKind("Produits offerts")).toBe("gifting");
    expect(dealKind("0 €")).toBe("gifting");
    expect(dealKind("en échange de produits")).toBe("gifting");
  });
  it("inconnu : rien d'affiché", () => {
    expect(dealKind("")).toBeNull();
    expect(dealKind("—")).toBeNull();
    expect(dealKind(null)).toBeNull();
    expect(dealKind("à définir")).toBeNull();
  });
  it("brief : budget, sinon cachet de la collab", () => {
    expect(briefDealKind("—", "2000 €")).toBe("paid");
    expect(briefDealKind("Gifting", "2000 €")).toBe("gifting");
    expect(briefDealKind("—", null)).toBeNull();
  });
});
