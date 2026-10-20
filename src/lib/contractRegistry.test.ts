import { describe, it, expect } from "vitest";
import { buildCategories, buildRows, countByStatus, filterRows, findBrandContact, normStatus, relanceDraft, rowName, sortRows } from "./contractRegistry";

const brandHist = [
  { id: "b1", ts: Date.UTC(2026, 9, 10), ctType: "marque", ctName: "CANDICE", brand: "Saucony", ref: "TTP-2026-118", title: "Contrat de partenariat commercial", html: "<p>1</p>", status: "signed" },
  { id: "b2", ts: Date.UTC(2026, 9, 13), ctType: "ugc", ctName: "johanna", brand: "Speedo", ref: "TTP-2026-121", title: "Cession de droits UGC", html: "<p>2</p>" },
  { id: "b3", ts: Date.UTC(2026, 9, 14), ctType: "marque", ctName: "[Créateur]", brand: "Nutripure", ref: "TTP-2026-122", title: "x", html: "<p>3</p>", status: "changes" },
  { id: "bad", ts: 1, ctType: "marque" }, // sans HTML : ignorée
];
const reprHist = [
  { id: "r1", creator: "Léa", title: "Contrat de représentation : Léa", variante: "exclusif", config: { talentNom: "Léa Martin" }, createdAt: "2026-09-22T10:00:00.000Z", path: "contracts/lea.html" },
  { id: "r2", creator: null, title: "Contrat", variante: "nonexclusif", config: { talentNom: "Margaux Petit" }, createdAt: "2026-09-01T10:00:00.000Z", path: "contracts/m.html", status: "Signé" },
  { id: "brandlike", ctType: "marque", html: "<p/>" }, // autre format dans contractHistory : ignorée
];

describe("registre des contrats", () => {
  const rows = buildRows(brandHist, reprHist);

  it("lit les deux historiques et ignore les entrées mal formées", () => {
    expect(rows.map((r) => r.id).sort()).toEqual(["b1", "b2", "b3", "r1", "r2"]);
    const r2 = rows.find((r) => r.id === "r2")!;
    expect(r2).toMatchObject({ key: "contractHistory", type: "repr", creator: null, creatorLabel: "Margaux Petit", status: "signed", ref: "Formule non exclusive" });
  });

  it("statut absent = en attente ; libellés français tolérés", () => {
    expect(rows.find((r) => r.id === "b2")!.status).toBe("pending");
    expect(normStatus(undefined)).toBe("pending");
    expect(normStatus("Modifs demandées")).toBe("changes");
    expect(normStatus("signed")).toBe("signed");
  });

  it("nomme la ligne « Marque × Créateur » (représentation : agence × créateur)", () => {
    expect(rowName(rows.find((r) => r.id === "b1")!)).toBe("Saucony × Candice");
    expect(rowName(rows.find((r) => r.id === "r1")!)).toBe("TTP Creators × Léa");
    expect(rows.find((r) => r.id === "b3")!.creator).toBeNull();
  });

  it("onglets, recherche (marque, créateur, référence) et filtres", () => {
    const base = { tab: "all" as const, q: "", creator: "", type: "" as const };
    expect(filterRows(rows, { ...base, tab: "pending" }).map((r) => r.id).sort()).toEqual(["b2", "r1"]);
    expect(filterRows(rows, { ...base, q: "speedo" }).map((r) => r.id)).toEqual(["b2"]);
    expect(filterRows(rows, { ...base, q: "candice" }).map((r) => r.id)).toEqual(["b1"]);
    expect(filterRows(rows, { ...base, q: "2026-122" }).map((r) => r.id)).toEqual(["b3"]);
    expect(filterRows(rows, { ...base, q: "lea" }).map((r) => r.id)).toEqual(["r1"]); // sans accent
    expect(filterRows(rows, { ...base, type: "repr" }).length).toBe(2);
    expect(filterRows(rows, { ...base, creator: "Candice" }).map((r) => r.id)).toEqual(["b1"]);
  });

  it("tri : plus récents d'abord, ou par nom", () => {
    expect(sortRows(rows, "recent").map((r) => r.id)).toEqual(["b3", "b2", "b1", "r1", "r2"]);
    expect(sortRows(rows, "name")[0].id).toBe("b3"); // « Nutripure × … » avant « Saucony », « Speedo », « TTP »
  });

  it("compte par statut et regroupe par type", () => {
    expect(countByStatus(rows)).toEqual({ signed: 2, pending: 2, changes: 1 });
    const cats = buildCategories(rows);
    expect(cats.map((c) => [c.type, c.count])).toEqual([["marque", 2], ["repr", 2], ["ugc", 1]]);
    expect(cats[0].brands).toEqual(["Nutripure", "Saucony"]);
    expect(cats[1].brands).toEqual([]);
    expect(cats[1].creators).toEqual(["Léa", "Margaux Petit"]);
  });

  it("trouve le contact e-mail de la marque (contact agence d'abord)", () => {
    const contacts = [
      { brand: "speedo ", email: "c@crea.fr", creator: "johanna" },
      { brand: "Speedo", email: "", creator: null },
      { brand: "Speedo", email: "pr@speedo.com", creator: null, first_name: "Paul" },
    ];
    expect(findBrandContact(contacts, "SPEEDO")?.email).toBe("pr@speedo.com");
    expect(findBrandContact(contacts, "Saucony")).toBeNull();
    expect(findBrandContact(contacts, "")).toBeNull();
  });

  it("prépare la relance (vouvoiement marque, tutoiement créateur)", () => {
    const b = relanceDraft(rows.find((r) => r.id === "b2")!, "Paul");
    expect(b.subject).toBe("Contrat Speedo × Johanna : signature en attente");
    expect(b.body).toMatch(/^Bonjour Paul,/);
    expect(b.body).toContain("réf. TTP-2026-121");
    expect(b.body).toContain("votre signature");
    const r = relanceDraft(rows.find((x) => x.id === "r1")!, "Léa");
    expect(r.body).toMatch(/^Hello Léa,/);
    expect(r.body).toContain("ta signature");
    expect(`${b.body}${r.body}${b.subject}`).not.toMatch(/[\u2013\u2014]/);
  });
});
