import { describe, expect, it } from "vitest";
import { echeanceIso, factureEnRetard } from "./factureRetard.ts";

describe("factureEnRetard", () => {
  it("statut « retard » : toujours", () => {
    expect(factureEnRetard({ status: "retard", date: null }, "2026-11-27")).toBe(true);
  });
  it("« attente » dont l'échéance est passée, pas le jour même", () => {
    expect(factureEnRetard({ status: "attente", date: "2026-11-26" }, "2026-11-27")).toBe(true);
    expect(factureEnRetard({ status: "attente", date: "2026-11-27" }, "2026-11-27")).toBe(false);
    expect(factureEnRetard({ status: "attente", date: "2026-12-01" }, "2026-11-27")).toBe(false);
  });
  it("ancien format jj/mm[/aaaa], échéance illisible ou autre statut : comme Facturation", () => {
    expect(factureEnRetard({ status: "attente", date: "20/11/2026" }, "2026-11-27")).toBe(true);
    expect(factureEnRetard({ status: "attente", date: "20/11" }, "2026-11-27")).toBe(true);
    expect(factureEnRetard({ status: "attente", date: "—" }, "2026-11-27")).toBe(false);
    expect(factureEnRetard({ status: "payee", date: "2026-01-01" }, "2026-11-27")).toBe(false);
    expect(factureEnRetard({ status: "brouillon", date: "2026-01-01" }, "2026-11-27")).toBe(false);
  });
  it("echeanceIso", () => {
    expect(echeanceIso("2026-11-20T00:00:00", "2026-11-27")).toBe("2026-11-20");
    expect(echeanceIso("5/1/27", "2026-11-27")).toBe("2027-01-05");
    expect(echeanceIso("", "2026-11-27")).toBe("");
  });
});
