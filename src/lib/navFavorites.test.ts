import { describe, expect, it } from "vitest";
import { FAVORIS_BASE, FAVORIS_ID, withFavorites } from "./nav";

type G = { id: string; items: { id: string }[] };
const make = (items: { id: string }[]): G => ({ id: FAVORIS_ID, items });

describe("withFavorites", () => {
  const groups: G[] = [{ id: FAVORIS_ID, items: [{ id: "apercu" }, { id: "mails" }] }, { id: "finance", items: [{ id: "facturation" }] }];
  it("ajoute les pages en favoris au bout de la section Favoris", () => {
    expect(withFavorites(groups, [{ id: "facturation" }], make)[0].items.map((i) => i.id)).toEqual(["apercu", "mails", "facturation"]);
  });
  it("ne crée jamais de doublon", () => {
    const out = withFavorites(groups, [{ id: "mails" }, { id: "stats" }, { id: "stats" }], make);
    expect(out[0].items.map((i) => i.id)).toEqual(["apercu", "mails", "stats"]);
  });
  it("crée la section en tête si elle est absente", () => {
    const out = withFavorites([groups[1]], [{ id: "stats" }], make);
    expect(out.map((g) => g.id)).toEqual([FAVORIS_ID, "finance"]);
  });
  it("garde les pages fixes de Favoris", () => {
    expect(FAVORIS_BASE.has("aujourdhui")).toBe(true);
    expect(FAVORIS_BASE.has("apercu")).toBe(false);
    expect(FAVORIS_BASE.has("facturation")).toBe(false);
  });
});
