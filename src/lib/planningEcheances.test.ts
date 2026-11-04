import { describe, expect, it } from "vitest";
import { birthdayEcheances, contractEcheances, excluEcheances } from "./planningEcheances";
import type { Exclusivite } from "../../supabase/functions/_shared/exclusivites.ts";

describe("contractEcheances", () => {
  it("pose la fin du contrat (début + durée)", () => {
    const [e] = contractEcheances([{ id: "a", creator: "LÉNA PASQUALE", type: "représentation", start: "2026-11-02", months: 12 }]);
    expect(e).toMatchObject({ date: "2027-11-02", kind: "contrat", who: "LÉNA PASQUALE" });
    expect(e.title).toBe("Léna Pasquale · Représentation");
  });
  it("garde seulement la dernière fin d'un contrat renouvelé", () => {
    const out = contractEcheances([
      { id: "a", creator: "Ivana", type: "représentation", start: "2025-11-01", months: 12 },
      { id: "b", creator: "ivana", type: "Représentation", start: "2026-11-01", months: 12 },
      { id: "c", creator: "Ivana", type: "ugc", start: "2026-01-01", months: 6 },
    ]);
    expect(out.map((e) => e.date).sort()).toEqual(["2026-07-01", "2027-11-01"]);
  });
  it("lit une durée enregistrée en texte", () => {
    const [e] = contractEcheances([{ creator: "A", type: "marque", start: "2026-01-15", months: "6" as unknown as number }]);
    expect(e.date).toBe("2026-07-15");
  });
  it("ignore un contrat sans date ou sans créateur", () => {
    expect(contractEcheances([{ creator: "", type: "marque", start: "2026-01-01", months: 3 }, { creator: "A", type: "marque", start: "", months: 3 }])).toEqual([]);
  });
});

describe("excluEcheances", () => {
  const base: Exclusivite = { id: "x", creator: "LÉNA PASQUALE", brand: "Nutripure", scope: "", competitors: [], start: "2026-11-01", end: "2027-02-01", points: [], source: "manuel", createdAt: 0 };
  it("pose la fin d'une exclusivité confirmée", () => {
    expect(excluEcheances([base])).toEqual([{ id: "exclu:x", date: "2027-02-01", title: "Léna Pasquale × Nutripure", label: "Nutripure", who: "LÉNA PASQUALE", kind: "exclu" }]);
  });
  it("ignore celles à confirmer et celles sans fin", () => {
    expect(excluEcheances([{ ...base, pending: true }, { ...base, id: "y", end: null }])).toEqual([]);
  });
});

describe("birthdayEcheances", () => {
  it("place l'anniversaire sur trois années avec l'âge", () => {
    const out = birthdayEcheances([{ name: "Ivana", birth: "05/11/1999", status: "actif" }], "2026-11-04");
    expect(out.map((e) => e.date)).toEqual(["2025-11-05", "2026-11-05", "2027-11-05"]);
    expect(out[1].title).toBe("Ivana · 27 ans");
  });
  it("fête un 29 février le 28 les années non bissextiles", () => {
    const out = birthdayEcheances([{ name: "A", birth: "2000-02-29" }], "2027-01-01");
    expect(out.map((e) => e.date)).toEqual(["2026-02-28", "2027-02-28", "2028-02-29"]);
  });
  it("ignore les inactifs et les dates absentes", () => {
    expect(birthdayEcheances([{ name: "A", birth: "2000-01-01", status: "inactif" }, { name: "B", birth: null }], "2026-11-04")).toEqual([]);
  });
});
