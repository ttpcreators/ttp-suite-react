import { describe, expect, it } from "vitest";
import {
  activeByCreator, addToIso, blockedCreators, conflictsFor, daysLeft, excluLine, excluState, findDuration, firstDate,
  fromAppContract, readContract, readExclusivites, type Exclusivite,
} from "./exclusivites.ts";

const today = "2026-10-29";
const ex = (o: Partial<Exclusivite>): Exclusivite => ({
  id: "e1", creator: "lena test", brand: "Nike", scope: "", competitors: [], start: "2026-10-01", end: "2026-12-12",
  points: [], source: "manuel", createdAt: 0, ...o,
});

describe("exclusivités : état et conflits", () => {
  it("état, jours restants, ligne pour Claude", () => {
    expect(excluState(ex({}), today)).toBe("en_cours");
    expect(excluState(ex({ start: "2026-11-05" }), today)).toBe("a_venir");
    expect(excluState(ex({ end: "2026-10-28" }), today)).toBe("terminee");
    expect(excluState(ex({ end: null }), today)).toBe("en_cours");
    expect(daysLeft(ex({}), today)).toBe(44);
    expect(excluLine(ex({ competitors: ["Adidas", "Puma"], scope: "sport" }))).toBe("exclu Nike jusqu'au 2026-12-12 (secteur sport, concurrents Adidas, Puma)");
  });
  it("une marque concurrente citée ou du même secteur bloque le créateur, jamais la marque elle-même", () => {
    const list = [ex({ competitors: ["Adidas", "Puma"], scope: "vêtements de sport" })];
    expect(conflictsFor(list, "LENA TEST", "adidas", today)).toHaveLength(1);
    expect(conflictsFor(list, "Lena Test", "Adidas France", today)).toHaveLength(1);
    expect(conflictsFor(list, "Lena Test", "Nike", today)).toHaveLength(0);
    expect(conflictsFor(list, "Lena Test", "Sephora", today)).toHaveLength(0);
    expect(conflictsFor(list, "Lena Test", "Decathlon", today, ["Sport"])).toHaveLength(1);
    expect(conflictsFor(list, "Autre", "Adidas", today)).toHaveLength(0);
    expect(conflictsFor([ex({ competitors: ["Adidas"], end: "2026-10-01" })], "Lena Test", "Adidas", today)).toHaveLength(0);
    const blocked = blockedCreators(list, "Puma", today);
    expect(blocked.get("lena test")).toBe("Exclu Nike · 2026-12-12");
    expect(activeByCreator(list, today).get("lena test")).toHaveLength(1);
  });
  it("lecture tolérante du blob", () => {
    expect(readExclusivites([ex({}), null, { id: 3 }, { id: "x", creator: "a", brand: "b", competitors: "Adidas" }])).toHaveLength(2);
    expect(readExclusivites("rien")).toEqual([]);
  });
});

describe("dates et durées", () => {
  it("durées écrites en chiffres ou en lettres", () => {
    expect(findDuration("pendant trente (30) jours")).toEqual({ n: 30, unit: "jours" });
    expect(findDuration("for a period of 6 months")).toEqual({ n: 6, unit: "mois" });
    expect(findDuration("pendant deux semaines")).toEqual({ n: 14, unit: "jours" });
    expect(findDuration("pendant 1 an")).toEqual({ n: 12, unit: "mois" });
    expect(findDuration("rien")).toBeNull();
    expect(addToIso("2026-01-31", 1, "mois")).toBe("2026-02-28");
    expect(firstDate("Fait à Lyon le 12 novembre 2026")).toBe("2026-11-12");
    expect(firstDate("signé le 03/11/2026")).toBe("2026-11-03");
  });
});

describe("contrats", () => {
  it("contrat fait dans l'app : exclusivité catégorie 90 jours", () => {
    const d = fromAppContract({ id: "h1", ctName: "lena test", brand: "Nike", ref: "TTP-2026-101", ts: Date.UTC(2026, 9, 1), form: { exclScope: "cat90", deliverables: "2 reels", value: "1 500 €" } });
    expect(d).toMatchObject({ start: "2026-10-01", end: "2026-12-30", scope: "même catégorie de produits", source: "contrat" });
    expect(d?.points).toEqual(["Livrables : 2 reels", "Montant : 1 500 €"]);
    expect(fromAppContract({ id: "h2", ctName: "x", brand: "y", ts: 0, form: { exclScope: "non" } })).toBeNull();
  });
  it("contrat PDF : créateur, marque, clause d'exclusivité et points clés", () => {
    const text = `CONTRAT DE PARTENARIAT. Entre la société NIKE France et Lena Test, créatrice de contenu. Fait à Paris le 1 octobre 2026.
      Article 3 – Livrables. La créatrice réalisera 2 reels Instagram et 3 stories.
      Article 4 – Rémunération. En contrepartie, la marque versera la somme de 2 500 € HT, payable à 30 jours fin de mois.
      Article 6 – Exclusivité. Pendant une durée de trois (3) mois à compter de la publication, la créatrice s'interdit toute collaboration avec une marque concurrente du secteur des vêtements de sport, notamment Adidas, Puma et Under Armour.
      Article 7 – Droits d'utilisation. Les droits d'usage sont cédés pour 6 mois sur les réseaux sociaux de la marque.`;
    const r = readContract(text, { creators: ["lena test", "Margaux Test"], brands: ["Nike", "Sephora"] }, today);
    expect(r.creator).toBe("lena test");
    expect(r.brand).toBe("Nike");
    expect(r.exclusivity).toMatchObject({ start: "2026-10-01", end: "2027-01-01", competitors: ["Adidas", "Puma", "Under Armour"] });
    expect(r.exclusivity?.scope).toContain("vetements de sport");
    expect(r.points.map((p) => p.split(" : ")[0])).toEqual(["Montant", "Livrables", "Droits d'usage", "Paiement"]);
  });
  it("contrat sans exclusivité", () => {
    expect(readContract("Contrat simple. La marque paie 500 € pour 1 post.", { creators: [], brands: [] }, today).exclusivity).toBeNull();
  });
});
