import { describe, expect, it } from "vitest";
import {
  addIgnoredSender,
  applyIgnoredChange,
  ignoredList,
  isIgnoredSender,
  readIgnoredSenders,
  senderAddress,
} from "./mailIgnore.ts";

describe("senderAddress", () => {
  it("garde l'adresse seule, en minuscules", () => {
    expect(senderAddress("Jean Dupont <Jean.Dupont@Marque.COM>")).toBe("jean.dupont@marque.com");
    expect(senderAddress("  contact@marque.fr ")).toBe("contact@marque.fr");
  });
  it("refuse ce qui n'est pas une adresse", () => {
    expect(senderAddress("")).toBe("");
    expect(senderAddress("Jean Dupont")).toBe("");
    expect(senderAddress("a@b")).toBe("");
  });
});

describe("readIgnoredSenders", () => {
  it("lit l'objet du blob et remet les adresses en minuscules", () => {
    expect(readIgnoredSenders({ "A@B.com": 5, "pas une adresse": 3, "c@d.fr": "x" })).toEqual({ "a@b.com": 5, "c@d.fr": 0 });
  });
  it("accepte une ancienne liste d'adresses", () => {
    expect(readIgnoredSenders(["X@Y.com", 4, "rien"])).toEqual({ "x@y.com": 0 });
  });
  it("rend une liste vide pour une valeur absente ou cassée", () => {
    expect(readIgnoredSenders(undefined)).toEqual({});
    expect(readIgnoredSenders("a@b.com")).toEqual({});
    expect(readIgnoredSenders(null)).toEqual({});
  });
});

describe("isIgnoredSender", () => {
  const ignored = { "news@marque.com": 1 };
  it("reconnaît l'expéditeur, quelle que soit la casse ou le nom affiché", () => {
    expect(isIgnoredSender("Marque <NEWS@marque.com>", ignored)).toBe(true);
    expect(isIgnoredSender("news@marque.com", ignored)).toBe(true);
  });
  it("ne touche ni une autre adresse du même domaine, ni une adresse vide", () => {
    expect(isIgnoredSender("partenariats@marque.com", ignored)).toBe(false);
    expect(isIgnoredSender("", ignored)).toBe(false);
    expect(isIgnoredSender("constructor@x.com", {})).toBe(false);
  });
});

describe("addIgnoredSender", () => {
  it("ajoute une nouvelle adresse", () => {
    expect(addIgnoredSender({}, "Robot <Robot@Outil.io>", 100)).toEqual({ email: "robot@outil.io", set: { "robot@outil.io": 100 }, remove: [] });
  });
  it("ne fait rien pour une adresse déjà retenue ou invalide", () => {
    expect(addIgnoredSender({ "a@b.com": 1 }, "A@B.com", 2)).toBeNull();
    expect(addIgnoredSender({}, "pas une adresse", 2)).toBeNull();
  });
  it("oublie les plus anciennes au-delà du maximum", () => {
    const cur = { "a@x.com": 1, "b@x.com": 3, "c@x.com": 2 };
    const r = addIgnoredSender(cur, "d@x.com", 10, 3);
    expect(r?.remove).toEqual(["a@x.com"]);
    expect(applyIgnoredChange(cur, r!.set, r!.remove)).toEqual({ "b@x.com": 3, "c@x.com": 2, "d@x.com": 10 });
  });
});

describe("ignoredList", () => {
  it("range les adresses de la plus récente à la plus ancienne", () => {
    expect(ignoredList({ "a@x.com": 1, "b@x.com": 5, "c@x.com": 5 }).map((x) => x.email)).toEqual(["b@x.com", "c@x.com", "a@x.com"]);
  });
});
