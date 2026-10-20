import { describe, expect, it } from "vitest";
import { buildBrandIndex, collabTag, creatorTone, domainRoot, matchCollabs, relanceDays, type CollabLite } from "./mailCollab";

const collab = (p: Partial<CollabLite> & { id: string; brand: string }): CollabLite => ({
  creator: null, contact: null, title: null, deliverables: null, cachet: null, step: 1, status: "active", updated_at: null, ...p,
});

const COLLABS = [
  collab({ id: "a", brand: "Saucony", creator: "CANDICE", step: 1, updated_at: "2026-10-10" }),
  collab({ id: "b", brand: "Saucony", creator: "LÉA", step: 4, updated_at: "2026-10-12" }),
  collab({ id: "c", brand: "Nutripure", creator: "LÉA", step: 2, contact: "Pauline · pauline@nutri.example" }),
];
const INDEX = buildBrandIndex([
  { email: "Pauline@Saucony.fr", brand: "Saucony" },
  { email: "contact@gmail.com", brand: "Speedo" },
  { email: "team@ttpcreators.pro", brand: "TTP" },
]);

describe("mailCollab : fil → collab", () => {
  it("reconnaît la marque par l'adresse exacte du contact", () => {
    expect(matchCollabs({ emails: ["pauline@saucony.fr"] }, INDEX, COLLABS).map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("reconnaît la marque par le domaine d'entreprise, jamais par une messagerie grand public", () => {
    expect(matchCollabs({ emails: ["marc@saucony.fr"] }, INDEX, COLLABS).length).toBe(2);
    expect(matchCollabs({ emails: ["autre@gmail.com"] }, INDEX, COLLABS)).toEqual([]);
  });

  it("garde seulement la collab du créateur dont l'alias est dans le fil", () => {
    expect(matchCollabs({ emails: ["pauline@saucony.fr"], creator: "candice" }, INDEX, COLLABS).map((c) => c.id)).toEqual(["a"]);
  });

  it("reconnaît la marque dans le domaine de l'expéditeur et dans le contact de la collab", () => {
    expect(matchCollabs({ emails: ["news@mail.saucony.com"] }, null, COLLABS).length).toBe(2);
    expect(matchCollabs({ emails: ["pauline@nutri.example"] }, null, COLLABS).map((c) => c.id)).toEqual(["c"]);
  });

  it("créateur seul : la marque doit être citée dans le fil", () => {
    expect(matchCollabs({ emails: ["x@agence-rp.fr"], creator: "Léa", text: "Brief Nutripure : la suite" }, null, COLLABS).map((c) => c.id)).toEqual(["c"]);
    expect(matchCollabs({ emails: ["x@agence-rp.fr"], creator: "Léa", text: "Bonjour" }, null, COLLABS)).toEqual([]);
  });

  it("ignore les adresses de l'agence et ne trouve rien sans indice", () => {
    expect(matchCollabs({ emails: ["team@ttpcreators.pro"] }, INDEX, COLLABS)).toEqual([]);
    expect(matchCollabs({ emails: [] }, INDEX, [])).toEqual([]);
  });
});

describe("mailCollab : étiquettes", () => {
  it("étape commune seulement", () => {
    expect(collabTag([COLLABS[0]])?.label).toBe("Signature");
    expect(collabTag([COLLABS[0], COLLABS[1]])).toBeNull();
    expect(collabTag([])).toBeNull();
  });

  it("relance entre 7 et 30 jours après notre dernier message", () => {
    const now = Date.UTC(2026, 9, 20);
    const day = 86_400_000;
    expect(relanceDays({ direction: "out", ts: now - 7 * day }, now)).toBe(7);
    expect(relanceDays({ direction: "out", ts: now - 6 * day }, now)).toBeNull();
    expect(relanceDays({ direction: "in", ts: now - 10 * day }, now)).toBeNull();
    expect(relanceDays({ direction: "out", ts: now - 40 * day }, now)).toBeNull();
  });

  it("domaine racine et couleur stable", () => {
    expect(domainRoot("news.saucony.fr")).toBe("saucony");
    expect(domainRoot("brand.co.uk")).toBe("brand");
    expect(creatorTone("Candice")).toBe(creatorTone(" candice "));
  });
});
